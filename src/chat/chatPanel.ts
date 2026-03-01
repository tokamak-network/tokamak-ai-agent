import * as vscode from 'vscode';
import { streamChatCompletion, ChatMessage, isVisionCapable } from '../api/client.js';
import { isConfigured, promptForConfiguration, getAvailableModels, getSelectedModel, setSelectedModel, isCheckpointsEnabled, getEnableMultiModelReview, setEnableMultiModelReview, getReviewerModel, setReviewerModel, getCriticModel, setCriticModel, getMaxReviewIterations, getMaxDebateIterations, getAgentStrategy, setAgentStrategy, getPlanStrategy, setPlanStrategy, getAutoApprovalConfig } from '../config/settings.js';
import { AgentEngine } from '../agent/engine.js';
import { AgentContext, AgentStrategy, PlanStrategy } from '../agent/types.js';
import {
    removeAutoExecutionCode,
    removeTrailingBackticks,
    removeControlCharacterArtifacts,
    applySearchReplaceBlocks,
} from '../utils/contentUtils.js';
import { logger } from '../utils/logger.js';
import { FileOperation, parseFileOperations } from './fileOperationParser.js';
import { ChatMode, buildModePrompt, resolveHints, PromptContext } from '../prompts/index.js';
import { SlashCommand, getAllSkills, filterSlashCommands, matchSlashCommand } from './skillsManager.js';
import { getHtmlContent } from './webviewContent.js';
import { needsCompression, compressMessages } from '../context/contextCompressor.js';
import { shouldAutoApprove, classifyOperation } from '../approval/autoApproval.js';
import { MentionProvider } from '../mentions/mentionProvider.js';
import { RuleLoader } from '../rules/ruleLoader.js';
import { getActiveRules, formatRulesForPrompt } from '../rules/ruleEvaluator.js';
import { McpConfigManager } from '../mcp/mcpConfigManager.js';
import { McpClient } from '../mcp/mcpClient.js';
import { formatToolsForPrompt, parseMcpToolCalls, formatToolResult } from '../mcp/mcpToolAdapter.js';
import { HookConfigLoader } from '../hooks/hookConfigLoader.js';
import { HookRunner } from '../hooks/hookRunner.js';
import { StreamingDiffParser } from '../streaming/streamingDiffParser.js';
import { AutoCollector } from '../knowledge/autoCollector.js';
import { getBrowserActionDocs } from '../browser/browserActions.js';


interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    mode: ChatMode;
    timestamp: number;
}

export class ChatPanel {
    public static currentPanel: ChatPanel | undefined;
    private static readonly viewType = 'tokamakChat';
    private static extensionContext: vscode.ExtensionContext | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private chatHistory: ChatMessage[] = [];
    private sessions: ChatSession[] = [];
    private currentSessionId: string | undefined;
    private disposables: vscode.Disposable[] = [];
    private currentMode: ChatMode = 'ask';
    private pendingOperations: FileOperation[] = [];
    private currentAbortController: AbortController | null = null;
    private agentEngine: AgentEngine | undefined;
    /** 마지막 리뷰/비평 결과 저장 — Apply Fix / Revise Plan 시 채팅에 전달 */
    private lastReviewSynthesis: string = '';
    private lastDebateSynthesis: string = '';
    /** Apply Fix 후 다음 Apply Changes에서 리뷰 재시작을 방지 */
    private skipNextReview: boolean = false;

    // --- New subsystems ---
    private mentionProvider: MentionProvider = new MentionProvider();
    private ruleLoader: RuleLoader = new RuleLoader();
    private mcpConfigManager: McpConfigManager = new McpConfigManager();
    private mcpClients: Map<string, McpClient> = new Map();
    private hookConfigLoader: HookConfigLoader = new HookConfigLoader();
    private hookRunner: HookRunner = new HookRunner();
    private streamingDiffParser: StreamingDiffParser = new StreamingDiffParser();
    private autoCollector: AutoCollector = new AutoCollector();

    public static setContext(context: vscode.ExtensionContext): void {
        ChatPanel.extensionContext = context;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Restore chat history
        this.restoreChatHistory();

        this.panel.webview.html = getHtmlContent();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (message) => this.handleMessage(message),
            null,
            this.disposables
        );

