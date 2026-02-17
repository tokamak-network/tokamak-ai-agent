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
exports.ChatViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const client_js_1 = require("../api/client.js");
const settings_js_1 = require("../config/settings.js");
class ChatViewProvider {
    extensionUri;
    static viewType = 'tokamak.chatView';
    webviewView;
    chatHistory = [];
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.webviewView = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.getHtmlContent();
        // Send initial model list
        this.updateModelList();
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'sendMessage':
                    await this.handleUserMessage(message.text);
                    break;
                case 'insertCode':
                    await this.insertCodeToEditor(message.code);
                    break;
                case 'clearChat':
                    this.clearChat();
                    break;
                case 'selectModel':
                    await this.handleModelChange(message.model);
                    break;
                case 'ready':
                    this.updateModelList();
                    break;
            }
        });
    }
    updateModelList() {
        const models = (0, settings_js_1.getAvailableModels)();
        const selected = (0, settings_js_1.getSelectedModel)();
        this.postMessage({
            command: 'updateModels',
            models: models,
            selected: selected,
        });
    }
    async handleModelChange(model) {
        await (0, settings_js_1.setSelectedModel)(model);
        vscode.window.showInformationMessage(`Model changed to: ${model}`);
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
        let context = `\n\n--- Current File Context ---\n`;
        context += `File: ${relativePath}\n`;
        context += `Language: ${document.languageId}\n`;
        // Include selected code if any
        const selection = editor.selection;
        if (!selection.isEmpty) {
            const selectedText = document.getText(selection);
            context += `\nSelected Code (lines ${selection.start.line + 1}-${selection.end.line + 1}):\n\`\`\`${document.languageId}\n${selectedText}\n\`\`\`\n`;
        }
        else {
            // Include visible portion of the file (around cursor)
            const cursorLine = selection.active.line;
            const startLine = Math.max(0, cursorLine - 50);
            const endLine = Math.min(document.lineCount - 1, cursorLine + 50);
            const visibleRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
            const visibleCode = document.getText(visibleRange);
            context += `\nFile Content (lines ${startLine + 1}-${endLine + 1}, cursor at line ${cursorLine + 1}):\n\`\`\`${document.languageId}\n${visibleCode}\n\`\`\`\n`;
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
    async handleUserMessage(text) {
        if (!(0, settings_js_1.isConfigured)()) {
            const configured = await (0, settings_js_1.promptForConfiguration)();
            if (!configured) {
                this.postMessage({
                    command: 'addMessage',
                    role: 'assistant',
                    content: 'Please configure the API Key and Base URL in settings first.',
                });
                return;
            }
        }
        // Get current editor context
        const editorContext = this.getEditorContext();
        const workspaceInfo = this.getWorkspaceInfo();
        // Build the user message with context
        const userMessageWithContext = editorContext
            ? `${text}\n${editorContext}`
            : text;
        this.chatHistory.push({ role: 'user', content: userMessageWithContext });
        this.postMessage({ command: 'addMessage', role: 'user', content: text });
        this.postMessage({ command: 'startStreaming' });
        try {
            let fullResponse = '';
            const systemMessage = {
                role: 'system',
                content: `You are a helpful coding assistant integrated with VS Code.${workspaceInfo}

When the user asks questions, they may include context about their current file and selected code.
- Analyze the provided code context to give relevant answers
- When providing code, wrap it in markdown code blocks with the appropriate language identifier
- Be concise and helpful
- If the user asks about "this code" or "this file", refer to the provided context`,
            };
            const streamResult = (0, client_js_1.streamChatCompletion)([systemMessage, ...this.chatHistory]);
            for await (const chunk of streamResult.content) {
                fullResponse += chunk;
                this.postMessage({ command: 'streamChunk', content: chunk });
            }
            this.chatHistory.push({ role: 'assistant', content: fullResponse });
            this.postMessage({ command: 'endStreaming' });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            this.postMessage({ command: 'endStreaming' });
            this.postMessage({
                command: 'addMessage',
                role: 'assistant',
                content: `Error: ${errorMessage}`,
            });
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
    clearChat() {
        this.chatHistory = [];
        this.postMessage({ command: 'clearMessages' });
    }
    refreshModels() {
        this.updateModelList();
    }
    postMessage(message) {
        this.webviewView?.webview.postMessage(message);
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
            background-color: var(--vscode-sideBar-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        #header {
            padding: 8px 10px;
            border-bottom: 1px solid var(--vscode-widget-border);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #header label {
            font-size: 0.85em;
            opacity: 0.8;
        }
        #model-select {
            flex: 1;
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: inherit;
        }
        #model-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        #chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }
        .message {
            margin-bottom: 12px;
            padding: 8px 12px;
            border-radius: 8px;
            word-wrap: break-word;
        }
        .message.user {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: 20px;
        }
        .message.assistant {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            margin-right: 20px;
        }
        .message-role {
            font-weight: bold;
            font-size: 0.85em;
            margin-bottom: 4px;
            opacity: 0.8;
        }
        pre {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
            position: relative;
        }
        code {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        .insert-btn {
            position: absolute;
            top: 5px;
            right: 5px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8em;
        }
        .insert-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        #input-container {
            padding: 10px;
            border-top: 1px solid var(--vscode-widget-border);
        }
        #input-wrapper {
            display: flex;
            gap: 8px;
        }
        #message-input {
            flex: 1;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: inherit;
            resize: none;
            min-height: 36px;
            max-height: 120px;
        }
        #message-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        #send-btn {
            padding: 8px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
        }
        #send-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        #send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .typing-indicator {
            display: none;
            padding: 8px 12px;
            font-style: italic;
            opacity: 0.7;
        }
        .typing-indicator.visible {
            display: block;
        }
    </style>
