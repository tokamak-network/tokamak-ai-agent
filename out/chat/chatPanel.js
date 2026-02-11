"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatPanel = void 0;
const vscode = __importStar(require("vscode"));
const client_js_1 = require("../api/client.js");
const settings_js_1 = require("../config/settings.js");
// 기본 내장 스킬 (파일이 없을 때 사용)
const BUILTIN_SKILLS = [
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
class ChatPanel {
    static currentPanel;
    static viewType = 'tokamakChat';
    static extensionContext;
    panel;
    extensionUri;
    chatHistory = [];
    sessions = [];
    currentSessionId;
    disposables = [];
    currentMode = 'ask';
    pendingOperations = [];
    currentAbortController = null;
    static setContext(context) {
        ChatPanel.extensionContext = context;
    }
    constructor(panel, extensionUri) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        // Restore chat history
        this.restoreChatHistory();
        this.panel.webview.html = this.getHtmlContent();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(async (message) => this.handleMessage(message), null, this.disposables);
    }
    async handleMessage(message) {
        switch (message.command) {
            case 'sendMessage':
                await this.handleUserMessage(message.text, message.attachedFiles || []);
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
                this.panel.webview.postMessage({ command: 'modeChanged', mode: this.currentMode });
                break;
            case 'ready':
                this.updateModelList();
                this.panel.webview.postMessage({ command: 'modeChanged', mode: this.currentMode });
                this.sendRestoredHistory();
                break;
            case 'getSessions':
                this.panel.webview.postMessage({
                    command: 'sessionsList',
                    sessions: this.sessions.map(s => ({ id: s.id, title: s.title, timestamp: s.timestamp })),
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
                    this.panel.webview.postMessage({ command: 'modeChanged', mode: this.currentMode });
                    this.sendRestoredHistory();
                }
                break;
            case 'deleteSession':
                this.sessions = this.sessions.filter(s => s.id !== message.sessionId);
                if (this.currentSessionId === message.sessionId) {
                    this.clearChat();
                }
                else {
                    this.saveChatHistory();
                }
                this.panel.webview.postMessage({
                    command: 'sessionsList',
                    sessions: this.sessions.map(s => ({ id: s.id, title: s.title, timestamp: s.timestamp })),
                    currentSessionId: this.currentSessionId
                });
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
                    }
                    else {
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
                await this.runInTerminal(message.command);
                break;
            case 'stopGeneration':
                this.stopGeneration();
                break;
            case 'searchSlashCommands':
                await this.searchSlashCommands(message.query);
                break;
        }
    }
    static createOrShow(extensionUri) {
        const column = vscode.ViewColumn.Beside;
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel(ChatPanel.viewType, 'Tokamak AI Chat', column, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [extensionUri],
        });
        ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
    }
    clearChat() {
        this.chatHistory = [];
        this.pendingOperations = [];
        this.saveChatHistory();
        this.panel.webview.postMessage({ command: 'clearMessages' });
    }
    saveChatHistory() {
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
                title = firstUserMessage.content.split('\n')[0].substring(0, 30) + (firstUserMessage.content.length > 30 ? '...' : '');
            }
            const session = {
                id: this.currentSessionId,
                title: title,
                messages: this.chatHistory,
                mode: this.currentMode,
                timestamp: Date.now()
            };
            if (existingIndex >= 0) {
                this.sessions[existingIndex] = session;
            }
            else {
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
    restoreChatHistory() {
        if (ChatPanel.extensionContext) {
            this.sessions = ChatPanel.extensionContext.workspaceState.get('tokamak.sessions') || [];
            this.currentSessionId = ChatPanel.extensionContext.workspaceState.get('tokamak.currentSessionId');
            if (this.currentSessionId) {
                const currentSession = this.sessions.find(s => s.id === this.currentSessionId);
                if (currentSession) {
                    this.chatHistory = currentSession.messages;
                    this.currentMode = currentSession.mode;
                }
            }
            else if (this.sessions.length > 0) {
                // Load latest session if no current ID
                const latest = this.sessions[0];
                this.currentSessionId = latest.id;
                this.chatHistory = latest.messages;
                this.currentMode = latest.mode;
            }
        }
    }
    sendRestoredHistory() {
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
    sendCodeToChat(code, filePath, languageId) {
        this.panel.reveal();
        this.panel.webview.postMessage({
            command: 'receiveCode',
            code: code,
            filePath: filePath,
            languageId: languageId,
        });
    }
    updateModelList() {
        const models = (0, settings_js_1.getAvailableModels)();
        const selected = (0, settings_js_1.getSelectedModel)();
        this.panel.webview.postMessage({
            command: 'updateModels',
            models: models,
            selected: selected,
        });
    }
    async handleModelChange(model) {
        await (0, settings_js_1.setSelectedModel)(model);
        vscode.window.showInformationMessage(`Model changed to: ${model}`);
    }
    async searchFiles(query) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            this.panel.webview.postMessage({ command: 'fileSearchResults', files: [] });
            return;
        }
        try {
            // Find files matching query
            const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', 50);
            const results = [];
            const processedPaths = new Set();
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
        }
        catch {
            this.panel.webview.postMessage({ command: 'fileSearchResults', files: [] });
        }
    }
    async openFile(path) {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
                const stat = await vscode.workspace.fs.stat(fileUri);
                if (stat.type === vscode.FileType.Directory) {
                    await vscode.commands.executeCommand('revealInExplorer', fileUri);
                }
                else {
                    await vscode.window.showTextDocument(fileUri);
                }
            }
        }
        catch {
            vscode.window.showErrorMessage(`Could not open: ${path}`);
        }
    }
    async resolveFilePath(uriString) {
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
            }
            else {
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
            }
            catch {
                // File doesn't exist in workspace
            }
        }
        catch (error) {
            console.error('Error resolving file path:', error);
        }
    }
    async getFileContent(relativePath) {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return '';
            }
            const uri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
            const stat = await vscode.workspace.fs.stat(uri);
            // If it's a directory, return the structure
            if (stat.type === vscode.FileType.Directory) {
                const files = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, '**/*'), '**/node_modules/**', 100);
                let structure = `\n--- Folder: ${relativePath} ---\nFolder Structure:\n`;
                const folderTree = [];
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
        }
        catch {
            return `\n--- Item: ${relativePath} (could not read) ---\n`;
        }
    }
    getEditorContext() {
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
        }
        else {
            const cursorLine = selection.active.line;
            const startLine = Math.max(0, cursorLine - 30);
            const endLine = Math.min(document.lineCount - 1, cursorLine + 30);
            const visibleRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
            const visibleCode = document.getText(visibleRange);
            context += `\nCode around cursor (lines ${startLine + 1}-${endLine + 1}):\n\`\`\`${document.languageId}\n${visibleCode}\n\`\`\`\n`;
        }
        return context;
    }
    getWorkspaceInfo() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return '';
        }
        const folder = workspaceFolders[0];
        return `\nWorkspace: ${folder.name}`;
    }
    async getProjectStructure() {
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
            const files = await vscode.workspace.findFiles('**/*', `{${excludePatterns.join(',')}}`, 2000);
            // Build tree structure
            const tree = new Map();
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
                    tree.get(parentPath).add(parts[i]);
                }
            }
            // Generate tree string
            const buildTreeString = (path, indent) => {
                const children = tree.get(path);
                if (!children || children.size === 0) {
                    return '';
                }
                const sortedChildren = Array.from(children).sort((a, b) => {
                    const aIsDir = tree.has(path ? `${path}/${a}` : a);
                    const bIsDir = tree.has(path ? `${path}/${b}` : b);
                    if (aIsDir && !bIsDir)
                        return -1;
                    if (!aIsDir && bIsDir)
                        return 1;
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
        }
        catch (error) {
            return `\n(Note: Could not retrieve project structure automatically. Please ask me to read specific files.)\n`;
        }
    }
    async getSystemPromptForMode() {
        const workspaceInfo = this.getWorkspaceInfo();
        const projectStructure = await this.getProjectStructure();
        switch (this.currentMode) {
            case 'ask':
                return `You are a helpful coding assistant integrated with VS Code.${workspaceInfo}
${projectStructure}

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

You can perform file operations. When you need to create, edit, or delete files, output them in this EXACT format:

<<<FILE_OPERATION>>>
TYPE: create|edit|delete|read
PATH: relative/path/to/file
DESCRIPTION: Brief description of the change
CONTENT:
\`\`\`
actual file content here (for create/edit only)
\`\`\`
<<<END_OPERATION>>>

Rules:
- You can output multiple FILE_OPERATION blocks
- For 'edit', provide the COMPLETE new file content.
- For 'read', provide the PATH only, and I will show you the content in the next turn
- For 'delete', no CONTENT is needed
- CRITICAL: Ensure the code is syntactically correct and includes all closing braces (}). NEVER truncate the code at the end.
- Always explain what you're doing before the operations.
- After operations, summarize what was done.
- Be careful and precise with file paths.
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
    parseFileOperations(response) {
        const operations = [];
        const regex = /<<<FILE_OPERATION>>>([\s\S]*?)<<<END_OPERATION>>>/g;
        let match;
        while ((match = regex.exec(response)) !== null) {
            const block = match[1];
            const typeMatch = block.match(/TYPE:\s*(create|edit|delete|read)/i);
            const pathMatch = block.match(/PATH:\s*(.+)/i);
            const descMatch = block.match(/DESCRIPTION:\s*(.+)/i);
            // Flexible CONTENT parsing: matches content even if trailing backticks are missing or incomplete
            const contentMatch = block.match(/CONTENT:\s*```[\w]*\n?([\s\S]*?)(?:```|$)/i);
            if (typeMatch && pathMatch) {
                const type = typeMatch[1].toLowerCase();
                operations.push({
                    type: type,
                    path: pathMatch[1].trim(),
                    description: descMatch ? descMatch[1].trim() : '',
                    content: contentMatch ? contentMatch[1] : undefined,
                });
            }
        }
        return operations;
    }
    async applyFileOperations() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        let successCount = 0;
        let errorCount = 0;
        for (const op of this.pendingOperations) {
            try {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, op.path);
                switch (op.type) {
                    case 'create':
                    case 'edit':
                        if (op.content !== undefined) {
                            // Ensure directory exists
                            const dirPath = op.path.split('/').slice(0, -1).join('/');
                            if (dirPath) {
                                const dirUri = vscode.Uri.joinPath(workspaceFolder.uri, dirPath);
                                try {
                                    await vscode.workspace.fs.createDirectory(dirUri);
                                }
                                catch {
                                    // Directory might already exist
                                }
                            }
                            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(op.content, 'utf8'));
                            successCount++;
                        }
                        break;
                    case 'delete':
                        await vscode.workspace.fs.delete(fileUri);
                        successCount++;
                        break;
                }
            }
            catch (error) {
                errorCount++;
                console.error(`Failed to ${op.type} ${op.path}:`, error);
            }
        }
        this.pendingOperations = [];
        this.panel.webview.postMessage({ command: 'operationsCleared' });
        if (successCount > 0) {
            vscode.window.showInformationMessage(`Applied ${successCount} file operation(s)`);
        }
        if (errorCount > 0) {
            vscode.window.showErrorMessage(`Failed to apply ${errorCount} operation(s)`);
        }
    }
    async previewFileOperation(index) {
        const operation = this.pendingOperations[index];
        if (!operation) {
            return;
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, operation.path);
        try {
            if (operation.type === 'create') {
                // Show proposed content vs empty
                const emptyUri = vscode.Uri.parse(`untitled:empty`);
                const proposedUri = vscode.Uri.parse(`tokamak-preview:${operation.path}`);
                // Register content provider for the preview
                const proposedContent = operation.content || '';
                const provider = new (class {
                    provideTextDocumentContent() {
                        return proposedContent;
                    }
                })();
                const disposable = vscode.workspace.registerTextDocumentContentProvider('tokamak-preview', provider);
                await vscode.commands.executeCommand('vscode.diff', emptyUri, proposedUri, `[CREATE] ${operation.path}`);
                // Clean up after a delay
                setTimeout(() => disposable.dispose(), 5000);
            }
            else if (operation.type === 'edit') {
                // Show diff between current and proposed
                const proposedContent = operation.content || '';
                const provider = new (class {
                    provideTextDocumentContent() {
                        return proposedContent;
                    }
                })();
                const disposable = vscode.workspace.registerTextDocumentContentProvider('tokamak-preview', provider);
                const proposedUri = vscode.Uri.parse(`tokamak-preview:${operation.path}`);
                await vscode.commands.executeCommand('vscode.diff', fileUri, proposedUri, `[EDIT] ${operation.path}`);
                setTimeout(() => disposable.dispose(), 5000);
            }
            else if (operation.type === 'delete') {
                // Show current content (will be deleted)
                await vscode.window.showTextDocument(fileUri, { preview: true });
                vscode.window.showWarningMessage(`This file will be deleted: ${operation.path}`);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Could not preview: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    async handleUserMessage(text, attachedFiles) {
        if (!(await (0, settings_js_1.isConfigured)())) {
            const configured = await (0, settings_js_1.promptForConfiguration)();
            if (!configured) {
                this.panel.webview.postMessage({
                    command: 'addMessage',
                    role: 'assistant',
                    content: '⚙️ **설정이 필요합니다**\n\nTokamak AI를 사용하려면 API 설정이 필요합니다.\n\n**설정 방법:**\n1. `Cmd+,` (Mac) / `Ctrl+,` (Windows)로 설정 열기\n2. `tokamak` 검색\n3. `API Key`와 `Base URL` 입력\n\n또는 `Cmd+Shift+P` → "Preferences: Open Settings (JSON)"에서:\n```json\n{\n  "tokamak.apiKey": "your-api-key",\n  "tokamak.baseUrl": "https://your-api.com/v1"\n}\n```',
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
                ? `${slashCommand.prompt}\n\nAdditional context: ${remainingText}`
                : slashCommand.prompt;
        }
        let fileContexts = '';
        for (const filePath of attachedFiles) {
            fileContexts += await this.getFileContent(filePath);
        }
        const editorContext = attachedFiles.length === 0 ? this.getEditorContext() : '';
        const userMessageWithContext = `${processedText}${fileContexts}${editorContext}`;
        this.chatHistory.push({ role: 'user', content: userMessageWithContext });
        const displayText = attachedFiles.length > 0
            ? `${text}\n\n📎 ${attachedFiles.join(', ')}`
            : text;
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
            const systemMessage = {
                role: 'system',
                content: await this.getSystemPromptForMode(),
            };
            while (needsMoreContext && loopCount < maxLoops) {
                loopCount++;
                let fullResponse = '';
                for await (const chunk of (0, client_js_1.streamChatCompletion)([systemMessage, ...this.chatHistory], signal)) {
                    if (signal.aborted) {
                        break;
                    }
                    fullResponse += chunk;
                    this.panel.webview.postMessage({ command: 'streamChunk', content: chunk });
                }
                if (signal.aborted)
                    break;
                this.chatHistory.push({ role: 'assistant', content: fullResponse });
                needsMoreContext = false;
                // In agent or ask mode, parse file operations
                const operations = this.parseFileOperations(fullResponse);
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
                if (writeOps.length > 0 && this.currentMode === 'agent') {
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
        }
        catch (error) {
            this.panel.webview.postMessage({ command: 'endStreaming' });
            // Handle different error types
            if (error instanceof Error) {
                if (error.name === 'AbortError' || error.message.includes('aborted')) {
                    // User cancelled - do nothing or show cancelled message
                }
                else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: '🔑 **API Key 오류**\n\nAPI Key가 유효하지 않습니다.\n\n[설정 열기](command:workbench.action.openSettings?%22tokamak%22)에서 `tokamak.apiKey`를 확인해주세요.',
                    });
                }
                else if (error.message.includes('404') || error.message.includes('Not Found')) {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: '🔗 **API 엔드포인트 오류**\n\nAPI URL을 찾을 수 없습니다.\n\n`tokamak.baseUrl` 설정을 확인해주세요.',
                    });
                }
                else if (error.message.includes('500') || error.message.includes('Internal')) {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: '⚠️ **서버 오류 (500)**\n\nAI 서버에 문제가 발생했습니다.\n\n잠시 후 다시 시도하거나, 서버 상태를 확인해주세요.\n\n모델명(`tokamak.selectedModel`)이 올바른지도 확인해보세요.',
                    });
                }
                else if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed') || error.message.includes('network')) {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: '🌐 **네트워크 연결 오류**\n\nAI 서버에 연결할 수 없습니다.\n\n- 인터넷 연결을 확인해주세요\n- `tokamak.baseUrl`이 올바른지 확인해주세요\n- VPN이 필요한 경우 연결되어 있는지 확인해주세요',
                    });
                }
                else {
                    this.panel.webview.postMessage({
                        command: 'addMessage',
                        role: 'assistant',
                        content: `❌ **오류 발생**\n\n${error.message}\n\n문제가 계속되면 설정을 확인해주세요.`,
                    });
                }
            }
            else {
                this.panel.webview.postMessage({
                    command: 'addMessage',
                    role: 'assistant',
                    content: '❌ **알 수 없는 오류**가 발생했습니다. 다시 시도해주세요.',
                });
            }
        }
        finally {
            this.currentAbortController = null;
        }
    }
    async insertCodeToEditor(code) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await editor.edit((editBuilder) => {
                editBuilder.insert(editor.selection.active, code);
            });
            vscode.window.showInformationMessage('Code inserted!');
        }
        else {
            vscode.window.showWarningMessage('No active editor to insert code into.');
        }
    }
    async runInTerminal(command) {
        // Find existing Tokamak terminal or create new one
        let terminal = vscode.window.terminals.find(t => t.name === 'Tokamak');
        if (!terminal) {
            terminal = vscode.window.createTerminal('Tokamak');
        }
        terminal.show();
        terminal.sendText(command);
    }
    stopGeneration() {
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
            this.panel.webview.postMessage({ command: 'generationStopped' });
        }
    }
    async loadSkillsFromFolder() {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }
        const skillsFolder = vscode.Uri.joinPath(workspaceFolder.uri, '.tokamak', 'skills');
        const skills = [];
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
                        }
                        else if (lines[0].startsWith('#')) {
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
                    }
                    catch {
                        // 파일 읽기 실패 무시
                    }
                }
            }
        }
        catch {
            // 폴더가 없으면 빈 배열 반환
        }
        return skills;
    }
    async getAllSkills() {
        const fileSkills = await this.loadSkillsFromFolder();
        // 파일 스킬이 우선, 같은 이름의 내장 스킬은 덮어씀
        const fileSkillNames = new Set(fileSkills.map(s => s.name));
        const builtinSkills = BUILTIN_SKILLS.filter(s => !fileSkillNames.has(s.name));
        return [...fileSkills, ...builtinSkills];
    }
    async searchSlashCommands(query) {
        const allSkills = await this.getAllSkills();
        const filtered = allSkills.filter(cmd => cmd.name.toLowerCase().includes(query.toLowerCase()) ||
            cmd.description.toLowerCase().includes(query.toLowerCase()));
        this.panel.webview.postMessage({
            command: 'slashCommandResults',
            commands: filtered,
        });
    }
    async parseSlashCommand(text) {
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
    dispose() {
        ChatPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
    getHtmlContent() {
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
            box-shadow: 0 -4px 12px rgba(0,0,0,0.2);
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
            border: 1px solid var(--vscode-widget-border) !important;
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
            box-shadow: 2px 0 10px rgba(0,0,0,0.2);
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
        }
        .delete-session {
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            opacity: 0;
            cursor: pointer;
            padding: 4px;
        }
        .session-item:hover .delete-session {
            opacity: 0.6;
        }
        .session-item .delete-session:hover {
            opacity: 1;
            color: var(--vscode-errorForeground);
        }
        #history-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.3);
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
    </style>
</head>
<body>
    <div id="history-overlay"></div>
    <div id="history-panel">
        <div id="history-header">
            <h4>Chat History</h4>
            <button id="close-history" style="background:none; border:none; color:inherit; cursor:pointer; font-size:1.4em;">×</button>
        </div>
        <div id="history-list"></div>
    </div>
    <div id="header">
        <div id="header-top">
            <button id="history-btn" title="Past Conversations">🕒 History</button>
            <div style="flex:1"></div>
            <h3>Tokamak AI</h3>
            <div style="flex:1"></div>
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
    <div id="operations-panel">
        <h4>⚡ Pending File Operations</h4>
        <div id="operations-list"></div>
        <div id="operations-buttons">
            <button id="apply-btn">✓ Apply Changes</button>
            <button id="reject-btn">✗ Reject</button>
        </div>
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
    (function() {
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
                const isShell = ['bash', 'shell', 'sh', 'zsh', 'powershell', 'cmd'].includes(lang.toLowerCase());
                const runBtn = isShell ? \`<button class="run-btn" onclick="runCommand(this)">▶ Run</button>\` : '';
                return \`<div class="code-header"><span>\${langLabel}</span><div><button class="insert-btn" onclick="insertCode(this)">Insert</button>\${runBtn}</div></div><pre><code class="language-\${lang}">\${escapedCode}</code></pre>\`;
            });
            result = result.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
            result = result.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
            result = result.replace(/\\n/g, '<br>');
            return result;
        }

        function addMessage(role, content) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${role}\`;

            const roleDiv = document.createElement('div');
            roleDiv.className = 'message-role';
            roleDiv.textContent = role === 'user' ? 'You' : 'Tokamak AI';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = parseMarkdown(content);

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

        function insertCode(btn) {
            const pre = btn.closest('.code-header').nextElementSibling;
            const code = pre.querySelector('code').textContent;
            vscode.postMessage({ command: 'insertCode', code: code });
        }

        function runCommand(btn) {
            const pre = btn.closest('.code-header').nextElementSibling;
            const command = pre.querySelector('code').textContent;
            vscode.postMessage({ command: 'runCommand', command: command });
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
        function sendMessage() {
            if (isSending) return; // Prevent duplicate calls
            
            const text = messageInput.value.trim();
            if (!text && attachedFiles.length === 0) return;

            isSending = true;
            sendBtn.disabled = true;
            vscode.postMessage({
                command: 'sendMessage',
                text: text,
                attachedFiles: attachedFiles.map(f => f.path)
            });
            messageInput.value = '';
            messageInput.style.height = 'auto';
            attachedFiles = [];
            attachedFilesContainer.innerHTML = '';
            hideAutocomplete();
            
            // Reset flag after a short delay
            setTimeout(() => { isSending = false; }, 100);
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
        };

        closeHistoryBtn.addEventListener('click', closeHistory);
        historyOverlay.addEventListener('click', closeHistory);

        function renderSessions(sessions, currentId) {
            historyList.innerHTML = sessions.map(s => {
                const date = new Date(s.timestamp).toLocaleString();
                const activeClass = s.id === currentId ? 'active' : '';
                const title = s.title || 'New Conversation';
                return '<div class="session-item ' + activeClass + '" data-id="' + s.id + '">' +
                       '<div class="session-title">' + title + '</div>' +
                       '<div class="session-date">' + date + '</div>' +
                       '<span class="delete-session" data-id="' + s.id + '">🗑️</span>' +
                       '</div>';
            }).join('');

            historyList.querySelectorAll('.session-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.classList.contains('delete-session')) {
                        vscode.postMessage({ command: 'deleteSession', sessionId: e.target.dataset.id });
                    } else {
                        vscode.postMessage({ command: 'loadSession', sessionId: item.dataset.id });
                        closeHistory();
                    }
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

            if (e.key === 'Enter' && !e.shiftKey) {
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
                case 'generationStopped':
                    endStreaming();
                    break;
            }
        });

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

        window.insertCode = insertCode;
        window.runCommand = runCommand;
    })();
    </script>
</body>
</html>`;
    }
}
exports.ChatPanel = ChatPanel;
//# sourceMappingURL=chatPanel.js.map