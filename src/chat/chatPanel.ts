import * as vscode from 'vscode';
import { streamChatCompletion, ChatMessage } from '../api/client.js';
import { isConfigured, promptForConfiguration, getAvailableModels, getSelectedModel, setSelectedModel, isCheckpointsEnabled } from '../config/settings.js';
import { AgentEngine } from '../agent/engine.js';
import { AgentContext } from '../agent/types.js';

type ChatMode = 'ask' | 'plan' | 'agent';

interface SlashCommand {
    name: string;
    description: string;
    prompt: string;
    isBuiltin: boolean;
}

// 기본 내장 스킬 (파일이 없을 때 사용)
const BUILTIN_SKILLS: SlashCommand[] = [
    {
        name: '/explain',
        description: 'Explain the selected code in detail',
        prompt: 'Please explain this code in detail. Include:\n1. What it does\n2. How it works\n3. Key concepts used\n4. Potential improvements',
        isBuiltin: true,
    },
    {
        name: '/refactor',
        description: 'Suggest refactoring improvements',
        prompt: 'Please suggest refactoring improvements for this code. Focus on:\n1. Code readability\n2. Performance optimizations\n3. Best practices\n4. Design patterns that could be applied',
        isBuiltin: true,
    },
    {
        name: '/fix',
        description: 'Find and fix bugs',
        prompt: 'Please analyze this code for bugs and issues. For each issue found:\n1. Describe the bug\n2. Explain why it\'s a problem\n3. Provide the fix',
        isBuiltin: true,
    },
    {
        name: '/test',
        description: 'Generate unit tests',
        prompt: 'Please generate comprehensive unit tests for this code. Include:\n1. Happy path tests\n2. Edge cases\n3. Error handling tests\nUse the appropriate testing framework for the language.',
        isBuiltin: true,
    },
    {
        name: '/docs',
        description: 'Generate documentation',
        prompt: 'Please generate documentation for this code. Include:\n1. JSDoc/docstring comments for functions\n2. Type annotations if missing\n3. Usage examples\n4. Parameter descriptions',
        isBuiltin: true,
    },
    {
        name: '/optimize',
        description: 'Optimize for performance',
        prompt: 'Please optimize this code for performance. Consider:\n1. Time complexity improvements\n2. Space complexity improvements\n3. Caching opportunities\n4. Algorithm alternatives',
        isBuiltin: true,
    },
    {
        name: '/security',
        description: 'Security audit',
        prompt: 'Please perform a security audit on this code. Check for:\n1. Common vulnerabilities (injection, XSS, etc.)\n2. Input validation issues\n3. Authentication/authorization problems\n4. Data exposure risks',
        isBuiltin: true,
    },
];