        this.initAgentEngine();
        this.initSubsystems();
    }

    private initSubsystems(): void {
        // Load rules
        this.ruleLoader.loadRules().catch(err => {
            logger.warn('[ChatPanel]', 'Failed to load rules', err);
        });
        this.ruleLoader.startWatching(() => {
            this.ruleLoader.loadRules().catch(() => {});
        });

        // Load MCP config
        this.mcpConfigManager.loadConfig().then(config => {
            for (const server of config.servers.filter(s => s.enabled)) {
                const client = new McpClient(server);
                client.connect().then(() => {
                    this.mcpClients.set(server.name, client);
                    logger.info('[ChatPanel]', `MCP server connected: ${server.name}`);
                }).catch(err => {
                    logger.warn('[ChatPanel]', `MCP server connection failed: ${server.name}`, err);
                });
            }
        }).catch(() => {});
        this.mcpConfigManager.startWatching(() => {
            // Reconnect on config change
            for (const client of this.mcpClients.values()) {
                client.disconnect().catch(() => {});
            }
            this.mcpClients.clear();
            this.mcpConfigManager.loadConfig().then(config => {
                for (const server of config.servers.filter(s => s.enabled)) {
                    const client = new McpClient(server);
                    client.connect().then(() => {
                        this.mcpClients.set(server.name, client);
                    }).catch(() => {});
                }
            }).catch(() => {});
        });

        // Load hooks config
        this.hookConfigLoader.loadConfig().catch(err => {
            logger.warn('[ChatPanel]', 'Failed to load hooks config', err);
        });
        this.hookConfigLoader.startWatching(() => {
            this.hookConfigLoader.loadConfig().catch(() => {});
        });
    }

    private initAgentEngine(): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const context: AgentContext = {
            sessionId: this.currentSessionId || 'default',
            mode: this.currentMode,
            userInput: '', // 초기값
            history: this.chatHistory,
            workspacePath: workspaceFolder?.uri.fsPath || '',
            maxFixAttempts: 3,
            tokenBudget: 4000,
            extensionContext: ChatPanel.extensionContext,
            onStateChange: (state) => {
                this.panel.webview.postMessage({ command: 'agentStateChanged', state });
            },
            onPlanChange: (plan) => {
                this.panel.webview.postMessage({ command: 'updatePlan', plan });
            },
            onMessage: (role, content) => {
                // Agent 실행 중 메시지 표시 (터미널 실행 결과 등)
                this.panel.webview.postMessage({
                    command: 'addMessage',
                    role: role,
                    content: content
                });
            },
            onCheckpointCreated: (checkpointId) => {
                logger.info('[ChatPanel]', `Checkpoint created callback: ${checkpointId}`);
                this.panel.webview.postMessage({ command: 'checkpointCreated', checkpointId });
                this.getCheckpoints();
            },
            // ── 실시간 스트리밍 콜백 ──────────────────────────────────────────
            onStreamStart: () => {
                this.panel.webview.postMessage({ command: 'startStreaming' });
            },
            onStreamChunk: (chunk) => {
                this.panel.webview.postMessage({ command: 'streamChunk', content: chunk });
            },
            onStreamEnd: () => {
                this.panel.webview.postMessage({ command: 'endStreaming' });
            },
            // Multi-model review settings
            enableMultiModelReview: getEnableMultiModelReview(),
            reviewerModel: getReviewerModel() || getSelectedModel(),
            criticModel: getCriticModel() || getSelectedModel(),
            maxReviewIterations: getMaxReviewIterations(),
            maxDebateIterations: getMaxDebateIterations(),
            // Strategy selection
            agentStrategy: getAgentStrategy(),
            planStrategy: getPlanStrategy(),
            // Multi-round review/debate callbacks
            onReviewComplete: (feedback, rounds, convergence) => {
                this.panel.webview.postMessage({
                    command: 'showReviewResults',
                    feedback,
                    rounds,
                    convergence,
                });
            },
            onDebateComplete: (feedback, rounds, convergence) => {
                // synthesis는 onSynthesisComplete에서 저장됨
                this.panel.webview.postMessage({
                    command: 'showDebateResults',
                    feedback,
                    rounds,
                    convergence,
                });
            },
            onSynthesisComplete: (synthesis) => {
                // 마지막 synthesis 저장 (Apply Fix / Revise Plan 시 사용)
                // Agent 모드 → review synthesis, Plan 모드 → debate synthesis
                if (this.currentMode === 'agent') {
                    this.lastReviewSynthesis = synthesis;
                } else {
                    this.lastDebateSynthesis = synthesis;
                }
                this.panel.webview.postMessage({
                    command: 'showSynthesis',
                    synthesis,
                });
            },
        };
        this.agentEngine = new AgentEngine(context);
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'sendMessage':
                await this.handleUserMessage(message.text, message.attachedFiles || [], message.attachedImages || []);
                break;
            case 'insertCode':
                await this.insertCodeToEditor(message.code);
                break;
            case 'selectModel':
                await this.handleModelChange(message.model);
                break;
            case 'selectMode':
                this.currentMode = message.mode;
                this.saveChatHistory();
                this.panel.webview.postMessage({
                    command: 'modeChanged',
                    mode: this.currentMode,
                    checkpointsEnabled: isCheckpointsEnabled()
                });
                break;
            case 'ready':
                this.updateModelList();
                this.panel.webview.postMessage({
                    command: 'modeChanged',
                    mode: this.currentMode,
                    checkpointsEnabled: isCheckpointsEnabled()
                });
                this.sendRestoredHistory();
                // Agent 모드이고 checkpoint가 활성화된 경우에만 체크포인트 로드
                if (this.currentMode === 'agent' && isCheckpointsEnabled()) {
                    await this.getCheckpoints();
                }
                break;
            case 'getSessions':
                this.panel.webview.postMessage({
                    command: 'sessionsList',
                    sessions: this.sessions.map(s => ({ id: s.id, title: s.title, timestamp: s.timestamp, mode: s.mode })),
                    currentSessionId: this.currentSessionId
                });
                break;
            case 'loadSession':
                const session = this.sessions.find(s => s.id === message.sessionId);
                if (session) {
                    this.saveChatHistory();
                    this.currentSessionId = session.id;
                    this.chatHistory = session.messages;
                    this.currentMode = session.mode;
                    this.panel.webview.postMessage({ command: 'clearMessages' });
                    this.panel.webview.postMessage({
                        command: 'modeChanged',
                        mode: this.currentMode,
                        checkpointsEnabled: isCheckpointsEnabled()
                    });
                    this.sendRestoredHistory();
                }
                break;
            case 'deleteSession':
                this.sessions = this.sessions.filter(s => s.id !== message.sessionId);
                if (this.currentSessionId === message.sessionId) {
                    this.clearChat();
                } else {
                    this.saveChatHistory();
                }
                this.panel.webview.postMessage({
                    command: 'sessionsList',
                    sessions: this.sessions.map(s => ({ id: s.id, title: s.title, timestamp: s.timestamp, mode: s.mode })),
                    currentSessionId: this.currentSessionId
                });
                break;
            case 'exportSession':
                await this.exportSession(message.sessionId);
                break;
            case 'searchFiles':
                await this.searchFiles(message.query);
                break;
            case 'openFile':
                await this.openFile(message.path);
                break;
            case 'applyOperations':
                await this.applyFileOperations();
                break;
            case 'rejectOperation':
                if (message.index !== undefined && message.index >= 0 && message.index < this.pendingOperations.length) {
                    this.pendingOperations.splice(message.index, 1);
                    if (this.pendingOperations.length === 0) {
                        this.panel.webview.postMessage({ command: 'operationsCleared' });
                    } else {
                        this.panel.webview.postMessage({
                            command: 'showOperations',
                            operations: this.pendingOperations.map(op => ({
                                type: op.type,
                                path: op.path,
                                description: op.description,
                            })),
                        });
                    }
                }
                break;
            case 'rejectOperations':
                this.pendingOperations = [];
                this.panel.webview.postMessage({ command: 'operationsCleared' });
                break;
            case 'newChat':
                this.clearChat();
                break;
            case 'previewOperation':
                await this.previewFileOperation(message.index);
                break;
            case 'resolveFilePath':
                await this.resolveFilePath(message.uri);
                break;
            case 'runCommand':
                await this.runInTerminal(message.commandText);
                break;
            case 'stopGeneration':
                this.stopGeneration();
                break;
            case 'searchSlashCommands':
                await this.searchSlashCommands(message.query);
                break;
            case 'getCheckpoints':
                await this.getCheckpoints();
                break;
            case 'compareCheckpoint':
                await this.compareCheckpoint(message.checkpointId);
                break;
            case 'restoreCheckpoint':
                await this.restoreCheckpoint(message.checkpointId, message.restoreWorkspaceOnly || false);
                break;
            case 'deleteCheckpoint':
                await this.deleteCheckpoint(message.checkpointId);
                break;
            case 'toggleMultiModelReview':
                await setEnableMultiModelReview(message.enabled);
                if (this.agentEngine) {
                    this.agentEngine.updateContext({
                        enableMultiModelReview: message.enabled,
                        reviewerModel: getReviewerModel() || getSelectedModel(),
                        criticModel: getCriticModel() || getSelectedModel(),
                    });
                }
                break;
            case 'selectReviewerModel':
                await setReviewerModel(message.model);
                if (this.agentEngine) {
                    this.agentEngine.updateContext({
                        reviewerModel: message.model || getSelectedModel(),
                    });
                }
                break;
            case 'selectCriticModel':
                await setCriticModel(message.model);
                if (this.agentEngine) {
                    this.agentEngine.updateContext({
                        criticModel: message.model || getSelectedModel(),
                    });
                }
                break;
            case 'reviewAction':
                if (this.agentEngine) {
                    if (message.decision === 'apply_fix') {
                        // Agent 모드: 엔진의 Fixing 대신 리뷰 피드백을 채팅 메시지로 전달
                        // 엔진은 skip으로 정상 종료
                        this.skipNextReview = true;
                        this.agentEngine.resolveReviewDecision('skip');
                        // 리뷰 피드백을 사용자 메시지로 주입 → AI가 새 FILE_OPERATION으로 수정
                        const reviewFeedback = this.lastReviewSynthesis || 'Code review found issues that need fixing.';
                        const fixPrompt = `The code review identified the following issues. Please fix them and provide corrected file operations:\n\n${reviewFeedback}`;
                        this.handleUserMessage(fixPrompt, [], []);
                    } else {
                        this.agentEngine.resolveReviewDecision('skip');
                    }
                }
                break;
            case 'debateAction':
                if (this.agentEngine) {
                    if (message.decision === 'revise') {
                        // Plan 모드: 엔진의 Planning 대신 비평 피드백을 채팅 메시지로 전달
                        this.agentEngine.resolveDebateDecision('accept');
                        const debateFeedback = this.lastDebateSynthesis || 'Plan debate found concerns that need addressing.';
                        const revisePrompt = `The plan debate identified the following concerns. Please revise the plan:\n\n${debateFeedback}`;
                        this.handleUserMessage(revisePrompt, [], []);
                    } else {
                        this.agentEngine.resolveDebateDecision('accept');
                    }
                }
                break;
            case 'selectAgentStrategy':
                await setAgentStrategy(message.strategy);
                if (this.agentEngine) {
                    this.agentEngine.updateContext({ agentStrategy: message.strategy as AgentStrategy });
                }
                break;
            case 'selectPlanStrategy':
                await setPlanStrategy(message.strategy);
                if (this.agentEngine) {
                    this.agentEngine.updateContext({ planStrategy: message.strategy as PlanStrategy });
                }
                break;
        }
    }

    public static createOrShow(extensionUri: vscode.Uri): void {
        const column = vscode.ViewColumn.Beside;

        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ChatPanel.viewType,
            'Tokamak AI Agent',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        // 상단 탭에 익스텐션 전용 아이콘 표시
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'icon.png');

        ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
    }

    public clearChat(): void {
        this.chatHistory = [];
        this.pendingOperations = [];
        this.saveChatHistory();
        this.panel.webview.postMessage({ command: 'clearMessages' });
    }

    private saveChatHistory(): void {
        if (ChatPanel.extensionContext) {
            // Update current session in the list
            if (!this.currentSessionId) {
                this.currentSessionId = Date.now().toString();
            }

            const existingIndex = this.sessions.findIndex(s => s.id === this.currentSessionId);

            // Get title from first user message if not set
            let title = 'New Conversation';
            const firstUserMessage = this.chatHistory.find(m => m.role === 'user');
            if (firstUserMessage) {
                let content = '';
                if (typeof firstUserMessage.content === 'string') {
                    content = firstUserMessage.content;
                } else if (Array.isArray(firstUserMessage.content)) {
                    const textPart = firstUserMessage.content.find((p: any) => p.type === 'text');
                    content = textPart ? textPart.text : '';
                }
                title = content.split('\n')[0].substring(0, 30) + (content.length > 30 ? '...' : '');
            }

            const session: ChatSession = {
                id: this.currentSessionId,
                title: title,
                messages: this.chatHistory,
                mode: this.currentMode,
                timestamp: Date.now()
            };

            if (existingIndex >= 0) {
                this.sessions[existingIndex] = session;
            } else {
                this.sessions.unshift(session);
            }

            // Limit sessions to 50
            if (this.sessions.length > 50) {
                this.sessions = this.sessions.slice(0, 50);
            }

            ChatPanel.extensionContext.workspaceState.update('tokamak.sessions', this.sessions);
            ChatPanel.extensionContext.workspaceState.update('tokamak.currentSessionId', this.currentSessionId);
        }
    }

    private restoreChatHistory(): void {
        if (ChatPanel.extensionContext) {
            this.sessions = ChatPanel.extensionContext.workspaceState.get<ChatSession[]>('tokamak.sessions') || [];
            this.currentSessionId = ChatPanel.extensionContext.workspaceState.get<string>('tokamak.currentSessionId');

            if (this.currentSessionId) {
                const currentSession = this.sessions.find(s => s.id === this.currentSessionId);
                if (currentSession) {
                    this.chatHistory = currentSession.messages;
                    this.currentMode = currentSession.mode;
                }
            } else if (this.sessions.length > 0) {
                // Load latest session if no current ID
                const latest = this.sessions[0];
                this.currentSessionId = latest.id;
                this.chatHistory = latest.messages;
                this.currentMode = latest.mode;
            }
        }
    }

    private sendRestoredHistory(): void {
        // Send restored messages to webview
        for (const message of this.chatHistory) {
            if (message.role !== 'system') {
                this.panel.webview.postMessage({
                    command: 'addMessage',
                    role: message.role,
                    content: message.content,
                });
            }
        }
    }

    private async exportSession(sessionId: string): Promise<void> {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }

        try {
            // Format session data as JSON
            const exportData = {
                title: session.title,
                mode: session.mode,
                timestamp: session.timestamp,
                date: new Date(session.timestamp).toISOString(),
                messages: session.messages.map(msg => ({
                    role: msg.role,
                    content: typeof msg.content === 'string' ? msg.content :
                        Array.isArray(msg.content) ? msg.content.map((item: any) =>
                            item.type === 'text' ? item.text : item
                        ).join('') : JSON.stringify(msg.content)
                }))
            };

            const jsonContent = JSON.stringify(exportData, null, 2);

            // Show save dialog
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`tokamak-chat-${session.title.replace(/[^a-z0-9]/gi, '-')}-${sessionId}.json`),
                filters: {
                    'JSON': ['json'],
                    'All Files': ['*']
                },
                saveLabel: 'Export'
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(jsonContent, 'utf8'));
                vscode.window.showInformationMessage(`Conversation exported to ${uri.fsPath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export session: ${error}`);
        }
    }

    public sendCodeToChat(code: string, filePath: string, languageId: string): void {
        this.panel.reveal();
        this.panel.webview.postMessage({
            command: 'receiveCode',
            code: code,
            filePath: filePath,
            languageId: languageId,
        });
    }

    private updateModelList(): void {
        const models = getAvailableModels();
        const selected = getSelectedModel();
        this.panel.webview.postMessage({
            command: 'updateModels',
            models: models,
            selected: selected,
            enableMultiModelReview: getEnableMultiModelReview(),
            reviewerModel: getReviewerModel(),
            criticModel: getCriticModel(),
        });
    }

    private async handleModelChange(model: string): Promise<void> {
        await setSelectedModel(model);
        vscode.window.showInformationMessage(`Model changed to: ${model}`);
    }

    private async searchFiles(query: string): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            this.panel.webview.postMessage({ command: 'fileSearchResults', files: [] });
            return;
        }

        try {
            // Find files matching query
            const files = await vscode.workspace.findFiles(
                `**/*${query}*`,
                '**/node_modules/**',
                50
            );

            const results: any[] = [];
            const processedPaths = new Set<string>();

            // 1. Add files
            for (const file of files) {
                const relPath = vscode.workspace.asRelativePath(file);
                results.push({
                    path: relPath,
                    fullPath: file.fsPath,
                    name: relPath.split('/').pop() || relPath,
                    isDir: false
                });
                processedPaths.add(relPath);

                // 2. Also check if any parent folders match the query
                let parts = relPath.split('/');
                parts.pop(); // remove file name

                let currentPath = '';
                for (const part of parts) {
                    currentPath = currentPath ? `${currentPath}/${part}` : part;
                    if (currentPath.toLowerCase().includes(query.toLowerCase()) && !processedPaths.has(currentPath)) {
                        results.push({
                            path: currentPath,
                            name: part,
                            isDir: true
                        });
                        processedPaths.add(currentPath);
                    }
                }
            }

            // Note: results may exceed 50 due to folder additions, so crop
            this.panel.webview.postMessage({ command: 'fileSearchResults', files: results.sort((a, b) => a.path.length - b.path.length).slice(0, 50) });
        } catch {
            this.panel.webview.postMessage({ command: 'fileSearchResults', files: [] });
        }
    }

    private async openFile(path: string): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
                const stat = await vscode.workspace.fs.stat(fileUri);

                if (stat.type === vscode.FileType.Directory) {
                    await vscode.commands.executeCommand('revealInExplorer', fileUri);
                } else {
                    await vscode.window.showTextDocument(fileUri);
                }
            }
        } catch {
            vscode.window.showErrorMessage(`Could not open: ${path}`);
        }
    }

    private async resolveFilePath(uriString: string): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            let filePath = uriString.trim();

            // Handle file:// URI format using VS Code's URI parser
            if (filePath.startsWith('file://')) {
                const uri = vscode.Uri.parse(filePath);
                filePath = uri.fsPath;
            }

            // Convert to relative path
            const workspacePath = workspaceFolder.uri.fsPath;
            if (filePath.startsWith(workspacePath)) {
                filePath = filePath.substring(workspacePath.length);
                // Remove leading slash/backslash
                filePath = filePath.replace(/^[/\\]+/, '');
            } else {
                // File is outside workspace, skip
                return;
            }

            // Skip if path is empty
            if (!filePath) {
                return;
            }

            // Check if file exists
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            try {
                const stat = await vscode.workspace.fs.stat(fileUri);
                // Add files or directories
                if (stat.type === vscode.FileType.File || stat.type === vscode.FileType.Directory) {
                    const fileName = filePath.split(/[/\\]/).pop() || filePath;
                    this.panel.webview.postMessage({
                        command: 'fileDropped',
                        path: filePath,
                        name: fileName,
                        isDir: stat.type === vscode.FileType.Directory
                    });
                }
            } catch {
                // File doesn't exist in workspace
            }
        } catch (error) {
            logger.error('[ChatPanel]', 'Error resolving file path', error);
        }
    }

    private async getFileContent(relativePath: string): Promise<string> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return '';
            }

            const uri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
            const stat = await vscode.workspace.fs.stat(uri);

            // If it's a directory, return the structure
            if (stat.type === vscode.FileType.Directory) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(uri, '**/*'),
                    '**/node_modules/**',
                    100
                );

                let structure = `\n--- Folder: ${relativePath} ---\nFolder Structure:\n`;
                const folderTree: string[] = [];
                for (const file of files) {
                    folderTree.push(`- ${vscode.workspace.asRelativePath(file)}`);
                }
                structure += folderTree.sort().join('\n') + '\n';
                return structure;
            }

            const document = await vscode.workspace.openTextDocument(uri);
            const content = document.getText();
            const language = document.languageId;

            const maxLines = 3000;
            const lines = content.split(/\r?\n/);
            const truncated = lines.length > maxLines;
            const limitedContent = truncated
                ? lines.slice(0, maxLines).join('\n') + '\n... (truncated)'
                : content;

            return `\n--- File: ${relativePath} (${lines.length} lines) ---\n\`\`\`${language}\n${limitedContent}\n\`\`\`\n`;
        } catch {
            return `\n--- Item: ${relativePath} (could not read) ---\n`;
        }
    }

    private getLanguageFromPath(filePath: string): string {
        const ext = filePath.split('.').pop()?.toLowerCase() || '';
        const languageMap: { [key: string]: string } = {
            'ts': 'typescript',
            'tsx': 'typescript',
            'js': 'javascript',
            'jsx': 'javascript',
            'py': 'python',
            'go': 'go',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'h': 'c',
            'md': 'markdown',
            'json': 'json',
            'yaml': 'yaml',
            'yml': 'yaml',
            'html': 'html',
            'css': 'css',
            'sh': 'bash',
            'rs': 'rust',
        };
        return languageMap[ext] || ext;
    }

    private getEditorContext(): string {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return '';
        }

        const document = editor.document;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const relativePath = workspaceFolder
            ? vscode.workspace.asRelativePath(document.uri)
            : document.fileName;

        let context = `\n\n--- Current Editor: ${relativePath} ---\n`;
        context += `Language: ${document.languageId}\n`;

        const selection = editor.selection;
        if (!selection.isEmpty) {
            const selectedText = document.getText(selection);
            context += `\nSelected Code (lines ${selection.start.line + 1}-${selection.end.line + 1}):\n\`\`\`${document.languageId}\n${selectedText}\n\`\`\`\n`;
        } else {
            const cursorLine = selection.active.line;
            const startLine = Math.max(0, cursorLine - 30);
            const endLine = Math.min(document.lineCount - 1, cursorLine + 30);
            const visibleRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
            const visibleCode = document.getText(visibleRange);
            context += `\nCode around cursor (lines ${startLine + 1}-${endLine + 1}):\n\`\`\`${document.languageId}\n${visibleCode}\n\`\`\`\n`;
        }

        return context;
    }

    private getWorkspaceInfo(): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return '';
        }

        const folder = workspaceFolders[0];
        return `\nWorkspace: ${folder.name}`;
    }

    private async getProjectStructure(): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return '';
        }

        const excludePatterns = [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/out/**',
            '**/.next/**',
            '**/build/**',
            '**/__pycache__/**',
            '**/.venv/**',
            '**/venv/**',
            '**/*.pyc',
            '**/.DS_Store',
        ];

        try {
            const files = await vscode.workspace.findFiles(
                '**/*',
                `{${excludePatterns.join(',')}}`,
                2000
            );

            // Build tree structure
            const tree: Map<string, Set<string>> = new Map();
            tree.set('', new Set());

            for (const file of files) {
                const relativePath = vscode.workspace.asRelativePath(file);
                const parts = relativePath.split('/');
                let currentPath = '';

                for (let i = 0; i < parts.length; i++) {
                    const parentPath = currentPath;
                    currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

                    if (!tree.has(parentPath)) {
                        tree.set(parentPath, new Set());
                    }
                    tree.get(parentPath)!.add(parts[i]);
                }
            }

            // Generate tree string
            const buildTreeString = (path: string, indent: string): string => {
                const children = tree.get(path);
                if (!children || children.size === 0) {
                    return '';
                }

                const sortedChildren = Array.from(children).sort((a, b) => {
                    const aIsDir = tree.has(path ? `${path}/${a}` : a);
                    const bIsDir = tree.has(path ? `${path}/${b}` : b);
                    if (aIsDir && !bIsDir) return -1;
                    if (!aIsDir && bIsDir) return 1;
                    return a.localeCompare(b);
                });

                let result = '';
                for (let i = 0; i < sortedChildren.length; i++) {
                    const child = sortedChildren[i];
                    const childPath = path ? `${path}/${child}` : child;
                    const isDir = tree.has(childPath);
                    const isLast = i === sortedChildren.length - 1;
                    const prefix = isLast ? '└── ' : '├── ';
                    const childIndent = indent + (isLast ? '    ' : '│   ');

                    result += `${indent}${prefix}${child}${isDir ? '/' : ''}\n`;

                    if (isDir) {
                        result += buildTreeString(childPath, childIndent);
                    }
                }
                return result;
            };

            const treeString = buildTreeString('', '');
            if (treeString) {
                return `\n--- Project Structure ---\n\`\`\`\n${workspaceFolder.name}/\n${treeString}\`\`\`\n`;
            }
            return '\n(Note: Project structure is too large or too many files to show. Use "read" to explore specific files.)\n';
        } catch (error) {
            return `\n(Note: Could not retrieve project structure automatically. Please ask me to read specific files.)\n`;
        }
    }

    /** Load project knowledge from .tokamak/knowledge/ (conventions, architecture, patterns). Included in system prompt for new chats. */
    private async getProjectKnowledge(): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return '';

        const knowledgeDir = vscode.Uri.joinPath(workspaceFolder.uri, '.tokamak', 'knowledge');
        const MAX_KNOWLEDGE_CHARS = 8000;

        try {
            const entries = await vscode.workspace.fs.readDirectory(knowledgeDir);
            const textFiles = entries
                .filter(([name, type]) => type === vscode.FileType.File && (name.endsWith('.md') || name.endsWith('.txt')))
                .map(([name]) => name)
                .sort();

            if (textFiles.length === 0) return '';

            const parts: string[] = [];
            let totalLen = 0;

            for (const name of textFiles) {
                if (totalLen >= MAX_KNOWLEDGE_CHARS) break;
                const fileUri = vscode.Uri.joinPath(knowledgeDir, name);
                const data = await vscode.workspace.fs.readFile(fileUri);
                const content = Buffer.from(data).toString('utf8').trim();
                if (!content) continue;
                const chunk = `### ${name}\n${content}`;
                const allowed = Math.min(chunk.length, MAX_KNOWLEDGE_CHARS - totalLen);
                if (allowed <= 0) break;
                parts.push(allowed < chunk.length ? chunk.slice(0, allowed) + '\n...(truncated)' : chunk);
                totalLen += chunk.length;
            }

            if (parts.length === 0) return '';
            return `\n--- Project Knowledge (.tokamak/knowledge/) ---\nUse the following project-specific context when answering. Follow conventions and patterns described here.\n\n${parts.join('\n\n')}\n`;
        } catch {
            return '';
        }
    }

    /** AI가 SEARCH 블록 없이 코드를 보냈을 때, 앞/뒤 줄을 기준으로 바꿔치기를 시도하는 헬퍼 함수 */
    private applySnippetFallback(existingContent: string, proposedContent: string): string | null {
        if (!proposedContent || !existingContent) return null;

        // 단순히 통째로 포함되어 있다면 이미 적용된 것과 같음
        if (existingContent.includes(proposedContent)) {
            return existingContent;
        }

        const proposedLinesOriginal = proposedContent.split('\n');
        const existLinesOriginal = existingContent.split(/\r?\n/); // Handle potential windows endings from file

        const proposedLinesTrimmed = proposedLinesOriginal.map(l => l.trim());
        const existLinesTrimmed = existLinesOriginal.map(l => l.trim());

        let bestStartIdx = -1;
        let bestEndIdx = -1;
        let maxScore = -Infinity;

        // 양 끝에서 검색할 최대 깊이 (추가된 코드가 많을 수 있으므로 최대 50줄까지)
        const maxAnchorDepth = Math.min(50, proposedLinesOriginal.length);

        for (let propStart = 0; propStart < maxAnchorDepth; propStart++) {
            const startStr = proposedLinesTrimmed[propStart];
            if (startStr.length === 0) continue;

            const startCandidates = [];
            for (let i = 0; i < existLinesTrimmed.length; i++) {
                if (existLinesTrimmed[i] === startStr) startCandidates.push(i);
            }
            if (startCandidates.length === 0) continue;

            for (let propEnd = proposedLinesOriginal.length - 1; propEnd >= Math.max(0, proposedLinesOriginal.length - maxAnchorDepth); propEnd--) {
                const endStr = proposedLinesTrimmed[propEnd];
                if (endStr.length === 0) continue;

                if (propStart > propEnd) break;

                for (const startIdx of startCandidates) {
                    for (let endIdx = startIdx; endIdx < existLinesTrimmed.length; endIdx++) {
                        if (existLinesTrimmed[endIdx] === endStr) {
                            const replacedLinesCount = endIdx - startIdx + 1;
                            const proposedLinesCount = propEnd - propStart + 1;
                            const diff = Math.abs(replacedLinesCount - proposedLinesCount);

                            // 점수: 잡아낸 블록의 범위(propEnd - propStart)가 넓을수록 높은 점수 부여
                            // 서로 다른 점수일 경우, 차이(diff)가 적을수록 높은 점수 부여
                            const score = (propEnd - propStart) * 10000 - diff;

                            if (score > maxScore) {
                                // 안전장치: 너무 많은 코드가 삭제되는 구간은 거부 (기존 20줄 이상 삭제되며, 새 코드가 삭제되는 코드의 30% 미만)
                                if (!(replacedLinesCount > 20 && proposedLinesCount < replacedLinesCount * 0.3)) {
                                    maxScore = score;
                                    bestStartIdx = startIdx;
                                    bestEndIdx = endIdx;
                                }
                            }
                        }
                    }
                }
            }
        }

        if (bestStartIdx !== -1 && bestEndIdx !== -1 && bestEndIdx >= bestStartIdx) {
            const newLines = [
                ...existLinesOriginal.slice(0, bestStartIdx),
                proposedContent,
                ...existLinesOriginal.slice(bestEndIdx + 1)
            ];
            return newLines.join('\n');
        }

        // --- Single-line similarity fallback ---
        // 만약 제안된 코드가 단 1~2줄이고 문맥이 부족하여 매칭에 실패했다면,
        // 기존 텍스트 중 "가장 비슷한 줄"을 찾아 통째로 교체합니다 (오타 수정 등에 유용).
        if (proposedLinesTrimmed.length === 1 && proposedLinesTrimmed[0].length > 4) {
            const proposedStr = proposedLinesTrimmed[0];
            let bestSimScore = -1;
            let bestSimIdx = -1;

            for (let i = 0; i < existLinesTrimmed.length; i++) {
                const existStr = existLinesTrimmed[i];
                if (existStr.length < 3) continue;

                // 간단한 공통 단어/문자 비율 계산 (자카드 유사도와 유사)
                // 완벽한 Levenshtein 대신 O(N^2) 문자열 공통 길이 탐색 등 (여기서는 대략 길이 비율)
                let commonChars = 0;
                for (let c = 0; c < proposedStr.length; c++) {
                    if (existStr.includes(proposedStr[c])) commonChars++;
                }
                const score = commonChars / Math.max(existStr.length, proposedStr.length);

                // 단순 길이 기반 score보다는 "차집합이 적을 것"을 요구
                const diffLen = Math.abs(existStr.length - proposedStr.length);
                if (score > 0.8 && diffLen < 15 && diffLen < proposedStr.length * 0.5) {
                    if (score > bestSimScore) {
                        bestSimScore = score;
                        bestSimIdx = i;
                    }
                }
            }

            if (bestSimIdx !== -1) {
                // 한 줄 교체
                const newLines = [
                    ...existLinesOriginal.slice(0, bestSimIdx),
                    proposedContent,
                    ...existLinesOriginal.slice(bestSimIdx + 1)
                ];
                return newLines.join('\n');
            }
        }

        return null;
    }

    private async applyFileOperations(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        let successCount = 0;
        let errorCount = 0;
        const edit = new vscode.WorkspaceEdit();

        for (const op of this.pendingOperations) {
            try {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, op.path);

                switch (op.type) {
                    case 'create':
                        if (op.content !== undefined) {
                            edit.createFile(fileUri, { overwrite: true, ignoreIfExists: false });
                            edit.insert(fileUri, new vscode.Position(0, 0), op.content);
                            successCount++;
                        }
                        break;

                    case 'write_full':
                        if (op.content !== undefined) {
                            const existingData = await vscode.workspace.fs.readFile(fileUri);
                            const currentContent = Buffer.from(existingData).toString('utf8');
                            const existingLines = currentContent.split(/\r?\n/).length;
                            // 안전장치: 제안 내용이 기존보다 지나치게 짧으면 대량 삭제로 간주하고 적용 안 함
                            if (currentContent.length > 200 && op.content.length < currentContent.length * 0.5) {
                                vscode.window.showErrorMessage(
                                    `[write_full] ${op.path}: 제안 내용이 기존 파일보다 훨씬 짧아 대량 삭제가 발생할 수 있습니다. 적용하지 않습니다. "처음에/끝에 넣어줘"는 replace(SEARCH/REPLACE)를 사용하세요.`
                                );
                                errorCount++;
                                break;
                            }
                            edit.replace(fileUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(existingLines + 1, 0)), op.content);
                            successCount++;
                        }
                        break;

                    case 'prepend':
                        if (op.content !== undefined) {
                            const existingData = await vscode.workspace.fs.readFile(fileUri);
                            const currentContent = Buffer.from(existingData).toString('utf8');
                            const newContent = op.content.trim() + '\n\n' + currentContent;
                            const docLines = currentContent.split(/\r?\n/).length;
                            edit.replace(fileUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(docLines + 1, 0)), newContent);
                            successCount++;
                        }
                        break;

                    case 'append':
                        if (op.content !== undefined) {
                            const existingData = await vscode.workspace.fs.readFile(fileUri);
                            const currentContent = Buffer.from(existingData).toString('utf8');
                            const newContent = currentContent.trimEnd() + '\n\n' + op.content.trim();
                            const docLines = currentContent.split(/\r?\n/).length;
                            edit.replace(fileUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(docLines + 1, 0)), newContent);
                            successCount++;
                        }
                        break;

                    case 'replace':
                    case 'edit':
                        const existingData = await vscode.workspace.fs.readFile(fileUri);
                        let currentContent = Buffer.from(existingData).toString('utf8');

                        let anyApplied = false;

                        // 4-tier SEARCH/REPLACE (exact → line-trimmed → block-anchor → full-file)
                        // Path 1: explicit search + replace fields → diff 형식으로 변환
                        // Path 2: <<<<<<< SEARCH block inside content
                        if (op.search && op.replace !== undefined) {
                            const s = removeControlCharacterArtifacts(op.search);
                            const r = removeControlCharacterArtifacts(op.replace);
                            const diff = `<<<<<<< SEARCH\n${s}\n=======\n${r}\n>>>>>>> REPLACE`;
                            const result = applySearchReplaceBlocks(currentContent, diff);
                            if (result !== null) {
                                currentContent = result;
                                anyApplied = true;
                            } else {
                                vscode.window.showErrorMessage(`[${op.type}] ${op.path}: 찾을 코드가 파일 내에 정확히 존재하지 않습니다 (띄어쓰기/들여쓰기 확인 필요).`);
                                errorCount++;
                                break;
                            }
                        } else if (op.content !== undefined && op.content.includes('<<<<<<< SEARCH')) {
                            const result = applySearchReplaceBlocks(currentContent, op.content);
                            if (result !== null) {
                                currentContent = result;
                                anyApplied = true;
                            } else {
                                vscode.window.showErrorMessage(`[${op.type}] ${op.path}: 찾을 코드가 파일 내에 정확히 존재하지 않습니다 (띄어쓰기/들여쓰기 확인 필요).`);
                                errorCount++;
                                break;
                            }
                        }
                        // 3. Description 기반 단순 텍스트 교체 (LLM이 content만 주고 search를 안 준 경우에 대한 스마트 폴백)
                        else if (op.content !== undefined) {
                            let smartFallbackSuccess = false;

                            // description에서 "Change A to B", "Replace A with B" 패턴 추출
                            if (op.description && currentContent.includes(op.content)) {
                                // 이미 변경되었다고 간주
                                anyApplied = true;
                                smartFallbackSuccess = true;
                            } else if (op.description && typeof op.description === 'string') {
                                const desc = op.description.trim();
                                let extractedSearch = '';
                                let extractedReplace = '';

                                const changeMatch = desc.match(/^change\s+(.+?)\s+to\s+(.+)$/i);
                                const replaceMatch = desc.match(/^replace\s+(.+?)\s+with\s+(.+)$/i);
                                const koreanMatch1 = desc.match(/^'?"?(.+?)'?"?\s*[을를]\s*'?"?(.+?)'?"?\s*[으]?로\s*(변경|수정|대체)/);
                                const arrowMatch = desc.match(/(.+?)\s*(?:->|=>)\s*(.+)/);

                                if (changeMatch) {
                                    extractedSearch = changeMatch[1];
                                    extractedReplace = changeMatch[2];
                                } else if (replaceMatch) {
                                    extractedSearch = replaceMatch[1];
                                    extractedReplace = replaceMatch[2];
                                } else if (koreanMatch1) {
                                    extractedSearch = koreanMatch1[1];
                                    extractedReplace = koreanMatch1[2];
                                } else if (arrowMatch) {
                                    extractedSearch = arrowMatch[1];
                                    extractedReplace = arrowMatch[2];
                                }

                                if (extractedSearch && currentContent.includes(extractedSearch)) {
                                    // LLM이 content를 엉뚱하게 줬을 수도 있으니, extractedReplace를 우선으로 쓰되, 
                                    // op.content가 명시되어 있다면 op.content가 더 정확할 수 있으므로 op.content로 대체
                                    const replacement = op.content.length > 0 ? op.content : extractedReplace;
                                    currentContent = currentContent.replace(extractedSearch, replacement);
                                    anyApplied = true;
                                    smartFallbackSuccess = true;
                                }
                            }

                            if (!smartFallbackSuccess) {
                                // 기존의 applySnippetFallback 로직 (문맥 기반)
                                const fallbackContent = this.applySnippetFallback(currentContent, op.content);
                                if (fallbackContent !== null) {
                                    currentContent = fallbackContent;
                                    anyApplied = true;
                                } else {
                                    // Fallback도 실패했을 때
                                    if (currentContent.length > 200 && op.content.length < currentContent.length * 0.5) {
                                        vscode.window.showErrorMessage(
                                            `[${op.type}] ${op.path}: AI가 잘못된 포맷으로 코드 수정(일부분)만 요청했습니다. 기존 코드의 어떤 부분을 수정할지 시스템이 찾지 못해 차단합니다. AI에게 명확한 SEARCH/REPLACE 블록을 사용하라고 다시 지시해주세요.`
                                        );
                                        errorCount++;
                                        break;
                                    } else {
                                        // 파일 내용을 통째로 새로 쓴 경우에만 덮어쓰기 허용
                                        currentContent = op.content;
                                        anyApplied = true;
                                    }
                                }
                            }
                        }

                        if (anyApplied) {
                            const docLines = currentContent.split(/\r?\n/).length;
                            edit.replace(fileUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(docLines + 1, 0)), currentContent);
                            successCount++;
                        } else {
                            if (op.content || (op.search && op.replace !== undefined)) {
                                throw new Error(`[${op.type}] 수행 실패: 매칭되는 부분을 찾을 수 없거나 파일 보호 차단됨 (${op.path})`);
                            }
                        }
                        break;

                    case 'delete':
                        edit.deleteFile(fileUri, { ignoreIfNotExists: true });
                        successCount++;
                        break;
                }
            } catch (error) {
                errorCount++;
                logger.error('[ChatPanel]', `Failed to stage ${op.type} for ${op.path}`, error);
            }
        }

        // 일괄 실행
        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
            if (successCount > 0) {
                // 수정된 파일들을 명시적으로 저장
                const modifiedFiles: vscode.Uri[] = [];
                for (const op of this.pendingOperations) {
                    if (op.type === 'create' || op.type === 'edit' || op.type === 'write_full' || op.type === 'replace' || op.type === 'prepend' || op.type === 'append') {
                        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, op.path);
                        modifiedFiles.push(fileUri);
                    }
                }

                // 각 파일을 저장 (이미 열려있거나 새로 생성된 파일)
                for (const fileUri of modifiedFiles) {
                    try {
                        // 파일이 이미 열려있으면 저장, 없으면 열어서 저장
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        // WorkspaceEdit 후 명시적으로 저장
                        await doc.save();
                    } catch (error) {
                        // 파일이 저장할 수 없는 경우 FileSystem API로 직접 저장
                        try {
                            const op = this.pendingOperations.find(p => {
                                const opUri = vscode.Uri.joinPath(workspaceFolder.uri, p.path);
                                return opUri.toString() === fileUri.toString();
                            });
                            if (op && op.content !== undefined) {
                                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(op.content, 'utf8'));
                            }
                        } catch (fsError) {
                            logger.error('[ChatPanel]', `Failed to save ${fileUri.fsPath}`, fsError);
                        }
                    }
                }

                vscode.window.showInformationMessage(`Successfully applied and saved ${successCount} file operation(s).`);

                // ── Multi-Model Review: Apply Changes 성공 후 리뷰 시작 ──
                // Apply Fix에서 온 수정인 경우 리뷰를 건너뛴다 (무한 루프 방지)
                if (this.skipNextReview) {
                    this.skipNextReview = false;
                } else if (this.currentMode === 'agent' && this.agentEngine && getEnableMultiModelReview()) {
                    const opDescriptions = this.pendingOperations.map(op =>
                        `[${op.type}] ${op.path}${op.description ? ': ' + op.description : ''}`
                    );
                    const resultSummary = `Applied ${successCount} operation(s) successfully.`;

                    // pendingOperations를 먼저 비우고, 리뷰 시작 (비동기 — UI 블록하지 않음)
                    const savedOps = [...this.pendingOperations];
                    this.pendingOperations = [];
                    this.panel.webview.postMessage({ command: 'operationsCleared' });

                    this.agentEngine.startReviewForOperations(opDescriptions, resultSummary).catch(err => {
                        logger.error('[ChatPanel]', 'Review for operations failed', err);
                    });
                    return; // early return — pendingOperations 이미 비움
                }
            }
        } else {
            logger.error('[ChatPanel]', 'WorkspaceEdit failed. Check for read-only files or conflicting edits.');
            if (successCount > 0) {
                vscode.window.showErrorMessage(`Failed to apply ${successCount} operation(s) via WorkspaceEdit. Please verify file permissions.`);
            } else if (errorCount > 0) {
                vscode.window.showErrorMessage(`Failed to stage ${errorCount} operation(s). Check the console (Developer Tools) for details.`);
            }
        }

        this.pendingOperations = [];
        this.panel.webview.postMessage({ command: 'operationsCleared' });
    }

    private async getCheckpoints(): Promise<void> {
        if (!this.agentEngine) {
            logger.info('[ChatPanel]', 'getCheckpoints: agentEngine not available');
            this.panel.webview.postMessage({
                command: 'checkpointsList',
                checkpoints: []
            });
            return;
        }

        const checkpointManager = this.agentEngine.getCheckpointManager();
        if (!checkpointManager) {
            logger.info('[ChatPanel]', 'getCheckpoints: checkpointManager not available');
            this.panel.webview.postMessage({
                command: 'checkpointsList',
                checkpoints: []
            });
            return;
        }

        const checkpoints = checkpointManager.getCheckpoints();
        logger.info('[ChatPanel]', `getCheckpoints: found ${checkpoints.length} checkpoints`);
        this.panel.webview.postMessage({
            command: 'checkpointsList',
            checkpoints: checkpoints.map(cp => ({
                id: cp.id,
                timestamp: cp.timestamp,
                stepDescription: cp.stepDescription,
                stepId: cp.stepId,
                fileCount: cp.workspaceSnapshot.files.length,
            }))
        });
    }

    private async compareCheckpoint(checkpointId: string): Promise<void> {
        if (!this.agentEngine) {
            return;
        }

        const checkpointManager = this.agentEngine.getCheckpointManager();
        if (!checkpointManager) {
            vscode.window.showErrorMessage('Checkpoint manager not available');
            return;
        }

        try {
            const diffs = await checkpointManager.compareWithCurrent(checkpointId);

            if (diffs.length === 0) {
                vscode.window.showInformationMessage('No differences found between checkpoint and current workspace.');
                return;
            }

            // Diff 뷰 표시
            const checkpoint = checkpointManager.getCheckpoints().find(cp => cp.id === checkpointId);
            if (!checkpoint) {
                return;
            }

            // 첫 번째 변경된 파일의 diff 표시
            const firstDiff = diffs[0];
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            const currentUri = vscode.Uri.joinPath(workspaceFolder.uri, firstDiff.path);
            const snapshotUri = vscode.Uri.parse(`tokamak-checkpoint:${checkpointId}/${firstDiff.path}`);

            // TextDocumentContentProvider로 스냅샷 내용 제공
            const provider = new (class implements vscode.TextDocumentContentProvider {
                provideTextDocumentContent(uri: vscode.Uri): string {
                    const [, cpId, ...pathParts] = uri.path.split('/');
                    const filePath = pathParts.join('/');
                    const cp = checkpointManager.getCheckpoints().find(c => c.id === cpId);
                    const fileSnapshot = cp?.workspaceSnapshot.files.find(f => f.path === filePath);
                    return fileSnapshot?.content || '';
                }
            })();

            const disposable = vscode.workspace.registerTextDocumentContentProvider('tokamak-checkpoint', provider);
            await vscode.commands.executeCommand('vscode.diff', snapshotUri, currentUri, `[CHECKPOINT] ${firstDiff.path}`);
            setTimeout(() => disposable.dispose(), 10000);

            if (diffs.length > 1) {
                vscode.window.showInformationMessage(
                    `${diffs.length} files changed. Showing first file. Use checkpoint panel to view others.`
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to compare checkpoint: ${error}`);
        }
    }

    private async restoreCheckpoint(checkpointId: string, workspaceOnly: boolean): Promise<void> {
        if (!this.agentEngine) {
            return;
        }

        const checkpointManager = this.agentEngine.getCheckpointManager();
        if (!checkpointManager) {
            vscode.window.showErrorMessage('Checkpoint manager not available');
            return;
        }

        try {
            const checkpoint = checkpointManager.getCheckpoints().find(cp => cp.id === checkpointId);
            if (!checkpoint) {
                vscode.window.showErrorMessage('Checkpoint not found');
                return;
            }

            const confirmed = await vscode.window.showWarningMessage(
                `Are you sure you want to restore checkpoint "${checkpoint.stepDescription || checkpointId}"? ` +
                `This will ${workspaceOnly ? 'restore workspace files only' : 'restore workspace and task state'}.`,
                { modal: true },
                'Yes',
                'Cancel'
            );

            if (confirmed === 'Yes') {
                await checkpointManager.restoreCheckpoint(checkpointId, workspaceOnly);

                if (!workspaceOnly && checkpoint.planSnapshot) {
                    // Plan도 복원
                    this.agentEngine.setPlanFromResponse(JSON.stringify(checkpoint.planSnapshot));
                }

                vscode.window.showInformationMessage('Checkpoint restored successfully');

                // 체크포인트 목록 새로고침
                await this.getCheckpoints();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to restore checkpoint: ${error}`);
        }
    }

    private async deleteCheckpoint(checkpointId: string): Promise<void> {
        if (!this.agentEngine) {
            return;
        }

        const checkpointManager = this.agentEngine.getCheckpointManager();
        if (!checkpointManager) {
            vscode.window.showErrorMessage('Checkpoint manager not available');
            return;
        }

        try {
            const confirmed = await vscode.window.showWarningMessage(
                'Are you sure you want to delete this checkpoint?',
                { modal: true },
                'Yes',
                'Cancel'
            );

            if (confirmed === 'Yes') {
                await checkpointManager.deleteCheckpoint(checkpointId);
                vscode.window.showInformationMessage('Checkpoint deleted');

                // 체크포인트 목록 새로고침
                await this.getCheckpoints();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete checkpoint: ${error}`);
        }
    }

    private async previewFileOperation(index: number): Promise<void> {
        const operation = this.pendingOperations[index];
        if (!operation) return;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, operation.path);

        try {
            if (operation.type === 'create') {
                const emptyUri = vscode.Uri.parse('untitled:empty');
                const proposedUri = vscode.Uri.parse(`tokamak-preview:${operation.path}`);
                let proposedContent = operation.content || '';
                // 제어문자 제거 (diff 미리보기용)
                proposedContent = removeControlCharacterArtifacts(proposedContent);

                const provider = new (class implements vscode.TextDocumentContentProvider {
                    provideTextDocumentContent(): string { return proposedContent; }
                })();

                const disposable = vscode.workspace.registerTextDocumentContentProvider('tokamak-preview', provider);
                await vscode.commands.executeCommand('vscode.diff', emptyUri, proposedUri, `[CREATE] ${operation.path}`);
                setTimeout(() => disposable.dispose(), 5000);

            } else if (operation.type === 'prepend' || operation.type === 'append') {
                try {
                    const existingData = await vscode.workspace.fs.readFile(fileUri);
                    const existingContent = Buffer.from(existingData).toString('utf8');
                    const text = removeControlCharacterArtifacts((operation.content || '').trim());
                    const proposedContent = operation.type === 'prepend'
                        ? text + '\n\n' + existingContent
                        : existingContent.trimEnd() + '\n\n' + text;
                    const normalize = (s: string) => s.replace(/\r\n|\r/g, '\n').trim();
                    if (normalize(existingContent) === normalize(proposedContent)) {
                        vscode.window.showInformationMessage(`[${operation.type}] ${operation.path}: 적용 예정 내용이 현재와 동일합니다.`);
                        return;
                    }
                    const provider = new (class implements vscode.TextDocumentContentProvider {
                        provideTextDocumentContent(): string { return proposedContent; }
                    })();
                    const disposable = vscode.workspace.registerTextDocumentContentProvider('tokamak-preview', provider);
                    const proposedUri = vscode.Uri.parse(`tokamak-preview:${operation.path}`);
                    await vscode.commands.executeCommand('vscode.diff', fileUri, proposedUri, `[${operation.type}] ${operation.path}`);
                    setTimeout(() => disposable.dispose(), 5000);
                } catch (error) {
                    vscode.window.showErrorMessage(`Preview failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            } else if (operation.type === 'write_full') {
                try {
                    const existingData = await vscode.workspace.fs.readFile(fileUri);
                    const existingContent = Buffer.from(existingData).toString('utf8');
                    let proposedContent = removeControlCharacterArtifacts(operation.content || '');
                    const normalize = (s: string) => s.replace(/\r\n|\r/g, '\n').trim();
                    if (normalize(existingContent) === normalize(proposedContent)) {
                        vscode.window.showInformationMessage(`[write_full] ${operation.path}: 적용 예정 내용이 현재 파일과 동일합니다.`);
                        return;
                    }
                    const provider = new (class implements vscode.TextDocumentContentProvider {
                        provideTextDocumentContent(): string { return proposedContent; }
                    })();
                    const disposable = vscode.workspace.registerTextDocumentContentProvider('tokamak-preview', provider);
                    const proposedUri = vscode.Uri.parse(`tokamak-preview:${operation.path}`);
                    await vscode.commands.executeCommand('vscode.diff', fileUri, proposedUri, `[write_full] ${operation.path}`);
                    setTimeout(() => disposable.dispose(), 5000);
                } catch (error) {
                    vscode.window.showErrorMessage(`Preview failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            } else if (operation.type === 'edit' || operation.type === 'replace') {
                try {
                    const existingData = await vscode.workspace.fs.readFile(fileUri);
                    const existingContent = Buffer.from(existingData).toString('utf8');
                    let proposedContent = operation.content || '';

                    // 1. Explicit SEARCH and REPLACE parameters
                    if (operation.search && operation.replace !== undefined) {
                        let searchContent = removeControlCharacterArtifacts(operation.search);
                        let replaceContent = removeControlCharacterArtifacts(operation.replace);

                        if (searchContent !== replaceContent && existingContent.includes(searchContent)) {
                            proposedContent = existingContent.replace(searchContent, replaceContent);
                        } else if (!existingContent.includes(searchContent)) {
                            vscode.window.showErrorMessage(`[${operation.type}] ${operation.path}: 찾을 코드가 파일 내에 존재하지 않습니다. Diff를 표시할 수 없습니다.`);
                            return;
                        } else {
                            proposedContent = existingContent;
                        }
                    }
                    // 2. Legacy <<<<<<< SEARCH inside content
                    else if (proposedContent.includes('<<<<<<< SEARCH')) {
                        const blocks = proposedContent.split('>>>>>>> REPLACE');
                        let result = existingContent;
                        for (const block of blocks) {
                            if (!block.trim()) continue;
                            const searchParts = block.split('=======');
                            if (searchParts.length !== 2) continue;
                            let searchContent = searchParts[0].split('<<<<<<< SEARCH')[1]?.trim();
                            let replaceContent = searchParts[1]?.trim();
                            // 제어문자 제거
                            if (searchContent) searchContent = removeControlCharacterArtifacts(searchContent);
                            if (replaceContent) replaceContent = removeControlCharacterArtifacts(replaceContent);

                            if (searchContent !== undefined && replaceContent !== undefined) {
                                // SEARCH와 REPLACE가 동일하면 스킵 (불필요한 변경 방지)
                                if (searchContent === replaceContent) {
                                    continue;
                                }
                                // 의심스러운 코드 삭제 감지
                                const searchLines = searchContent.split('\n').length;
                                const replaceLines = replaceContent.split('\n').length;
                                const searchLength = searchContent.length;
                                const replaceLength = replaceContent.length;

                                if (replaceContent === '' ||
                                    (searchLines > 3 && replaceLines === 0) ||
                                    (searchLength > 100 && replaceLength < searchLength * 0.3)) {
                                    // 미리보기에서는 표시하되 실제 적용은 스킵됨
                                    continue;
                                }

                                if (result.includes(searchContent)) {
                                    result = result.replace(searchContent, replaceContent);
                                }
                            }
                        }
                        proposedContent = result;
                    }
                    // 3. Just content, try fuzzy snippet fallback
                    else {
                        const fallbackContent = this.applySnippetFallback(existingContent, proposedContent);
                        if (fallbackContent !== null) {
                            proposedContent = fallbackContent;
                        } else {
                            // 너무 짧은 수정은 에러 처리하여 프리뷰에서도 막음
                            if (existingContent.length > 200 && proposedContent.length < existingContent.length * 0.5) {
                                vscode.window.showErrorMessage(
                                    `[${operation.type}] ${operation.path}: AI가 잘못된 포맷으로 코드 수정(일부분)만 요청했습니다. 코드 매칭도 실패하여 차단합니다.`
                                );
                                return; // Diff 창을 띄우지 않음.
                            } else {
                                // 기존과 완전히 대체 (write_full 처럼)
                                // proposedContent는 이미 operation.content가 들어있음
                            }
                        }
                    }

                    // 최종적으로 제어문자 제거 (diff 미리보기용)
                    proposedContent = removeControlCharacterArtifacts(proposedContent);

                    // 변경 전/후가 동일하면 diff 창을 열지 않음 (Apply 전에 이미 적용됐거나 내용 동일 시)
                    const normalize = (s: string) => s.replace(/\r\n|\r/g, '\n').trim();
                    if (normalize(existingContent) === normalize(proposedContent)) {
                        vscode.window.showInformationMessage(`[EDIT] ${operation.path}: 적용 예정 내용이 현재 파일과 동일합니다. Diff를 건너뜁니다.`);
                        return;
                    }

                    const provider = new (class implements vscode.TextDocumentContentProvider {
                        provideTextDocumentContent(): string { return proposedContent; }
                    })();

                    const disposable = vscode.workspace.registerTextDocumentContentProvider('tokamak-preview', provider);
                    const proposedUri = vscode.Uri.parse(`tokamak-preview:${operation.path}`);

                    await vscode.commands.executeCommand('vscode.diff', fileUri, proposedUri, `[EDIT] ${operation.path}`);
                    setTimeout(() => disposable.dispose(), 5000);
                } catch (error) {
                    vscode.window.showErrorMessage(`Preview failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            } else if (operation.type === 'delete') {
                await vscode.window.showTextDocument(fileUri, { preview: true });
                vscode.window.showWarningMessage(`This file will be deleted: ${operation.path}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Could not preview: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleUserMessage(text: string, attachedFiles: string[], attachedImages: string[] = []): Promise<void> {
        if (!text && attachedFiles.length === 0 && attachedImages.length === 0) return;

        // [Phase 4] 엔진에 사용자 입력 업데이트
        if (this.agentEngine) {
            this.agentEngine.updateContext({ userInput: text });
        }

        const messageId = Date.now().toString();
        if (!(await isConfigured())) {
            const configured = await promptForConfiguration();
            if (!configured) {
                this.panel.webview.postMessage({
                    command: 'addMessage',
                    role: 'assistant',
                    content: `⚙️ **설정이 필요합니다**

Tokamak AI를 사용하려면 API 설정이 필요합니다.

**설정 방법:**
1. \`Cmd + ,\` (Mac) / \`Ctrl + ,\` (Windows)로 설정 열기
2. \`tokamak\` 검색
3. \`API Key\` 입력 (Base URL은 \`https://api.ai.tokamak.network\`로 고정)

또는 \`Cmd + Shift + P\` → "Preferences: Open Settings (JSON)"에서:
\`\`\`json
{
  "tokamak.apiKey": "your-api-key"
}
\`\`\``,
                });
                return;
            }
        }

        // Cancel previous request if exists
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
        }

        // Parse slash commands
        const { command: slashCommand, remainingText } = matchSlashCommand(text, await getAllSkills(vscode.workspace.workspaceFolders?.[0]));
        let processedText = text;
        if (slashCommand) {
            processedText = remainingText
                ? `${slashCommand.prompt} \n\nAdditional context: ${remainingText} `
                : slashCommand.prompt;
        }

        // Resolve @mentions in the message
        let mentionContexts = '';
        try {
            const mentionResult = await this.mentionProvider.resolveAllMentions(processedText);
            processedText = mentionResult.processedText;
            if (mentionResult.resolvedContexts.length > 0) {
                mentionContexts = '\n--- Mentioned Context ---\n' + mentionResult.resolvedContexts.join('\n') + '\n';
            }
        } catch { /* mention resolution failed, continue with original text */ }

        let fileContexts = '';
        for (const filePath of attachedFiles) {
            fileContexts += await this.getFileContent(filePath);
        }

        const editorContext = (attachedFiles.length === 0 && attachedImages.length === 0) ? this.getEditorContext() : '';
        const userMessageWithContext = `${processedText}${fileContexts}${editorContext}${mentionContexts} `;

        // Create multimodal content if images are present
        let content: string | any[] = userMessageWithContext;
        if (attachedImages.length > 0) {
            content = [
                { type: 'text', text: userMessageWithContext },
                ...attachedImages.map(img => ({
                    type: 'image_url',
                    image_url: { url: img }
                }))
            ];
        }

        // PreMessage hook
        try {
            const preMessageHooks = this.hookConfigLoader.getHooksForEvent('PreMessage');
            if (preMessageHooks.length > 0) {
                const hookInput = {
                    event: 'PreMessage' as const,
                    message: typeof content === 'string' ? content : JSON.stringify(content),
                    timestamp: Date.now(),
                };
                const hookResult = await this.hookRunner.runHooks(preMessageHooks, hookInput);
                if (!hookResult.allowed) {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: '⚠️ Message blocked by PreMessage hook.',
                    });
                    this.panel.webview.postMessage({ command: 'endStreaming' });
                    return;
                }
            }
        } catch { /* hooks not configured */ }

        this.chatHistory.push({ role: 'user', content: content });

        // 첨부된 파일 내용을 채팅창에 표시
        let displayText = text;
        if (attachedFiles.length > 0) {
            displayText += '\n\n';
            for (const filePath of attachedFiles) {
                const fileContent = await this.getFileContent(filePath);
                // 파일 내용을 코드 블록으로 감싸서 표시
                const language = this.getLanguageFromPath(filePath);
                displayText += `\n\n**📎 ${filePath}**\n\`\`\`${language}\n${fileContent.replace(/^---.*?---\n/s, '').trim()}\n\`\`\`\n`;
            }
        }
        if (attachedImages.length > 0) {
            const currentModel = getSelectedModel();
            if (isVisionCapable(currentModel)) {
                displayText += `\n\n🖼️ ${attachedImages.length}개 이미지 첨부됨`;
            } else {
                displayText += `\n\n⚠️ ${attachedImages.length}개 이미지 첨부됨 — **${currentModel}** 모델은 vision을 지원하지 않습니다. 이미지는 전송되지 않습니다.`;
            }
        }

        // Send user message to UI
        this.panel.webview.postMessage({ command: 'addMessage', role: 'user', content: displayText });

        // Start streaming indicator
        this.panel.webview.postMessage({ command: 'startStreaming' });

        // Create AbortController for this request (capture as local variable!)
        const abortController = new AbortController();
        this.currentAbortController = abortController;
        const signal = abortController.signal;

        try {
            let loopCount = 0;
            const maxLoops = 10;
            let needsMoreContext = true;

            const hints = resolveHints(getSelectedModel());

            // Build active rules for prompt
            let activeRulesSection = '';
            try {
                const allRules = this.ruleLoader.getRules();
                if (allRules.length > 0) {
                    const editor = vscode.window.activeTextEditor;
                    const currentLang = editor?.document.languageId || 'typescript';
                    const active = getActiveRules(allRules, currentLang, this.currentMode);
                    if (active.length > 0) {
                        activeRulesSection = formatRulesForPrompt(active);
                    }
                }
            } catch { /* rules not loaded yet */ }

            // Build MCP tools section for prompt
            let mcpToolsSection = '';
            try {
                const allTools: import('../mcp/mcpTypes.js').McpTool[] = [];
                for (const client of this.mcpClients.values()) {
                    if (client.isConnected()) {
                        const tools = await client.listTools();
                        allTools.push(...tools);
                    }
                }
                if (allTools.length > 0) {
                    mcpToolsSection = formatToolsForPrompt(allTools);
                }
            } catch { /* MCP not configured */ }

            // Browser action docs (if enabled)
            const settings = getAutoApprovalConfig();
            let browserDocs = '';
            try {
                const { getSettings } = await import('../config/settings.js');
                if (getSettings().enableBrowser) {
                    browserDocs = getBrowserActionDocs();
                }
            } catch { /* browser not enabled */ }

            // Auto-collect project knowledge
            let autoKnowledge = '';
            try {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const files = new Map<string, string>();
                    const knownFiles = ['package.json', 'tsconfig.json', 'README.md', 'Dockerfile', 'pyproject.toml', 'Cargo.toml'];
                    for (const name of knownFiles) {
                        try {
                            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, name);
                            const data = await vscode.workspace.fs.readFile(fileUri);
                            files.set(name, Buffer.from(data).toString('utf8'));
                        } catch { /* file not found */ }
                    }
                    if (files.size > 0) {
                        const facts = this.autoCollector.collectAll(files);
                        autoKnowledge = this.autoCollector.formatForPrompt(facts, 2000);
                    }
                }
            } catch { /* auto-collection failed */ }

            const ctx: PromptContext = {
                workspaceInfo: this.getWorkspaceInfo(),
                projectStructure: await this.getProjectStructure(),
                projectKnowledge: (await this.getProjectKnowledge()) + (autoKnowledge ? `\n${autoKnowledge}` : ''),
                variant: hints.variant,
                hints,
                activeRules: activeRulesSection || undefined,
                mcpToolsSection: mcpToolsSection || undefined,
                browserActionDocs: browserDocs || undefined,
            };
            const systemMessage: ChatMessage = {
                role: 'system',
                content: buildModePrompt(this.currentMode, ctx),
            };

            while (needsMoreContext && loopCount < maxLoops) {
                loopCount++;
                let fullResponse = '';

                // Context compression before streaming
                let messagesToSend: ChatMessage[] = [systemMessage, ...this.chatHistory];
                const contextWindowSize = 32000; // Default context window estimate
                if (needsCompression(messagesToSend, contextWindowSize)) {
                    logger.info('[ChatPanel]', 'Context compression triggered');
                    const summarizeFn = async (prompt: string): Promise<string> => {
                        const summaryResult = streamChatCompletion([{ role: 'user', content: prompt }], signal);
                        let summary = '';
                        for await (const chunk of summaryResult.content) { summary += chunk; }
                        return summary;
                    };
                    const compressionResult = await compressMessages(messagesToSend, contextWindowSize, summarizeFn);
                    if (compressionResult.summaryInserted) {
                        messagesToSend = compressionResult.messages as ChatMessage[];
                        logger.info('[ChatPanel]', `Compressed: ${compressionResult.originalCount} → ${compressionResult.compressedCount} messages`);
                    }
                }

                const streamResult = streamChatCompletion(messagesToSend, signal);

                // Reset streaming diff parser for this response
                this.streamingDiffParser.reset();

                for await (const chunk of streamResult.content) {
                    if (signal.aborted) {
                        break;
                    }
                    fullResponse += chunk;

                    // Streaming diff detection
                    const feedResult = this.streamingDiffParser.feed(chunk);
                    if (feedResult.textContent) {
                        this.panel.webview.postMessage({ command: 'streamChunk', content: feedResult.textContent });
                    }
                    if (feedResult.operation && feedResult.operation.path) {
                        this.panel.webview.postMessage({
                            command: 'streamOperationChunk',
                            operation: {
                                state: feedResult.operation.state,
                                type: feedResult.operation.type,
                                path: feedResult.operation.path,
                                contentSoFar: feedResult.operation.contentSoFar,
                                isComplete: feedResult.operation.isComplete,
                            },
                        });
                    }
                }

                // Get token usage after streaming completes
                const usage = await streamResult.usage;
                if (usage) {
                    this.panel.webview.postMessage({
                        command: 'updateTokenUsage',
                        usage: {
                            prompt: usage.promptTokens,
                            completion: usage.completionTokens,
                            total: usage.totalTokens,
                        },
                    });
                }

                if (signal.aborted) break;

                this.chatHistory.push({ role: 'assistant', content: fullResponse });

                // PostMessage hook
                try {
                    const postMessageHooks = this.hookConfigLoader.getHooksForEvent('PostMessage');
                    if (postMessageHooks.length > 0) {
                        const hookInput = {
                            event: 'PostMessage' as const,
                            message: fullResponse,
                            timestamp: Date.now(),
                        };
                        await this.hookRunner.runHooks(postMessageHooks, hookInput);
                    }
                } catch { /* hooks not configured */ }

                needsMoreContext = false;

                // [Phase 1 통합] Plan 모드인 경우 AgentEngine에 전달
                if (this.currentMode === 'plan' && this.agentEngine) {
                    this.agentEngine.setPlanForDisplay(fullResponse);
                    // Multi-model debate가 활성화되어 있으면 debate 시작
                    if (getEnableMultiModelReview() && this.agentEngine) {
                        this.agentEngine.startDebateForPlan().catch(err => {
                            logger.error('[ChatPanel]', 'Debate for plan failed', err);
                        });
                    }
                }

                // Handle MCP tool calls in response
                try {
                    const mcpCalls = parseMcpToolCalls(fullResponse);
                    if (mcpCalls.length > 0) {
                        needsMoreContext = true;
                        let mcpResults = '\n--- MCP Tool Results ---\n';
                        for (const call of mcpCalls) {
                            this.panel.webview.postMessage({
                                command: 'addMessage',
                                role: 'assistant',
                                content: `🔧 *Calling MCP tool: ${call.toolName}*`,
                            });
                            // Find the right client for this tool
                            for (const client of this.mcpClients.values()) {
                                try {
                                    const result = await client.callTool(call.toolName, call.args);
                                    mcpResults += formatToolResult(call.toolName, result) + '\n';
                                    break;
                                } catch { /* try next client */ }
                            }
                        }
                        this.chatHistory.push({ role: 'user', content: mcpResults });
                        this.panel.webview.postMessage({ command: 'startStreaming' });
                        continue;
                    }
                } catch { /* MCP parsing failed, continue normally */ }

                // In agent or ask mode, parse file operations
                const operations = parseFileOperations(fullResponse);

                // Agent 모드도 Ask와 동일: 파일 작업은 사용자가 "Apply Changes"를 누를 때만 적용.
                // (이전에는 Agent에서 응답 직후 자동 실행해 Apply 전에 이미 변경된 것처럼 보이는 문제가 있어 제거함)

                // Handle READ operations automatically
                const readOps = operations.filter(op => op.type === 'read');
                if (readOps.length > 0) {
                    needsMoreContext = true;
                    let readResults = '\n--- Auto-read Files Context ---\n';

                    for (const op of readOps) {
                        this.panel.webview.postMessage({
                            command: 'addMessage',
                            role: 'assistant',
                            content: `🔍 *Reading file: ${op.path}*`
                        });
                        const content = await this.getFileContent(op.path);
                        readResults += content;
                    }

                    this.chatHistory.push({ role: 'user', content: readResults });

                    // Restart streaming indicator for next turn
                    this.panel.webview.postMessage({ command: 'startStreaming' });
                    continue;
                }

                // Handle other operations (create/edit/delete) via UI
                const writeOps = operations.filter(op => op.type !== 'read');
                if (writeOps.length > 0) {
                    // Auto-approval: split into auto-approved and pending ops
                    const approvalConfig = getAutoApprovalConfig();
                    const autoApprovedOps: FileOperation[] = [];
                    const pendingOps: FileOperation[] = [];

                    for (const op of writeOps) {
                        const category = classifyOperation(op.type);
                        if (shouldAutoApprove(approvalConfig, category, op.path)) {
                            autoApprovedOps.push(op);
                        } else {
                            pendingOps.push(op);
                        }
                    }

                    // Execute auto-approved operations immediately
                    if (autoApprovedOps.length > 0) {
                        this.pendingOperations = autoApprovedOps;
                        await this.applyFileOperations();
                        this.panel.webview.postMessage({
                            command: 'addMessage',
                            role: 'assistant',
                            content: `✅ Auto-approved ${autoApprovedOps.length} operation(s): ${autoApprovedOps.map(o => o.path).join(', ')}`,
                        });
                    }

                    // Show remaining pending operations for manual approval
                    if (pendingOps.length > 0) {
                        this.pendingOperations = pendingOps;
                        this.panel.webview.postMessage({
                            command: 'showOperations',
                            operations: pendingOps.map(op => ({
                                type: op.type,
                                path: op.path,
                                description: op.description,
                            })),
                        });
                    }
                }

                this.saveChatHistory();
                this.panel.webview.postMessage({ command: 'endStreaming' });
            }
        } catch (error) {
            this.panel.webview.postMessage({ command: 'endStreaming' });

            // Handle different error types
            if (error instanceof Error) {
                if (error.name === 'AbortError' || error.message.includes('aborted')) {
                    // User cancelled - do nothing or show cancelled message
                } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: '🔑 **API Key 오류**\n\nAPI Key가 유효하지 않습니다.\n\n[설정 열기](command:workbench.action.openSettings?%22tokamak%22)에서 `tokamak.apiKey`를 확인해주세요.',
                    });
                } else if (error.message.includes('404') || error.message.includes('Not Found')) {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: '🔗 **API 엔드포인트 오류**\n\nAPI에 연결할 수 없습니다. 네트워크 연결을 확인해주세요.',
                    });
                } else if (error.message.includes('500') || error.message.includes('Internal')) {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: '⚠️ **서버 오류 (500)**\n\nAI 서버에 문제가 발생했습니다.\n\n잠시 후 다시 시도하거나, 서버 상태를 확인해주세요.\n\n모델명(`tokamak.selectedModel`)이 올바른지도 확인해보세요.',
                    });
                } else if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed') || error.message.includes('network')) {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: '🌐 **네트워크 연결 오류**\n\nAI 서버에 연결할 수 없습니다.\n\n- 인터넷 연결을 확인해주세요\n- VPN이 필요한 경우 연결되어 있는지 확인해주세요',
                    });
                } else {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: `❌ ** 오류 발생 **\n\n${error.message} \n\n문제가 계속되면 설정을 확인해주세요.`,
                    });
                }
            } else {
                this.panel.webview.postMessage({
                    command: 'addMessage',
                    role: 'assistant',
                    content: '❌ **알 수 없는 오류**가 발생했습니다. 다시 시도해주세요.',
                });
            }
        } finally {
            this.currentAbortController = null;
        }
    }

    private async insertCodeToEditor(code: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await editor.edit((editBuilder) => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage('Code inserted!');
        } else {
            vscode.window.showWarningMessage('No active editor to insert code into.');
        }
    }

    private async runInTerminal(command: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        // 여러 줄 명령어를 개별 명령어로 분리
        const commands = command
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#')); // 빈 줄과 주석 제거

        if (commands.length === 0) {
            vscode.window.showWarningMessage('No valid commands found');
            return;
        }

        // Show terminal for user visibility
        let terminal = vscode.window.terminals.find(t => t.name === 'Tokamak');
        if (!terminal) {
            terminal = vscode.window.createTerminal('Tokamak');
        }
        terminal.show();

        // 각 명령어를 순차적으로 실행
        let allOutput = '';
        let currentCwd = workspaceFolder.uri.fsPath; // 현재 작업 디렉토리 추적

        try {
            for (let i = 0; i < commands.length; i++) {
                const cmd = commands[i];

                // cd 명령어 처리 (단, && || ; 같은 연산자가 포함된 경우는 그대로 실행)
                // && || ; 가 포함된 명령어는 cd로 인식하지 않고 그대로 실행
                if (!cmd.includes('&&') && !cmd.includes('||') && !cmd.includes(';')) {
                    // cd 명령어가 정확히 "cd 경로" 형태일 때만 처리
                    const cdMatch = cmd.match(/^cd\s+([^\s&|;]+)$/);
                    if (cdMatch) {
                        const targetDir = cdMatch[1].trim();
                        // 상대 경로인 경우 현재 cwd 기준으로 해석
                        const newCwd = require('path').isAbsolute(targetDir)
                            ? targetDir
                            : require('path').join(currentCwd, targetDir);
                        currentCwd = newCwd;
                        // 터미널에만 cd 명령어 전송 (exec는 cwd 옵션으로 처리)
                        terminal.sendText(cmd);
                        allOutput += `\n--- Command ${i + 1}/${commands.length}: ${cmd} ---\n(Changed directory to: ${currentCwd})\n`;
                        continue;
                    }
                }

                // 터미널에 명령어 표시 및 실행
                terminal.sendText(cmd);

                // Execute and capture output
                vscode.window.showInformationMessage(`Running (${i + 1}/${commands.length}): ${cmd}`);

                try {
                    const { exec } = require('child_process');

                    // && || ; 같은 연산자가 포함된 명령어는 셸을 통해 실행
                    // cd 명령어도 셸 내부 명령어이므로 셸을 통해 실행해야 함
                    const shellCmd = process.platform === 'win32'
                        ? `cmd /c "${cmd}"`
                        : `/bin/bash -c "${cmd.replace(/"/g, '\\"')}"`;

                    const result = await new Promise<string>((resolve) => {
                        exec(shellCmd, { cwd: currentCwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
                            let output = '';

                            if (stdout) {
                                output += `[STDOUT]\n${stdout}\n`;
                            }

                            if (stderr) {
                                output += `[STDERR]\n${stderr}\n`;
                            }

                            if (error) {
                                output += `[ERROR] Exit code: ${error.code}\n${error.message}\n`;
                            }

                            if (!output) {
                                output = '(Command executed with no output)';
                            }

                            resolve(output);
                        });
                    });

                    allOutput += `\n--- Command ${i + 1}/${commands.length}: ${cmd} ---\n${result}\n`;

                    // 에러가 발생하면 중단 (선택적 - 필요시 계속 진행하도록 변경 가능)
                    if (result.includes('[ERROR]')) {
                        break;
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    allOutput += `\n--- Command ${i + 1}/${commands.length}: ${cmd} ---\n[ERROR] ${errorMsg}\n`;
                    break;
                }
            }

            // 모든 명령어 실행 결과를 한 번에 표시
            this.panel.webview.postMessage({
                command: 'addMessage',
                role: 'assistant',
                content: `**Commands executed:**\n\`\`\`\n${commands.join('\n')}\n\`\`\`\n\n**Results:**\n\`\`\`\n${allOutput.trim()}\n\`\`\``,
            });

            // Add to history
            this.chatHistory.push({
                role: 'assistant',
                content: `Commands: ${commands.join('; ')}\nResults:\n${allOutput.trim()}`,
            });

            this.saveChatHistory();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Command failed: ${errorMsg}`);
        }
    }

    private stopGeneration(): void {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
            this.panel.webview.postMessage({ command: 'generationStopped' });
        }
    }

    private async searchSlashCommands(query: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const allSkills = await getAllSkills(workspaceFolder);
        const filtered = filterSlashCommands(query, allSkills);
        this.panel.webview.postMessage({
            command: 'slashCommandResults',
            commands: filtered,
        });
    }

    public dispose(): void {
        ChatPanel.currentPanel = undefined;
        this.panel.dispose();

        // Clean up subsystems
        this.ruleLoader.dispose();
        this.mcpConfigManager.dispose();
        this.hookConfigLoader.dispose();
        for (const client of this.mcpClients.values()) {
            client.disconnect().catch(() => {});
        }
        this.mcpClients.clear();

        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

}