</head>
<body>
    <div id="header">
        <label for="model-select">Model:</label>
        <select id="model-select"></select>
    </div>
    <div id="chat-container"></div>
    <div class="typing-indicator" id="typing-indicator">AI is thinking...</div>
    <div id="input-container">
        <div id="input-wrapper">
            <textarea id="message-input" placeholder="Ask anything..." rows="1"></textarea>
            <button id="send-btn">Send</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const chatContainer = document.getElementById('chat-container');
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const typingIndicator = document.getElementById('typing-indicator');
        const modelSelect = document.getElementById('model-select');

        let currentStreamingMessage = null;
        let streamingContent = '';

        // Notify extension that webview is ready
        vscode.postMessage({ command: 'ready' });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function parseMarkdown(text) {
            let result = escapeHtml(text);

            // Code blocks with language
            result = result.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
                const escapedCode = code.trim();
                return \`<pre><button class="insert-btn" onclick="insertCode(this)">Insert</button><code class="language-\${lang}">\${escapedCode}</code></pre>\`;
            });

            // Inline code
            result = result.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

            // Bold
            result = result.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

            // Line breaks
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
            streamingContent = '';
            currentStreamingMessage = addMessage('assistant', '');
            typingIndicator.classList.add('visible');
        }

        function handleStreamChunk(chunk) {
            streamingContent += chunk;
            if (currentStreamingMessage) {
                const contentDiv = currentStreamingMessage.querySelector('.message-content');
                contentDiv.innerHTML = parseMarkdown(streamingContent);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }

        function endStreaming() {
            currentStreamingMessage = null;
            typingIndicator.classList.remove('visible');
            sendBtn.disabled = false;
        }

        function insertCode(btn) {
            const codeElement = btn.nextElementSibling;
            const code = codeElement.textContent;
            vscode.postMessage({ command: 'insertCode', code: code });
        }

        function sendMessage() {
            const text = messageInput.value.trim();
            if (!text) return;

            sendBtn.disabled = true;
            vscode.postMessage({ command: 'sendMessage', text: text });
            messageInput.value = '';
            messageInput.style.height = 'auto';
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

        modelSelect.addEventListener('change', () => {
            vscode.postMessage({ command: 'selectModel', model: modelSelect.value });
        });

        sendBtn.addEventListener('click', sendMessage);

        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
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
                    break;
                case 'updateModels':
                    updateModels(message.models, message.selected);
                    break;
            }
        });

        window.insertCode = insertCode;
    </script>
</body>
</html>`;
    }
}
exports.ChatViewProvider = ChatViewProvider;
//# sourceMappingURL=chatViewProvider.js.map