/** Cline 스타일 + prepend/append: 처음/끝에만 추가할 때 다른 코드 건드리지 않음 */
interface FileOperation {
    type: 'create' | 'edit' | 'delete' | 'read' | 'write_full' | 'replace' | 'prepend' | 'append';
    path: string;
    content?: string;
    description: string;
    search?: string;
    replace?: string;
}

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

    public static setContext(context: vscode.ExtensionContext): void {
        ChatPanel.extensionContext = context;
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Restore chat history
        this.restoreChatHistory();

        this.panel.webview.html = this.getHtmlContent();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (message) => this.handleMessage(message),
            null,
            this.disposables
        );

        this.initAgentEngine();
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
                console.log(`[ChatPanel] Checkpoint created callback: ${checkpointId}`);
                this.panel.webview.postMessage({ command: 'checkpointCreated', checkpointId });
                // 즉시 checkpoints 목록 새로고침
                this.getCheckpoints();
            }
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
            console.error('Error resolving file path:', error);
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

    private async getSystemPromptForMode(): Promise<string> {
        const workspaceInfo = this.getWorkspaceInfo();
        const projectStructure = await this.getProjectStructure();
        const projectKnowledge = await this.getProjectKnowledge();

        switch (this.currentMode) {
            case 'ask':
                return `You are a helpful coding assistant integrated with VS Code.${workspaceInfo}
${projectStructure}
${projectKnowledge}

General Rules:
- Analyze provided context and the project structure.
- If you need to see a file's content that is not provided, DO NOT ask the user. Use <<<FILE_OPERATION>>> with TYPE: read.
- Format for reading:
<<<FILE_OPERATION>>>
TYPE: read
PATH: relative/path/to/file
DESCRIPTION: reason
<<<END_OPERATION>>>
- I will automatically provide the content in the next turn.
- Be concise and helpful.`;

            case 'plan':
                return `You are a software architect integrated with VS Code.${workspaceInfo}

--- Project Structure ---
The following is the directory structure of the current workspace. Use this to identify files you might need to read.
${projectStructure}
${projectKnowledge}

Your role is to help the user plan their coding tasks.
- Analyze the codebase using the project structure and 'read' operations.
- CRITICAL: Use <<<FILE_OPERATION>>> with TYPE: read to see file contents. DO NOT ask the user.
- Break down tasks into clear steps.
- List files to be modified/created.
- DO NOT write actual code, only the plan.

Format your response as:
1. Overview
2. Steps (numbered)
3. Files to modify/create
4. Potential challenges
5. Testing considerations`;

            case 'agent':
                return `You are an autonomous coding agent integrated with VS Code.${workspaceInfo}
${projectStructure}
${projectKnowledge}

You can perform file operations (Cline-style: two clear options for edits).

<<<FILE_OPERATION>>>
TYPE: create|write_full|replace|prepend|append|delete|read
PATH: relative/path/to/file
DESCRIPTION: Brief description of the change
CONTENT:
\`\`\`
content or diff (see rules below)
\`\`\`
<<<END_OPERATION>>>

**Add only at start or end (nothing else is modified):**
- **prepend**: Add CONTENT at the very beginning of the file. CONTENT = only the text to add (e.g. "안녕하세요"). Use for: "처음에 X 넣어줘", "맨 앞에 추가", "add X at the beginning".
- **append**: Add CONTENT at the very end of the file. CONTENT = only the text to add. Use for: "끝에 X 넣어줘", "맨 뒤에 추가", "add X at the end".

**Other edits:**
- **write_full**: Replace the ENTIRE file. CONTENT = complete new file. Only when user asks to replace/rewrite the whole file. (Do not use this just to edit a small part!)
- **edit** or **replace**: Change part of the file. You MUST provide exactly the code to find and the code to replace it with.

Rules for 'edit' or 'replace':
- Do NOT use the old \`<<<<<<< SEARCH\` format. Instead, you MUST use two separate parameters: \`SEARCH:\` (or \`<parameter name="search">\`) for the exact existing code, and \`REPLACE:\` (or \`<parameter name="replace">\`) for the new code.
- Provide enough context lines in the SEARCH block to make it uniquely identifiable.
- The SEARCH string must exactly match the file content, including all whitespace and indentation.
- If you use \`CONTENT:\` for an edit, we will try to fuzzy-match it explicitly to surrounding lines.
- 🔴 IMPORTANT FOR TEXT REPLACEMENT 🔴: If the user asks you to "change word A to B" or "rename X to Y" in the middle of a file, you CANNOT just send \`CONTENT: Y\`. You MUST use explicit \`SEARCH: A\` and \`REPLACE: B\` so the system knows what to overwrite. Do NOT use \`CONTENT\` for text replacements!

Rules:
- **"처음에/맨 앞에 X 넣어줘"** → TYPE: prepend, CONTENT: X only.
- **"끝에/맨 뒤에 X 넣어줘"** → TYPE: append, CONTENT: X only.
- For 'create', CONTENT = complete file. For 'write_full', CONTENT = complete file. For 'read', PATH only.

Example Edit Format:
<<<FILE_OPERATION>>>
TYPE: edit
PATH: src/utils/helper.ts
DESCRIPTION: Update return value
SEARCH:
\`\`\`typescript
  return 'hello';
\`\`\`
REPLACE:
\`\`\`typescript
  return 'world';
\`\`\`
<<<END_OPERATION>>>

- Always explain what you're doing before the operations.
- Ask for confirmation if the task is ambiguous.

Example:
I'll create a new utility function for you.

<<<FILE_OPERATION>>>
TYPE: create
PATH: src/utils/helper.ts
DESCRIPTION: Create helper utility function
CONTENT:
\`\`\`typescript
export function helper() {
  return 'hello';
}
\`\`\`
<<<END_OPERATION>>>`;

            default:
                return '';
        }
    }

    private parseFileOperations(response: string): FileOperation[] {
        const operations: FileOperation[] = [];

        // HTML 이스케이프 복원 (웹뷰 등에서 &lt; &gt; 로 올 수 있음)
        let raw = response.replace(/&lt;/g, '<').replace(/&gt;/g, '>');

        // minimax 등 tool_call: write_to_file (전체 쓰기), replace_in_file (부분 수정), edit (하위 호환)
        const param = (name: string) => new RegExp(`<parameter\\s+name=["']${name}["']\\s*[^>]*>([\\s\\S]*?)<\\/parameter>`, 'i');
        const parseInvoke = (inner: string, toolType: 'write_full' | 'replace' | 'edit' | 'prepend' | 'append') => {
            const pathMatch = inner.match(param('path'));
            const descMatch = inner.match(param('description'));
            const contentMatch = inner.match(param('CONTENT')) ?? inner.match(param('content'));
            const diffMatch = inner.match(param('diff'));
            const body = contentMatch?.[1]?.trim() ?? diffMatch?.[1]?.trim();

            const searchMatch = inner.match(param('search')) ?? inner.match(param('search_text'));
            const replaceMatch = inner.match(param('replace')) ?? inner.match(param('replace_text'));
            const searchCode = searchMatch?.[1]?.trim();
            const replaceCode = replaceMatch?.[1]?.trim();

            if (pathMatch && (body || (searchCode && replaceCode))) {
                const path = pathMatch[1].replace(/<[^>]+>/g, '').trim();
                const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                operations.push({
                    type: toolType,
                    path,
                    description,
                    content: body,
                    search: searchCode,
                    replace: replaceCode
                });
            }
        };
        const invokeNames: [RegExp, 'write_full' | 'replace' | 'edit' | 'prepend' | 'append'][] = [
            [/<invoke\s+name=["']write_to_file["']\s*>/gi, 'write_full'],
            [/<invoke\s+name=["']replace_in_file["']\s*>/gi, 'replace'],
            [/<invoke\s+name=["']prepend["']\s*>/gi, 'prepend'],
            [/<invoke\s+name=["']append["']\s*>/gi, 'append'],
            [/<invoke\s+name=["']edit["']\s*>/gi, 'edit'],
        ];
        for (const [invokeRe, toolType] of invokeNames) {
            let m: RegExpExecArray | null;
            while ((m = invokeRe.exec(raw)) !== null) {
                const afterInvoke = raw.slice(m.index + m[0].length);
                const closeIdx = afterInvoke.search(/<\s*\/\s*invoke\s*>/i);
                const inner = closeIdx >= 0 ? afterInvoke.slice(0, closeIdx) : afterInvoke;
                parseInvoke(inner, toolType);
            }
        }

        // 위에서 못 찾았고, 응답이 ```...``` 블록 하나로 감싸진 경우 한 번 더 시도
        if (operations.length === 0 && /<invoke\s+name=["']edit["']/i.test(raw)) {
            const m = raw.match(/```\w*\s*\n([\s\S]*?)```/);
            if (m && /<parameter\s+name=["']path["']/i.test(m[1])) {
                const innerRaw = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                const inv = /<invoke\s+name=["']edit["']\s*>/gi.exec(innerRaw);
                if (inv) {
                    const afterInvoke = innerRaw.slice(inv.index + inv[0].length);
                    const closeIdx = afterInvoke.search(/<\s*\/\s*invoke\s*>/i);
                    const inner = closeIdx >= 0 ? afterInvoke.slice(0, closeIdx) : afterInvoke;
                    const param = (name: string) => new RegExp(`<parameter\\s+name=["']${name}["']\\s*[^>]*>([\\s\\S]*?)<\\/parameter>`, 'i');
                    const pathMatch = inner.match(param('path'));
                    const descMatch = inner.match(param('description'));
                    const contentMatch = inner.match(param('CONTENT')) ?? inner.match(param('content'));
                    const searchMatch = inner.match(param('search')) ?? inner.match(param('search_text'));
                    const replaceMatch = inner.match(param('replace')) ?? inner.match(param('replace_text'));

                    const body = contentMatch?.[1]?.trim();
                    const searchCode = searchMatch?.[1]?.trim();
                    const replaceCode = replaceMatch?.[1]?.trim();

                    if (pathMatch && (body || (searchCode && replaceCode))) {
                        const path = pathMatch[1].replace(/<[^>]+>/g, '').trim();
                        const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                        operations.push({
                            type: 'edit',
                            path,
                            description,
                            content: body,
                            search: searchCode,
                            replace: replaceCode
                        });
                    }
                }
            }
        }

        // 개선된 파싱: FILE_OPERATION 블록을 더 정확하게 찾기
        // END_OPERATION 태그를 명시적으로 찾되, 없으면 다음 FILE_OPERATION 전까지 또는 문자열 끝까지
        const startPositions: number[] = [];
        const startRegex = /<<<FILE_OPERATION>>>/gi;
        let match;
        while ((match = startRegex.exec(raw)) !== null) {
            startPositions.push(match.index);
        }

        // 각 시작 위치에서 블록 파싱
        for (let i = 0; i < startPositions.length; i++) {
            const blockStart = startPositions[i] + '<<<FILE_OPERATION>>>'.length;

            // 다음 FILE_OPERATION 위치 찾기
            const nextStartPos = i < startPositions.length - 1 ? startPositions[i + 1] : raw.length;

            // END_OPERATION 태그 찾기 (blockStart부터 nextStartPos 전까지)
            const searchEnd = Math.min(nextStartPos, raw.length);
            const searchText = raw.substring(blockStart, searchEnd);
            const endRegex = /<<<END_OPERATION>>>/gi;
            const endMatch = endRegex.exec(searchText);

            let blockEnd: number;
            if (endMatch) {
                // END_OPERATION 태그가 있으면 그 전까지 (blockStart 기준으로 인덱스 조정)
                blockEnd = blockStart + endMatch.index;
            } else {
                // END_OPERATION이 없으면 다음 FILE_OPERATION 전까지 또는 문자열 끝까지
                blockEnd = nextStartPos;
            }

            const block = raw.substring(blockStart, blockEnd);

            const typeMatch = block.match(/TYPE:\s*(create|edit|delete|read|write_full|replace|prepend|append)/i);
            const pathMatch = block.match(/PATH:\s*[`'"]?([^`'"\n\r]+)[`'"]?/i);
            const descMatch = block.match(/DESCRIPTION:\s*(.+?)(?:\nCONTENT:|$)/is);

            const extractField = (fieldName: string): string | undefined => {
                const startMatch = block.match(new RegExp(`${fieldName}:\\s*`, 'i'));
                if (!startMatch) return undefined;

                const startIdx = startMatch.index! + startMatch[0].length;
                // Find next possible field marker or end of block
                let endIdx = block.length;
                const nextFieldMatch = block.substring(startIdx).match(/\n(CONTENT|SEARCH|REPLACE|DESCRIPTION|PATH|TYPE):\s*/i);
                if (nextFieldMatch) {
                    endIdx = startIdx + nextFieldMatch.index!;
                }

                let text = block.substring(startIdx, endIdx).trim();

                if (text.startsWith('```')) {
                    const firstNewline = text.indexOf('\n');
                    if (firstNewline > 0) {
                        text = text.substring(firstNewline + 1);
                    } else {
                        text = text.substring(3).trim();
                    }

                    let lastBacktickIndex = -1;
                    const lines = text.split('\n');
                    for (let i = lines.length - 1; i >= 0; i--) {
                        const trimmedLine = lines[i].trim();
                        if (trimmedLine === '```' || trimmedLine.startsWith('```')) {
                            lastBacktickIndex = text.lastIndexOf('\n' + lines[i]);
                            if (lastBacktickIndex === -1) {
                                lastBacktickIndex = text.indexOf(lines[i]);
                            }
                            break;
                        }
                    }

                    if (lastBacktickIndex >= 0) {
                        text = text.substring(0, lastBacktickIndex).trim();
                    } else {
                        text = text.trim();
                        text = text.replace(/\n*```+\s*$/m, '').replace(/```+\s*$/m, '');
                    }
                    text = text.replace(/\n*```+\s*$/m, '').trimEnd();
                } else {
                    text = text.trim();
                }

                return text;
            };

            const content = extractField('CONTENT');
            const search = extractField('SEARCH');
            const replace = extractField('REPLACE');

            if (typeMatch && pathMatch) {
                const type = typeMatch[1].toLowerCase() as FileOperation['type'];
                operations.push({
                    type: type,
                    path: pathMatch[1].trim(),
                    description: descMatch ? descMatch[1].trim() : '',
                    content: content,
                    search: search,
                    replace: replace
                });
            }
        }

        // 자동 실행 코드 제거, 백틱 정리, 제어문자 표기 제거
        for (const op of operations) {
            if (op.content && (op.type === 'create' || op.type === 'edit' || op.type === 'write_full' || op.type === 'replace' || op.type === 'prepend' || op.type === 'append')) {
                op.content = this.removeAutoExecutionCode(op.content, op.path);
                op.content = this.removeTrailingBackticks(op.content);
                op.content = this.removeControlCharacterArtifacts(op.content);
            }
        }

        return operations;
    }

    /** 코드 끝에 남아있는 백틱(```) 제거 */
    private removeTrailingBackticks(content: string): string {
        if (!content) return content;
        let cleaned = content;
        // 끝에 있는 백틱 제거 (줄바꿈 포함)
        cleaned = cleaned.replace(/\n*```+\s*$/m, '');
        cleaned = cleaned.replace(/```+\s*$/m, '');
        // 여러 줄의 백틱 제거
        cleaned = cleaned.replace(/(\n```+\s*)+$/m, '');
        return cleaned.trimEnd();
    }

    /** AI 응답에 붙는 제어문자 표기(<ctrl46> 등) 및 실제 제어문자 제거 */
    private removeControlCharacterArtifacts(content: string): string {
        if (!content) return content;
        let cleaned = content;
        // VS Code 등에서 제어문자를 표시할 때 쓰는 <ctrlNN> 형태 완전 제거
        cleaned = cleaned.replace(/<ctrl\d+>/gi, ''); // 모든 <ctrl숫자> 제거
        cleaned = cleaned.replace(/\s*<ctrl\d+>\s*/gi, ''); // 공백 포함 제거
        // 실제 ASCII 제어문자 제거 (줄바꿈\n, 탭\t, 캐리지리턴\r 제외)
        cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        // 연속된 빈 줄 정리
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
        return cleaned.trimEnd();
    }

    /** 테스트 파일 등에서 자동 실행 코드(run(), main() 등) 제거 */
    private removeAutoExecutionCode(content: string, filePath: string): string {
        if (!content) return content;

        // 테스트 파일인지 확인 (경로에 test/spec 포함 또는 확장자 확인)
        const isTestFile = /test|spec/i.test(filePath) ||
            /\.(test|spec)\.(ts|js|tsx|jsx|py|go|java)$/i.test(filePath);

        // 모든 파일에서 제거하되, 테스트 파일은 더 엄격하게
        let cleaned = content;

        // JavaScript/TypeScript 패턴 제거
        // run(); 또는 run() (줄 끝)
        cleaned = cleaned.replace(/^\s*run\(\)\s*;?\s*$/gm, '');
        // function run() { ... } run(); 패턴
        cleaned = cleaned.replace(/\n\s*function\s+run\(\)\s*\{[\s\S]*?\}\s*\n\s*run\(\)\s*;?\s*$/m, '');
        // const run = () => { ... }; run(); 패턴
        cleaned = cleaned.replace(/\n\s*(const|let|var)\s+run\s*=\s*[^;]+;\s*\n\s*run\(\)\s*;?\s*$/m, '');

        // main() 호출 제거
        cleaned = cleaned.replace(/^\s*main\(\)\s*;?\s*$/gm, '');

        // Python 패턴 제거
        cleaned = cleaned.replace(/\n\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:\s*\n[\s\S]*$/m, '');

        // Node.js 패턴 제거
        cleaned = cleaned.replace(/\n\s*if\s+require\.main\s*===\s*module\s*\{[\s\S]*?\}\s*$/m, '');

        // "All tests passed" 같은 메시지와 함께 있는 run() 호출 제거
        cleaned = cleaned.replace(/\n\s*console\.log\(['"]All tests passed['"]\)\s*;?\s*\n\s*run\(\)\s*;?\s*$/m, '');
        cleaned = cleaned.replace(/\n\s*console\.log\(['"]All tests passed['"]\)\s*;?\s*$/m, '');

        // 마지막 빈 줄 정리
        cleaned = cleaned.replace(/\n{3,}$/, '\n\n');
        cleaned = cleaned.trimEnd();

        return cleaned;
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

                        // 1. Explicit SEARCH and REPLACE parameters natively parsed
                        if (op.search && op.replace !== undefined) {
                            let trimmedSearch = this.removeControlCharacterArtifacts(op.search);
                            let trimmedReplace = this.removeControlCharacterArtifacts(op.replace);

                            if (trimmedSearch !== trimmedReplace) {
                                const searchLines = trimmedSearch.split('\n').length;
                                const replaceLines = trimmedReplace.split('\n').length;
                                const searchLength = trimmedSearch.length;
                                const replaceLength = trimmedReplace.length;

                                if (trimmedReplace === '' || (searchLines > 3 && replaceLines === 0) || (searchLength > 100 && replaceLength < searchLength * 0.3)) {
                                    vscode.window.showWarningMessage(`⚠️ 의심스러운 코드 삭제 감지: ${op.path}. 스킵합니다.`, '확인');
                                } else if (currentContent.includes(trimmedSearch)) {
                                    currentContent = currentContent.replace(trimmedSearch, trimmedReplace);
                                    anyApplied = true;
                                } else {
                                    vscode.window.showErrorMessage(`[${op.type}] ${op.path}: 찾을 코드가 파일 내에 정확히 존재하지 않습니다 (띄어쓰기/들여쓰기 확인 필요).`);
                                    errorCount++;
                                    break;
                                }
                            } else {
                                anyApplied = true; // No-op but successful
                            }
                        }
                        // 2. Legacy <<<<<<< SEARCH inside content
                        else if (op.content !== undefined && op.content.includes('<<<<<<< SEARCH')) {
                            const blocks = op.content.split(/>>>>>>> REPLACE\s*/);
                            for (const block of blocks) {
                                if (!block.includes('<<<<<<< SEARCH')) continue;
                                const parts = block.split(/=======/);
                                if (parts.length !== 2) continue;

                                let trimmedSearch = this.removeControlCharacterArtifacts(parts[0].split(/<<<<<<< SEARCH\s*/)[1].trim());
                                let trimmedReplace = this.removeControlCharacterArtifacts(parts[1].trim());

                                if (trimmedSearch && trimmedReplace !== undefined) {
                                    if (trimmedSearch === trimmedReplace) {
                                        anyApplied = true;
                                        continue;
                                    }
                                    const searchLines = trimmedSearch.split('\n').length;
                                    const replaceLines = trimmedReplace.split('\n').length;
                                    const searchLength = trimmedSearch.length;
                                    const replaceLength = trimmedReplace.length;

                                    if (trimmedReplace === '' || (searchLines > 3 && replaceLines === 0) || (searchLength > 100 && replaceLength < searchLength * 0.3)) {
                                        vscode.window.showWarningMessage(`⚠️ 의심스러운 코드 삭제 감지: ${op.path}. 스킵합니다.`, '확인');
                                        continue;
                                    }

                                    if (currentContent.includes(trimmedSearch)) {
                                        currentContent = currentContent.replace(trimmedSearch, trimmedReplace);
                                        anyApplied = true;
                                    }
                                }
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
                console.error(`Failed to stage ${op.type} for ${op.path}:`, error);
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
                            console.error(`Failed to save ${fileUri.fsPath}:`, fsError);
                        }
                    }
                }

                vscode.window.showInformationMessage(`Successfully applied and saved ${successCount} file operation(s).`);
            }
        } else {
            console.error('[ChatPanel] WorkspaceEdit failed. Check for read-only files or conflicting edits.');
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
            console.log('[ChatPanel] getCheckpoints: agentEngine not available');
            this.panel.webview.postMessage({
                command: 'checkpointsList',
                checkpoints: []
            });
            return;
        }

        const checkpointManager = this.agentEngine.getCheckpointManager();
        if (!checkpointManager) {
            console.log('[ChatPanel] getCheckpoints: checkpointManager not available');
            this.panel.webview.postMessage({
                command: 'checkpointsList',
                checkpoints: []
            });
            return;
        }

        const checkpoints = checkpointManager.getCheckpoints();
        console.log(`[ChatPanel] getCheckpoints: found ${checkpoints.length} checkpoints`);
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
                proposedContent = this.removeControlCharacterArtifacts(proposedContent);

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
                    const text = this.removeControlCharacterArtifacts((operation.content || '').trim());
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
                    let proposedContent = this.removeControlCharacterArtifacts(operation.content || '');
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
                        let searchContent = this.removeControlCharacterArtifacts(operation.search);
                        let replaceContent = this.removeControlCharacterArtifacts(operation.replace);

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
                            if (searchContent) searchContent = this.removeControlCharacterArtifacts(searchContent);
                            if (replaceContent) replaceContent = this.removeControlCharacterArtifacts(replaceContent);

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
                    proposedContent = this.removeControlCharacterArtifacts(proposedContent);

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
        const { command: slashCommand, remainingText } = await this.parseSlashCommand(text);
        let processedText = text;
        if (slashCommand) {
            processedText = remainingText
                ? `${slashCommand.prompt} \n\nAdditional context: ${remainingText} `
                : slashCommand.prompt;
        }

        let fileContexts = '';
        for (const filePath of attachedFiles) {
            fileContexts += await this.getFileContent(filePath);
        }

        const editorContext = (attachedFiles.length === 0 && attachedImages.length === 0) ? this.getEditorContext() : '';
        const userMessageWithContext = `${processedText}${fileContexts}${editorContext} `;

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
            displayText += `\n\n🖼️ ${attachedImages.length} images attached (pasted)`;
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

            const systemMessage: ChatMessage = {
                role: 'system',
                content: await this.getSystemPromptForMode(),
            };

            while (needsMoreContext && loopCount < maxLoops) {
                loopCount++;
                let fullResponse = '';

                const streamResult = streamChatCompletion(
                    [systemMessage, ...this.chatHistory],
                    signal
                );

                for await (const chunk of streamResult.content) {
                    if (signal.aborted) {
                        break;
                    }
                    fullResponse += chunk;
                    this.panel.webview.postMessage({ command: 'streamChunk', content: chunk });
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
                needsMoreContext = false;

                // [Phase 1 통합] Plan 모드인 경우 AgentEngine에 전달
                if (this.currentMode === 'plan' && this.agentEngine) {
                    await this.agentEngine.setPlanFromResponse(fullResponse);
                    // 자율 루프 시작 (현재는 플래닝 단계까지만 시뮬레이션)
                    await this.agentEngine.run();
                }

                // In agent or ask mode, parse file operations
                const operations = this.parseFileOperations(fullResponse);

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
                    // Agent 모드가 아니더라도 Plan 모드 등에서 작업이 있으면 제안할 수 있도록 함
                    this.pendingOperations = writeOps;
                    this.panel.webview.postMessage({
                        command: 'showOperations',
                        operations: writeOps.map(op => ({
                            type: op.type,
                            path: op.path,
                            description: op.description,
                        })),
                    });
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

    private async loadSkillsFromFolder(): Promise<SlashCommand[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const skillsFolder = vscode.Uri.joinPath(workspaceFolder.uri, '.tokamak', 'skills');
        const skills: SlashCommand[] = [];

        try {
            const files = await vscode.workspace.fs.readDirectory(skillsFolder);

            for (const [fileName, fileType] of files) {
                if (fileType === vscode.FileType.File && fileName.endsWith('.md')) {
                    const filePath = vscode.Uri.joinPath(skillsFolder, fileName);
                    try {
                        const content = await vscode.workspace.fs.readFile(filePath);
                        const text = Buffer.from(content).toString('utf8');

                        // 파일명에서 명령어 이름 추출 (예: explain.md → /explain)
                        const commandName = '/' + fileName.replace('.md', '');

                        // 첫 줄을 description으로, 나머지를 prompt로 사용
                        const lines = text.split('\n');
                        let description = commandName;
                        let prompt = text;

                        // YAML frontmatter 파싱 (---로 시작하는 경우)
                        if (lines[0].trim() === '---') {
                            const endIndex = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---');
                            if (endIndex > 0) {
                                const frontmatter = lines.slice(1, endIndex).join('\n');
                                const descMatch = frontmatter.match(/description:\s*(.+)/);
                                if (descMatch) {
                                    description = descMatch[1].trim();
                                }
                                prompt = lines.slice(endIndex + 1).join('\n').trim();
                            }
                        } else if (lines[0].startsWith('#')) {
                            // 첫 줄이 # 제목이면 description으로 사용
                            description = lines[0].replace(/^#+\s*/, '').trim();
                            prompt = lines.slice(1).join('\n').trim();
                        }

                        skills.push({
                            name: commandName,
                            description,
                            prompt,
                            isBuiltin: false,
                        });
                    } catch {
                        // 파일 읽기 실패 무시
                    }
                }
            }
        } catch {
            // 폴더가 없으면 빈 배열 반환
        }

        return skills;
    }

    private async getAllSkills(): Promise<SlashCommand[]> {
        const fileSkills = await this.loadSkillsFromFolder();

        // 파일 스킬이 우선, 같은 이름의 내장 스킬은 덮어씀
        const fileSkillNames = new Set(fileSkills.map(s => s.name));
        const builtinSkills = BUILTIN_SKILLS.filter(s => !fileSkillNames.has(s.name));

        return [...fileSkills, ...builtinSkills];
    }

    private async searchSlashCommands(query: string): Promise<void> {
        const allSkills = await this.getAllSkills();
        const filtered = allSkills.filter(cmd =>
            cmd.name.toLowerCase().includes(query.toLowerCase()) ||
            cmd.description.toLowerCase().includes(query.toLowerCase())
        );
        this.panel.webview.postMessage({
            command: 'slashCommandResults',
            commands: filtered,
        });
    }

    private async parseSlashCommand(text: string): Promise<{ command: SlashCommand | null; remainingText: string }> {
        const trimmed = text.trim();
        const allSkills = await this.getAllSkills();

        for (const cmd of allSkills) {
            if (trimmed.startsWith(cmd.name + ' ') || trimmed === cmd.name) {
                const remainingText = trimmed.substring(cmd.name.length).trim();
                return { command: cmd, remainingText };
            }
        }
        return { command: null, remainingText: text };
    }

    public dispose(): void {
        ChatPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tokamak Chat</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        #header {
            padding: 10px 15px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-sideBar-background);
        }
        #header-top {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }
        #header h3 {
            margin: 0;
            font-size: 1em;
            font-weight: 600;
        }
        #header label {
            font-size: 0.85em;
            opacity: 0.8;
            margin-left: auto;
        }
        #new-chat-btn {
            padding: 4px 10px;
            border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
            background-color: transparent;
            color: var(--vscode-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        #new-chat-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        #model-select {
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 0.9em;
        }
        #mode-tabs {
            display: flex;
            gap: 4px;
        }
        .mode-tab {
            padding: 6px 14px;
            border: none;
            background-color: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            border-radius: 4px;
            font-size: 0.85em;
            opacity: 0.7;
            transition: all 0.2s;
        }
        .mode-tab:hover {
            opacity: 1;
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .mode-tab.active {
            opacity: 1;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .mode-description {
            font-size: 0.8em;
            opacity: 0.6;
            margin-top: 6px;
            padding: 4px 8px;
            background-color: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
        }
        #chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 15px;
        }
        .message {
            margin-bottom: 16px;
            padding: 12px 16px;
            border-radius: 8px;
            word-wrap: break-word;
            line-height: 1.5;
        }
        .message.user {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: 40px;
        }
        .message.assistant {
            background-color: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-widget-border);
            margin-right: 40px;
        }
        .message-role {
            font-weight: bold;
            font-size: 0.85em;
            margin-bottom: 6px;
            opacity: 0.8;
        }
        pre {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 10px 0;
            position: relative;
        }
        code {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        .code-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 12px;
            background-color: var(--vscode-titleBar-activeBackground);
            border-radius: 6px 6px 0 0;
            margin-bottom: -6px;
            font-size: 0.85em;
        }
        .insert-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .insert-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .run-btn {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
            border: none;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            margin-left: 6px;
        }
        .run-btn:hover {
            opacity: 0.9;
        }
        #token-usage-bar {
            padding: 6px 15px;
            background-color: var(--vscode-editorWidget-background);
            border-top: 1px solid var(--vscode-widget-border);
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        .token-label {
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        #token-display {
            font-weight: bold;
            color: var(--vscode-charts-blue);
        }
        .token-detail {
            opacity: 0.7;
            font-size: 0.9em;
        }
        #input-container {
            padding: 15px;
            border-top: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-sideBar-background);
            position: relative;
        }
        #attached-files {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 10px;
        }
        #attached-files:empty {
            display: none;
        }
        .file-tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 4px;
            font-size: 0.85em;
        }
        .file-tag .remove-btn {
            cursor: pointer;
            opacity: 0.7;
            font-size: 1.1em;
            line-height: 1;
        }
        .file-tag .remove-btn:hover {
            opacity: 1;
        }
        .image-tag {
            display: inline-flex;
            position: relative;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            overflow: hidden;
            background: var(--vscode-editor-background);
        }
        .image-tag img {
            max-width: 80px;
            max-height: 80px;
            display: block;
            object-fit: cover;
        }
        .image-tag .remove-img {
            position: absolute;
            top: 2px;
            right: 2px;
            background: rgba(0, 0, 0, 0.6);
            color: white;
            border-radius: 50%;
            width: 16px;
            height: 16px;
            font-size: 10px;
            text-align: center;
            line-height: 16px;
            cursor: pointer;
            z-index: 10;
        }
        .file-tag .file-name {
            cursor: pointer;
        }
        .file-tag .file-name:hover {
            text-decoration: underline;
        }
        #input-wrapper {
            display: flex;
            gap: 10px;
            position: relative;
        }
        #message-input {
            flex: 1;
            padding: 10px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 6px;
            font-family: inherit;
            font-size: inherit;
            resize: none;
            min-height: 40px;
            max-height: 150px;
        }
        #message-input:focus {
            outline: 2px solid var(--vscode-focusBorder);
        }
        #send-btn {
            padding: 10px 20px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
        }
        #send-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        #send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        #stop-btn {
            display: none;
            padding: 10px 20px;
            background-color: var(--vscode-errorForeground);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
        }
        #stop-btn:hover {
            opacity: 0.9;
        }
        #stop-btn.visible {
            display: block;
        }
        .typing-indicator {
            display: none;
            padding: 10px 15px;
            font-style: italic;
            opacity: 0.7;
        }
        .typing-indicator.visible {
            display: block;
        }
        #autocomplete {
            display: none;
            position: absolute;
            bottom: 100%;
            left: 15px;
            right: 15px;
            max-height: 200px;
            overflow-y: auto;
            background-color: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 6px;
            margin-bottom: 5px;
            box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.2);
        }
        #autocomplete.visible {
            display: block;
        }
        .autocomplete-item {
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .autocomplete-item:hover,
        .autocomplete-item.selected {
            background-color: var(--vscode-list-hoverBackground);
        }
        .autocomplete-item .icon {
            opacity: 0.7;
        }
        .autocomplete-item .path {
            opacity: 0.6;
            font-size: 0.85em;
            margin-left: auto;
        }
        .autocomplete-item .desc {
            opacity: 0.6;
            font-size: 0.85em;
            margin-left: auto;
        }
        .autocomplete-item.slash-cmd .icon {
            color: var(--vscode-terminal-ansiYellow);
        }
        .hint {
            font-size: 0.8em;
            opacity: 0.6;
            margin-top: 6px;
        }
        .drop-zone {
            position: relative;
        }
        .drop-zone.drag-over {
            background-color: var(--vscode-editor-hoverHighlightBackground);
        }
        .drop-overlay {
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: var(--vscode-editor-background);
            border: 2px dashed var(--vscode-focusBorder);
            border-radius: 6px;
            justify-content: center;
            align-items: center;
            font-size: 1.1em;
            opacity: 0.95;
            z-index: 10;
        }
        .drop-zone.drag-over .drop-overlay {
            display: flex;
        }
        #operations-panel {
            display: none;
            padding: 12px 15px;
            background-color: var(--vscode-notifications-background);
            border-top: 1px solid var(--vscode-widget-border);
        }
        #operations-panel.visible {
            display: block;
        }
        #operations-panel h4 {
            margin: 0 0 10px 0;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .operation-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            margin-bottom: 6px;
            font-size: 0.85em;
        }
        .operation-item .op-type {
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.8em;
            font-weight: 600;
        }
        .operation-item .op-type.create {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }
        .operation-item .op-type.edit {
            background-color: var(--vscode-editorWarning-foreground);
            color: black;
        }
        .operation-item .op-type.write_full {
            background-color: var(--vscode-editorWarning-foreground);
            color: black;
        }
        .operation-item .op-type.replace {
            background-color: var(--vscode-charts-blue);
            color: white;
        }
        .operation-item .op-type.prepend {
            background-color: var(--vscode-charts-green);
            color: white;
        }
        .operation-item .op-type.append {
            background-color: var(--vscode-charts-green);
            color: white;
        }
        .operation-item .op-type.delete {
            background-color: var(--vscode-errorForeground);
            color: white;
        }
        .operation-item .preview-btn {
            padding: 2px 8px;
            border: 1px solid var(--vscode-widget-border);
            background-color: transparent;
            color: var(--vscode-foreground);
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.8em;
            margin-left: auto;
        }
        .operation-item .preview-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .operation-item .reject-item-btn {
            padding: 2px 6px;
            border: none;
            background-color: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 1.1em;
            opacity: 0.6;
            margin-left: 4px;
        }
        .operation-item .reject-item-btn:hover {
            opacity: 1;
            color: var(--vscode-errorForeground);
        }
        #operations-buttons {
            display: flex;
            gap: 8px;
            margin-top: 10px;
        }
        #operations-buttons button {
            padding: 6px 14px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        #apply-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        #reject-btn {
            background-color: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-widget-border)!important;
        }

        /* Sessions History Panel */
        #history-panel {
            position: fixed;
            top: 0;
            left: -300px;
            width: 300px;
            height: 100%;
            background-color: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-widget-border);
            z-index: 1000;
            transition: left 0.3s ease;
            display: flex;
            flex-direction: column;
            box-shadow: 2px 0 10px rgba(0, 0, 0, 0.2);
        }
        #history-panel.visible {
            left: 0;
        }
        #history-header {
            padding: 15px;
            border-bottom: 1px solid var(--vscode-widget-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #history-search {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-input-background);
        }
        #history-search-input {
            width: 100%;
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 0.85em;
        }
        #history-search-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        #history-search-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        #history-list {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }
        .session-item {
            padding: 10px;
            margin-bottom: 8px;
            border-radius: 6px;
            cursor: pointer;
            border: 1px solid transparent;
            position: relative;
            transition: all 0.2s;
        }
        .session-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-widget-border);
        }
        .session-item.active {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .session-title {
            font-weight: 500;
            font-size: 0.9em;
            margin-bottom: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .session-date {
            font-size: 0.75em;
            opacity: 0.6;
            margin-bottom: 4px;
        }
        .session-mode {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.7em;
            font-weight: 600;
            margin-top: 4px;
        }
        .session-mode.ask {
            background-color: var(--vscode-charts-blue);
            color: white;
        }
        .session-mode.plan {
            background-color: var(--vscode-charts-yellow);
            color: black;
        }
        .session-mode.agent {
            background-color: var(--vscode-charts-green);
            color: white;
        }
        .session-actions {
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .session-item:hover .session-actions {
            opacity: 1;
        }
        .delete-session, .export-session {
            cursor: pointer;
            padding: 4px;
            font-size: 0.9em;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        .delete-session:hover, .export-session:hover {
            opacity: 1;
        }
        .delete-session:hover {
            color: var(--vscode-errorForeground);
        }
        .export-session:hover {
            color: var(--vscode-textLink-foreground);
        }
        #history-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.3);
            z-index: 999;
        }
        #history-overlay.visible {
            display: block;
        }
        #history-btn {
            background: transparent;
            border: 1px solid var(--vscode-widget-border);
            color: var(--vscode-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        #history-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }

        /* Interactive Planner Styles */
        #plan-panel {
            display: none;
            padding: 12px 15px;
            background-color: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-widget-border);
            border-bottom: 1px solid var(--vscode-widget-border);
            max-height: 200px;
            overflow-y: auto;
        }
        #plan-panel.visible {
            display: block;
        }
        .plan-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .plan-header h4 {
            margin: 0;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .agent-status-badge {
            font-size: 0.75em;
            padding: 2px 8px;
            border-radius: 10px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .plan-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin-bottom: 6px;
            font-size: 0.85em;
            opacity: 0.8;
        }
        .plan-item.running {
            opacity: 1;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .plan-item.done {
            opacity: 0.6;
            text-decoration: line-through;
        }
        .plan-item.failed {
            color: var(--vscode-errorForeground);
            opacity: 1;
        }
        .step-icon {
            flex-shrink: 0;
            width: 16px;
            text-align: center;
        }
        .step-desc {
            flex: 1;
        }

        /* Checkpoint Panel Styles */
        #checkpoints-panel {
            display: none;
            padding: 12px 15px;
            background-color: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-widget-border);
            max-height: 300px;
            overflow-y: auto;
        }
        #checkpoints-panel.visible {
            display: block;
        }
        .checkpoints-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .checkpoints-header h4 {
            margin: 0;
            font-size: 0.9em;
        }
        .checkpoint-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            margin-bottom: 6px;
            font-size: 0.85em;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .checkpoint-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .checkpoint-info {
            flex: 1;
            min-width: 0;
        }
        .checkpoint-description {
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 2px;
        }
        .checkpoint-meta {
            font-size: 0.75em;
            opacity: 0.6;
        }
        .checkpoint-actions {
            display: flex;
            gap: 4px;
        }
        .checkpoint-btn {
            padding: 4px 8px;
            border: 1px solid var(--vscode-widget-border);
            background-color: transparent;
            color: var(--vscode-foreground);
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.75em;
        }
        .checkpoint-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .checkpoint-btn.compare {
            color: var(--vscode-textLink-foreground);
        }
        .checkpoint-btn.restore {
            color: var(--vscode-testing-iconPassed);
        }
        .checkpoint-btn.delete {
            color: var(--vscode-errorForeground);
        }
    </style>
</head>
<body>
    <div id="history-overlay"></div>
    <div id="history-panel">
        <div id="history-header">
            <h4>Chat History</h4>
            <button id="close-history" style="background:none; border:none; color:inherit; cursor:pointer; font-size:1.4em;">×</button>
        </div>
        <div id="history-search">
            <input type="text" id="history-search-input" placeholder="Search conversations...">
        </div>
        <div id="history-list"></div>
    </div>
    <div id="header">
        <div id="header-top">
            <button id="history-btn" title="Past Conversations">🕒 History</button>
            <div style="flex:1"></div>
            <h3>Tokamak AI</h3>
            <div style="flex:1"></div>
            <label for="model-select" style="font-size: 0.8em; opacity: 0.7;">Model: </label>
            <select id="model-select"></select>
            <button id="new-chat-btn" title="Start new conversation">+ New</button>
        </div>
        <div id="mode-tabs">
            <button class="mode-tab active" data-mode="ask">💬 Ask</button>
            <button class="mode-tab" data-mode="plan">📋 Plan</button>
            <button class="mode-tab" data-mode="agent">🤖 Agent</button>
        </div>
        <div class="mode-description" id="mode-description">Ask questions about your code</div>
    </div>
    <div id="chat-container"></div>
    <div class="typing-indicator" id="typing-indicator">AI is thinking...</div>
    <div id="plan-panel">
        <div class="plan-header">
            <h4>📋 Implementation Plan</h4>
            <span id="agent-status" class="agent-status-badge">Idle</span>
        </div>
        <div id="plan-list"></div>
    </div>
    <div id="checkpoints-panel">
        <div class="checkpoints-header">
            <h4>💾 Checkpoints</h4>
            <button id="refresh-checkpoints" class="checkpoint-btn" title="Refresh checkpoints">🔄</button>
        </div>
        <div id="checkpoints-list"></div>
    </div>
    <div id="operations-panel">
        <h4>⚡ Pending File Operations</h4>
        <div id="operations-list"></div>
        <div id="operations-buttons">
            <button id="apply-btn">✓ Apply Changes</button>
            <button id="reject-btn">✗ Reject</button>
        </div>
    </div>
    <div id="token-usage-bar">
        <span class="token-label">Tokens:</span>
        <span id="token-display">0</span>
        <span class="token-detail" id="token-detail">(Prompt: 0 | Completion: 0)</span>
    </div>
    <div id="input-container">
        <div id="autocomplete"></div>
        <div id="drop-zone" class="drop-zone">
            <div id="attached-files"></div>
            <div id="input-wrapper">
                <textarea id="message-input" placeholder="Ask about your code... Type @ to attach files" rows="1"></textarea>
                <button id="send-btn">Send</button>
                <button id="stop-btn">Stop</button>
            </div>
            <div class="drop-overlay">📁 Drop files here</div>
        </div>
        <div class="hint">💡 Type <strong>/</strong> for commands, <strong>@</strong> to attach files</div>
    </div>

                                                                                                                                                                                                <script>

            (function () {
            // Prevent duplicate initialization
            if (window._tokamakInitialized) {
            return;
            }
            window._tokamakInitialized = true;

            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const messageInput = document.getElementById('message-input');
            const sendBtn = document.getElementById('send-btn');
            const stopBtn = document.getElementById('stop-btn');
            const typingIndicator = document.getElementById('typing-indicator');
            const modelSelect = document.getElementById('model-select');
            const autocomplete = document.getElementById('autocomplete');
            const attachedFilesContainer = document.getElementById('attached-files');
            const modeTabs = document.querySelectorAll('.mode-tab');
            const modeDescription = document.getElementById('mode-description');
            const operationsPanel = document.getElementById('operations-panel');
            const operationsList = document.getElementById('operations-list');
            const applyBtn = document.getElementById('apply-btn');
            const rejectBtn = document.getElementById('reject-btn');
            const newChatBtn = document.getElementById('new-chat-btn');
            const historyBtn = document.getElementById('history-btn');
            const historyPanel = document.getElementById('history-panel');
            const historyList = document.getElementById('history-list');
            const historyOverlay = document.getElementById('history-overlay');
            const closeHistoryBtn = document.getElementById('close-history');
            const historySearchInput = document.getElementById('history-search-input');
            const planPanel = document.getElementById('plan-panel');
            const planList = document.getElementById('plan-list');
            const agentStatusBadge = document.getElementById('agent-status');
            const tokenDisplay = document.getElementById('token-display');
            const tokenDetail = document.getElementById('token-detail');
            const checkpointsPanel = document.getElementById('checkpoints-panel');
            const checkpointsList = document.getElementById('checkpoints-list');
            const refreshCheckpointsBtn = document.getElementById('refresh-checkpoints');

            let currentStreamingMessage = null;
            let streamingContent = '';
            let typingInterval = null;
            let attachedFiles = [];
            let autocompleteFiles = [];
            let autocompleteCommands = [];
            let autocompleteType = 'file'; // 'file' or 'command'
            let selectedAutocompleteIndex = 0;
            let mentionStartIndex = -1;
            let slashStartIndex = -1;
            let currentMode = 'ask';
            let sessionTotalTokens = 0;
            let sessionPromptTokens = 0;
            let sessionCompletionTokens = 0;
            let attachedImages = []; // Array of base64 strings

            function addImageTag(base64Data) {
            const tag = document.createElement('div');
            tag.className = 'image-tag';
            tag.innerHTML = '<img src="' + base64Data + '"><span class="remove-img">×</span>';

            tag.querySelector('.remove-img').onclick = () => {
            const index = attachedImages.indexOf(base64Data);
            if (index > -1) {
            attachedImages.splice(index, 1);
            }
            tag.remove();
            };

            attachedFilesContainer.appendChild(tag);
            attachedImages.push(base64Data);
            }

            const modeDescriptions = {
            ask: 'Ask questions about your code',
            plan: 'Plan your implementation without code changes',
            agent: 'AI will create, edit, and delete files for you'
            };

            const modePlaceholders = {
            ask: 'Ask about your code... Type @ to attach files',
            plan: 'Describe what you want to build...',
            agent: 'Tell me what to implement...'
            };

            vscode.postMessage({ command: 'ready' });

            function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
            }

            function parseMarkdown(text) {
            let result = escapeHtml(text);
            // Hide file operation blocks in display
            result = result.replace(/&lt;&lt;&lt;FILE_OPERATION&gt;&gt;&gt;[\\s\\S]*?&lt;&lt;&lt;END_OPERATION&gt;&gt;&gt;/g, '');
            result = result.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
            const escapedCode = code.trim();
            const langLabel = lang || 'code';
            const isShell = ['bash', 'shell', 'sh', 'zsh', 'powershell', 'cmd', 'python', 'python3'].includes(lang.toLowerCase());
            const runBtn = isShell ?\`<button class="run-btn" onclick="runCommand(this)">▶ Run</button>\` : '';
            // Insert 버튼 제거: Agent 모드에서는 FILE_OPERATION으로 처리되고, 일반 채팅에서도 불필요
            return \`<div class="code-header"><span>\${langLabel}</span><div>\${runBtn}</div></div><pre><code class="language-\${lang}">\${escapedCode}</code></pre>\`;
            });
            result = result.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
            result = result.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
            result = result.replace(/\\n/g, '<br>');
            return result;
            }

            function addMessage(role, content) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + role;

            const roleDiv = document.createElement('div');
            roleDiv.className = 'message-role';
            roleDiv.textContent = role === 'user' ? 'You' : 'Tokamak AI';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';

            let textContent = '';
            let images = [];

            if (typeof content === 'string') {
            textContent = content;
            } else if (Array.isArray(content)) {
            content.forEach(item => {
            if (item.type === 'text') {
            textContent += item.text;
            } else if (item.type === 'image_url') {
            images.push(item.image_url.url);
            }
            });
            }

            contentDiv.innerHTML = parseMarkdown(textContent);

            if (images.length > 0) {
            const imagesDiv = document.createElement('div');
            imagesDiv.className = 'message-images';
            imagesDiv.style.display = 'flex';
            imagesDiv.style.flexWrap = 'wrap';
            imagesDiv.style.gap = '8px';
            imagesDiv.style.marginTop = '8px';

            images.forEach(src => {
            const img = document.createElement('img');
            img.src = src;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '200px';
            img.style.borderRadius = '4px';
            img.style.cursor = 'pointer';
            img.onclick = () => window.open(src);
            imagesDiv.appendChild(img);
            });
            contentDiv.appendChild(imagesDiv);
            }

            messageDiv.appendChild(roleDiv);
            messageDiv.appendChild(contentDiv);
            chatContainer.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;

            return messageDiv;
            }

            function startStreaming() {
            // Ensure no lingering streaming state
            streamingContent = '';

            // Create new message container
            currentStreamingMessage = document.createElement('div');
            currentStreamingMessage.className = 'message assistant';

            const roleDiv = document.createElement('div');
            roleDiv.className = 'message-role';
            roleDiv.textContent = 'Tokamak AI';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';

            currentStreamingMessage.appendChild(roleDiv);
            currentStreamingMessage.appendChild(contentDiv);
            chatContainer.appendChild(currentStreamingMessage);

            typingIndicator.classList.add('visible');

            // Start animation
            let dots = 0;
            typingIndicator.textContent = 'AI is thinking';
            if (typingInterval) clearInterval(typingInterval);
            typingInterval = setInterval(() => {
            dots = (dots + 1) % 4;
            typingIndicator.textContent = 'AI is thinking' + '.'.repeat(dots);
            }, 500);

            sendBtn.style.display = 'none';
            stopBtn.classList.add('visible');
            chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            function handleStreamChunk(chunk) {
            if (!currentStreamingMessage) return;

            streamingContent += chunk;
            const contentDiv = currentStreamingMessage.querySelector('.message-content');

            // Re-render markdown only when necessary (e.g., block finished) or use a simpler update for speed
            // For now, full re-render is safer for markdown but let's ensure we are targeting the correct element
            contentDiv.innerHTML = parseMarkdown(streamingContent);

            // Auto-scroll
            chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            function endStreaming() {
            if (typingInterval) {
            clearInterval(typingInterval);
            typingInterval = null;
            }
            typingIndicator.textContent = 'AI is thinking...';

            currentStreamingMessage = null;
            typingIndicator.classList.remove('visible');
            sendBtn.disabled = false;
            sendBtn.style.display = 'block';
            stopBtn.classList.remove('visible');
            }

            // insertCode 함수 제거됨 - Insert 버튼이 더 이상 표시되지 않음

            function runCommand(btn) {
            const pre = btn.closest('.code-header').nextElementSibling;
            const command = pre.querySelector('code').textContent;
            vscode.postMessage({ command: 'runCommand', commandText: command });
            }

            function addFileTag(filePath, isDir = false) {
            if (attachedFiles.some(f => f.path === filePath)) return;

            attachedFiles.push({ path: filePath, isDir });
            const fileName = filePath.split('/').pop();

            const tag = document.createElement('span');
            tag.className = 'file-tag';
            tag.innerHTML = \`
            <span class="icon">\${isDir ? '📁' : '📄'}</span>
            <span class="file-name" data-path="\${filePath}">\${fileName}</span>
            <span class="remove-btn" data-path="\${filePath}">×</span>
            \`;

            tag.querySelector('.file-name').addEventListener('click', () => {
            vscode.postMessage({ command: 'openFile', path: filePath });
            });

            tag.querySelector('.remove-btn').addEventListener('click', () => {
            attachedFiles = attachedFiles.filter(f => f.path !== filePath);
            tag.remove();
            });

            attachedFilesContainer.appendChild(tag);
            }

            function showAutocomplete(files) {
            autocompleteFiles = files;
            autocompleteType = 'file';
            selectedAutocompleteIndex = 0;

            if (files.length === 0) {
            autocomplete.classList.remove('visible');
            return;
            }

            autocomplete.innerHTML = files.map((file, index) => \`
            <div class="autocomplete-item \${index === 0 ? 'selected' : ''}" data-index="\${index}" data-path="\${file.path}" data-isdir="\${file.isDir}">
            <span class="icon">\${file.isDir ? '📁' : '📄'}</span>
            <span class="name">\${file.name}</span>
            <span class="path">\${file.path}</span>
            </div>
            \`).join('');

            autocomplete.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
            selectAutocompleteItem(parseInt(item.dataset.index));
            });
            });

            autocomplete.classList.add('visible');
            }

            function showSlashAutocomplete(commands) {
            autocompleteCommands = commands;
            autocompleteType = 'command';
            selectedAutocompleteIndex = 0;

            if (commands.length === 0) {
            autocomplete.classList.remove('visible');
            return;
            }

            autocomplete.innerHTML = commands.map((cmd, index) => \`
            <div class="autocomplete-item slash-cmd \${index === 0 ? 'selected' : ''}" data-index="\${index}" data-name="\${cmd.name}">
            <span class="icon">⚡</span>
            <span class="name">\${cmd.name}</span>
            <span class="desc">\${cmd.description}</span>
            </div>
            \`).join('');

            autocomplete.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
            selectAutocompleteItem(parseInt(item.dataset.index));
            });
            });

            autocomplete.classList.add('visible');
            }

            function hideAutocomplete() {
            autocomplete.classList.remove('visible');
            mentionStartIndex = -1;
            slashStartIndex = -1;
            }

            function selectAutocompleteItem(index) {
            if (autocompleteType === 'file') {
            const file = autocompleteFiles[index];
            if (!file) return;

            const value = messageInput.value;
            const beforeMention = value.substring(0, mentionStartIndex);
            const afterCursor = value.substring(messageInput.selectionStart);
            messageInput.value = beforeMention + afterCursor;

            addFileTag(file.path, file.isDir);
            } else if (autocompleteType === 'command') {
            const cmd = autocompleteCommands[index];
            if (!cmd) return;

            const value = messageInput.value;
            const beforeSlash = value.substring(0, slashStartIndex);
            const afterCursor = value.substring(messageInput.selectionStart);
            messageInput.value = beforeSlash + cmd.name + ' ' + afterCursor.trimStart();
            messageInput.selectionStart = messageInput.selectionEnd = beforeSlash.length + cmd.name.length + 1;
            }

            hideAutocomplete();
            messageInput.focus();
            }

            function updateAutocompleteSelection(delta) {
            const items = autocomplete.querySelectorAll('.autocomplete-item');
            if (items.length === 0) return;

            items[selectedAutocompleteIndex].classList.remove('selected');
            selectedAutocompleteIndex = (selectedAutocompleteIndex + delta + items.length) % items.length;
            items[selectedAutocompleteIndex].classList.add('selected');
            items[selectedAutocompleteIndex].scrollIntoView({ block: 'nearest' });
            }

            let isSending = false;
            let isComposing = false; // IME 입력 중인지 추적
            
            function sendMessage() {
            if (isSending) return;

            const text = messageInput.value.trim();
            if (!text && attachedFiles.length === 0 && attachedImages.length === 0) return;

            isSending = true;
            sendBtn.disabled = true;

            vscode.postMessage({
            command: 'sendMessage',
            text: text,
            attachedFiles: attachedFiles.map(f => f.path),
            attachedImages: attachedImages
            });

            // 입력 필드를 비우고 IME 상태 리셋
            messageInput.value = '';
            messageInput.blur(); // IME 상태 리셋
            setTimeout(() => {
                messageInput.focus(); // 다시 포커스
            }, 10);
            
            messageInput.style.height = 'auto';
            attachedFiles = [];
            attachedImages = [];
            attachedFilesContainer.innerHTML = '';
            hideAutocomplete();

            // Reset flag after a short delay
            setTimeout(() => { 
            isSending = false;
            sendBtn.disabled = false;
            }, 100);
            }

            function updateModels(models, selected) {
            modelSelect.innerHTML = '';
            models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === selected) {
            option.selected = true;
            }
            modelSelect.appendChild(option);
            });
            }

            function showOperations(operations) {
            operationsList.innerHTML = operations.map((op, index) => 
            '<div class="operation-item">' +
            '<span class="op-type ' + op.type + '">' + op.type.toUpperCase() + '</span>' +
            '<span class="op-path">' + op.path + '</span>' +
            '<button class="preview-btn" data-index="' + index + '">Preview</button>' +
            '<button class="reject-item-btn" data-index="' + index + '" title="Reject this change">×</button>' +
            '</div>'
            ).join('');

            // Add preview button handlers
            operationsList.querySelectorAll('.preview-btn').forEach(btn => {
            btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            vscode.postMessage({ command: 'previewOperation', index: index });
            });
            });

            // Add individual reject button handlers
            operationsList.querySelectorAll('.reject-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            vscode.postMessage({ command: 'rejectOperation', index: index });
            });
            });

            operationsPanel.classList.add('visible');
            }

            function hideOperations() {
            operationsPanel.classList.remove('visible');
            operationsList.innerHTML = '';
            }

            // History Panel Handlers
            historyBtn.addEventListener('click', () => {
            historyPanel.classList.add('visible');
            historyOverlay.classList.add('visible');
            vscode.postMessage({ command: 'getSessions' });
            });

            const closeHistory = () => {
            historyPanel.classList.remove('visible');
            historyOverlay.classList.remove('visible');
            if (historySearchInput) {
            historySearchInput.value = '';
            }
            };

            closeHistoryBtn.addEventListener('click', closeHistory);
            historyOverlay.addEventListener('click', closeHistory);

            if (historySearchInput) {
            historySearchInput.addEventListener('input', () => {
            filterSessions();
            });
            }

            let allSessions = [];
            let currentSessionId = null;

            function renderSessions(sessions, currentId) {
            allSessions = sessions;
            currentSessionId = currentId;
            filterSessions();
            }

            function filterSessions() {
            const searchInput = document.getElementById('history-search-input');
            const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
            
            const filtered = query ? allSessions.filter(s => {
            const title = (s.title || 'New Conversation').toLowerCase();
            const date = new Date(s.timestamp).toLocaleString().toLowerCase();
            return title.includes(query) || date.includes(query);
            }) : allSessions;

            historyList.innerHTML = filtered.map(s => {
            const date = new Date(s.timestamp).toLocaleString();
            const activeClass = s.id === currentSessionId ? 'active' : '';
            const title = s.title || 'New Conversation';
            const mode = s.mode || 'ask';
            const modeLabel = mode === 'ask' ? 'ASK' : mode === 'plan' ? 'PLAN' : 'AGENT';
            return '<div class="session-item ' + activeClass + '" data-id="' + s.id + '">' +
            '<div class="session-title">' + escapeHtml(title) + '</div>' +
            '<div class="session-date">' + escapeHtml(date) + '</div>' +
            '<span class="session-mode ' + mode + '">' + modeLabel + '</span>' +
            '<div class="session-actions">' +
            '<span class="export-session" data-id="' + s.id + '" title="Export conversation">📥</span>' +
            '<span class="delete-session" data-id="' + s.id + '" title="Delete conversation">🗑️</span>' +
            '</div>' +
            '</div>';
            }).join('');

            historyList.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-session') || e.target.classList.contains('export-session')) {
            return; // Handled by separate click handlers
            } else {
            vscode.postMessage({ command: 'loadSession', sessionId: item.dataset.id });
            closeHistory();
            }
            });
            });

            historyList.querySelectorAll('.delete-session').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'deleteSession', sessionId: btn.dataset.id });
            });
            });

            historyList.querySelectorAll('.export-session').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'exportSession', sessionId: btn.dataset.id });
            });
            });
            }

            // Mode tabs
            modeTabs.forEach(tab => {
            tab.addEventListener('click', () => {
            modeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentMode = tab.dataset.mode;
            modeDescription.textContent = modeDescriptions[currentMode];
            messageInput.placeholder = modePlaceholders[currentMode];
            vscode.postMessage({ command: 'selectMode', mode: currentMode });
            
            // Agent 모드이고 checkpoint 기능이 활성화된 경우에만 체크포인트 로드 및 패널 표시
            // (설정은 서버에서 확인되므로 여기서는 일단 표시하지 않음, modeChanged 이벤트에서 처리됨)
            });
            });

            modelSelect.addEventListener('change', () => {
            vscode.postMessage({ command: 'selectModel', model: modelSelect.value });
            });

            sendBtn.addEventListener('click', sendMessage);

            stopBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'stopGeneration' });
            });

            applyBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'applyOperations' });
            });

            rejectBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'rejectOperations' });
            });

            newChatBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'newChat' });
            });

            // IME 입력 시작/종료 추적
            messageInput.addEventListener('compositionstart', () => {
            isComposing = true;
            });
            
            messageInput.addEventListener('compositionend', () => {
            isComposing = false;
            });
            
            messageInput.addEventListener('keydown', (e) => {
            if (autocomplete.classList.contains('visible')) {
            if (e.key === 'ArrowDown') {
            e.preventDefault();
            updateAutocompleteSelection(1);
            return;
            }
            if (e.key === 'ArrowUp') {
            e.preventDefault();
            updateAutocompleteSelection(-1);
            return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            selectAutocompleteItem(selectedAutocompleteIndex);
            return;
            }
            if (e.key === 'Escape') {
            e.preventDefault();
            hideAutocomplete();
            return;
            }
            }

            // IME 입력 중이 아닐 때만 메시지 전송
            if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
            e.preventDefault();
            sendMessage();
            }
            });

            messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';

            const value = messageInput.value;
            const cursorPos = messageInput.selectionStart;
            const textBeforeCursor = value.substring(0, cursorPos);

            // Check for slash command at the start of input
            if (value.startsWith('/')) {
            const query = textBeforeCursor.substring(1);
            if (!/\\s/.test(query) || query.length === 0) {
            slashStartIndex = 0;
            vscode.postMessage({ command: 'searchSlashCommands', query: '/' + query });
            return;
            }
            }

            // Check for @ mention
            const atIndex = textBeforeCursor.lastIndexOf('@');
            if (atIndex !== -1 && (atIndex === 0 || /\\s/.test(value[atIndex - 1]))) {
            const query = textBeforeCursor.substring(atIndex + 1);
            if (!/\\s/.test(query)) {
            mentionStartIndex = atIndex;
            vscode.postMessage({ command: 'searchFiles', query: query });
            return;
            }
            }

            hideAutocomplete();
            });

            messageInput.addEventListener('paste', (e) => {
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
            const blob = items[i].getAsFile();
            const reader = new FileReader();
            reader.onload = (event) => {
            addImageTag(event.target.result);
            };
            reader.readAsDataURL(blob);
            }
            }
            });

            window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
            case 'addMessage':
            addMessage(message.role, message.content);
            break;
            case 'startStreaming':
            startStreaming();
            break;
            case 'streamChunk':
            handleStreamChunk(message.content);
            break;
            case 'endStreaming':
            endStreaming();
            break;
            case 'clearMessages':
            chatContainer.innerHTML = '';
            hideOperations();
            // Reset token counters
            sessionTotalTokens = 0;
            sessionPromptTokens = 0;
            sessionCompletionTokens = 0;
            tokenDisplay.textContent = '0';
            tokenDetail.textContent = '(Prompt: 0 | Completion: 0)';
            break;
            case 'updateTokenUsage':
            sessionPromptTokens += message.usage.prompt;
            sessionCompletionTokens += message.usage.completion;
            sessionTotalTokens += message.usage.total;
            tokenDisplay.textContent = sessionTotalTokens.toLocaleString();
            tokenDetail.textContent = \`(Prompt: \${sessionPromptTokens.toLocaleString()} | Completion: \${sessionCompletionTokens.toLocaleString()})\`;
            break;
            case 'updateModels':
            updateModels(message.models, message.selected);
            break;
            case 'fileSearchResults':
            showAutocomplete(message.files);
            break;
            case 'modeChanged':
            currentMode = message.mode;
            modeTabs.forEach(t => {
            t.classList.toggle('active', t.dataset.mode === currentMode);
            });
            modeDescription.textContent = modeDescriptions[currentMode];
            messageInput.placeholder = modePlaceholders[currentMode];
            
            // Agent 모드이고 checkpoint 기능이 활성화된 경우에만 체크포인트 패널 표시 및 로드
            const checkpointsEnabled = message.checkpointsEnabled !== undefined ? message.checkpointsEnabled : false;
            if (currentMode === 'agent' && checkpointsEnabled) {
            checkpointsPanel.classList.add('visible');
            vscode.postMessage({ command: 'getCheckpoints' });
            } else {
            checkpointsPanel.classList.remove('visible');
            }
            break;
            case 'showOperations':
            showOperations(message.operations);
            break;
            case 'operationsCleared':
            hideOperations();
            break;
            case 'fileDropped':
            addFileTag(message.path, message.isDir);
            break;
            case 'receiveCode':
            // Add file as attachment and set code context in input
            if (message.filePath) {
            addFileTag(message.filePath);
            }
            const codeBlock = \`\\\`\\\`\\\`\${message.languageId}\\n\${message.code}\\n\\\`\\\`\\\`\`;
            messageInput.value = \`이 코드에 대해:\\n\${codeBlock}\\n\\n\`;
            messageInput.focus();
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
            break;
            case 'slashCommandResults':
            showSlashAutocomplete(message.commands);
            break;
            case 'sessionsList':
            renderSessions(message.sessions, message.currentSessionId);
            break;
            case 'updatePlan':
            updatePlanUI(message.plan);
            break;
            case 'agentStateChanged':
            updateAgentStatusUI(message.state);
            break;
            case 'checkpointCreated':
            // 체크포인트가 생성되면 목록 새로고침
            vscode.postMessage({ command: 'getCheckpoints' });
            break;
            case 'checkpointsList':
            updateCheckpointsUI(message.checkpoints);
            break;
            case 'generationStopped':
            endStreaming();
            break;
            }
            });

            function updateAgentStatusUI(state) {
            agentStatusBadge.textContent = state;
            // Plan Panel은 Plan 모드일 때만 표시 (Agent 모드에서 자동 Plan 생성 방지)
            if (currentMode === 'plan' && state !== 'Idle' && state !== 'Done' && state !== 'Error') {
            planPanel.classList.add('visible');
            } else if (currentMode !== 'plan') {
            planPanel.classList.remove('visible');
            }
            }

            function updateCheckpointsUI(checkpoints) {
            // Agent 모드이고 checkpoint가 활성화된 경우에만 checkpoints가 없어도 패널 표시
            if (!checkpoints || checkpoints.length === 0) {
            checkpointsList.innerHTML = '<div style="opacity:0.6; font-size:0.85em; padding:8px;">No checkpoints yet. Checkpoints will be created automatically before each step execution.</div>';
            // 패널 표시는 modeChanged 이벤트에서 처리됨
            return;
            }

            checkpointsPanel.classList.add('visible');
            checkpointsList.innerHTML = checkpoints.map(cp => {
            const date = new Date(cp.timestamp).toLocaleString();
            const desc = cp.stepDescription || 'Checkpoint';
            return '<div class="checkpoint-item" data-id="' + cp.id + '">' +
            '<div class="checkpoint-info">' +
            '<div class="checkpoint-description">' + escapeHtml(desc) + '</div>' +
            '<div class="checkpoint-meta">' + date + ' • ' + cp.fileCount + ' files</div>' +
            '</div>' +
            '<div class="checkpoint-actions">' +
            '<button class="checkpoint-btn compare" data-id="' + cp.id + '" title="Compare with current">Compare</button>' +
            '<button class="checkpoint-btn restore" data-id="' + cp.id + '" title="Restore workspace">Restore</button>' +
            '<button class="checkpoint-btn delete" data-id="' + cp.id + '" title="Delete checkpoint">×</button>' +
            '</div>' +
            '</div>';
            }).join('');

            // 이벤트 리스너 추가
            checkpointsList.querySelectorAll('.checkpoint-btn.compare').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'compareCheckpoint', checkpointId: btn.dataset.id });
            });
            });

            checkpointsList.querySelectorAll('.checkpoint-btn.restore').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'restoreCheckpoint', checkpointId: btn.dataset.id, restoreWorkspaceOnly: false });
            });
            });

            checkpointsList.querySelectorAll('.checkpoint-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'deleteCheckpoint', checkpointId: btn.dataset.id });
            });
            });
            }

            if (refreshCheckpointsBtn) {
            refreshCheckpointsBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'getCheckpoints' });
            });
            }

            // Agent 모드이고 checkpoint가 활성화된 경우에만 체크포인트 목록 로드
            // (설정은 서버에서 확인되므로 여기서는 로드하지 않음, modeChanged 이벤트에서 처리됨)

            function updatePlanUI(plan) {
            if (!plan || plan.length === 0) {
            planPanel.classList.remove('visible');
            return;
            }

            // Plan Panel은 Plan 모드일 때만 표시
            if (currentMode === 'plan') {
            planPanel.classList.add('visible');
            } else {
            planPanel.classList.remove('visible');
            return;
            }
            planList.innerHTML = '';

            plan.forEach(step => {
            const item = document.createElement('div');
            item.className = 'plan-item ' + step.status;

            let icon = '○';
            if (step.status === 'running') icon = '⚡';
            if (step.status === 'done') icon = '✓';
            if (step.status === 'failed') icon = '✗';

            item.innerHTML = \`
            <span class="step-icon">\${icon}</span>
            <span class="step-desc">\${escapeHtml(step.description)}</span>
            \`;
            planList.appendChild(item);
            });
            }

            // Drag and drop handling
            const dropZone = document.getElementById('drop-zone');

            dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
            });

            dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
            });

            dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');

            // Try different data formats
            const uriList = e.dataTransfer.getData('text/uri-list');
            const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');

            // Handle VS Code Explorer drops (uri-list format)
            if (uriList) {
            const uris = uriList.split(/[\\r\\n]+/).filter(u => u && !u.startsWith('#'));
            uris.forEach(uri => {
            vscode.postMessage({ command: 'resolveFilePath', uri: uri.trim() });
            });
            }
            // Handle text/plain drops
            else if (text) {
            const lines = text.split(/[\\r\\n]+/);
            lines.forEach(line => {
            line = line.trim();
            if (line) {
            vscode.postMessage({ command: 'resolveFilePath', uri: line });
            }
            });
            }

            // Handle dropped files from system
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            Array.from(e.dataTransfer.files).forEach(file => {
            if (file.path) {
            vscode.postMessage({ command: 'resolveFilePath', uri: file.path });
            }
            });
            }
            });

            // Also allow dropping on the whole chat container
            document.body.addEventListener('dragover', (e) => {
            e.preventDefault();
            });

            document.body.addEventListener('drop', (e) => {
            e.preventDefault();
            });

            window.runCommand = runCommand;
            }) ();

        </script>
    </body>
    </html>`;
    }
}