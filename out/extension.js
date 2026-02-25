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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const chatPanel_js_1 = require("./chat/chatPanel.js");
const inlineCompletionProvider_js_1 = require("./completion/inlineCompletionProvider.js");
const codeActionProvider_js_1 = require("./codeActions/codeActionProvider.js");
const client_js_1 = require("./api/client.js");
const settings_js_1 = require("./config/settings.js");
const logger_js_1 = require("./utils/logger.js");
function activate(context) {
    logger_js_1.logger.init(context);
    logger_js_1.logger.info('[Extension]', 'Tokamak AI Agent is now active!');
    // Set context for settings and ChatPanel
    (0, settings_js_1.setSettingsContext)(context);
    chatPanel_js_1.ChatPanel.setContext(context);
    // Register Inline Completion Provider
    const inlineCompletionProvider = new inlineCompletionProvider_js_1.InlineCompletionProvider();
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineCompletionProvider));
    // Register Commands
    context.subscriptions.push(vscode.commands.registerCommand('tokamak.openChat', () => {
        chatPanel_js_1.ChatPanel.createOrShow(context.extensionUri);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('tokamak.explainCode', codeActionProvider_js_1.explainCode));
    context.subscriptions.push(vscode.commands.registerCommand('tokamak.refactorCode', codeActionProvider_js_1.refactorCode));
    context.subscriptions.push(vscode.commands.registerCommand('tokamak.clearChat', () => {
        if (chatPanel_js_1.ChatPanel.currentPanel) {
            chatPanel_js_1.ChatPanel.currentPanel.clearChat();
            vscode.window.showInformationMessage('Chat history cleared');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('tokamak.sendToChat', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor');
            return;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showWarningMessage('No code selected');
            return;
        }
        const selectedText = editor.document.getText(selection);
        const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
        const languageId = editor.document.languageId;
        chatPanel_js_1.ChatPanel.createOrShow(context.extensionUri);
        // Small delay to ensure panel is ready
        setTimeout(() => {
            if (chatPanel_js_1.ChatPanel.currentPanel) {
                chatPanel_js_1.ChatPanel.currentPanel.sendCodeToChat(selectedText, relativePath, languageId);
            }
        }, 100);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('tokamak.initSkills', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        const skillsFolder = vscode.Uri.joinPath(workspaceFolder.uri, '.tokamak', 'skills');
        // 기본 스킬 파일 내용
        const defaultSkills = {
            'explain.md': `---
description: Explain the selected code in detail
---

Please explain this code in detail. Include:
1. What it does
2. How it works
3. Key concepts used
4. Potential improvements`,
            'refactor.md': `---
description: Suggest refactoring improvements
---

Please suggest refactoring improvements for this code. Focus on:
1. Code readability
2. Performance optimizations
3. Best practices
4. Design patterns that could be applied`,
            'fix.md': `---
description: Find and fix bugs
---

Please analyze this code for bugs and issues. For each issue found:
1. Describe the bug
2. Explain why it's a problem
3. Provide the fix`,
            'test.md': `---
description: Generate unit tests
---

Please generate comprehensive unit tests for this code. Include:
1. Happy path tests
2. Edge cases
3. Error handling tests

Use the appropriate testing framework for the language.`,
            'docs.md': `---
description: Generate documentation
---

Please generate documentation for this code. Include:
1. JSDoc/docstring comments for functions
2. Type annotations if missing
3. Usage examples
4. Parameter descriptions`,
            'review.md': `---
description: Code review
---

Please review this code like a senior developer. Check for:
1. Code quality and best practices
2. Potential bugs or edge cases
3. Security concerns
4. Performance issues
5. Suggestions for improvement

Be constructive and specific in your feedback.`,
        };
        try {
            // 폴더 생성
            await vscode.workspace.fs.createDirectory(skillsFolder);
            // 파일 생성
            for (const [fileName, content] of Object.entries(defaultSkills)) {
                const fileUri = vscode.Uri.joinPath(skillsFolder, fileName);
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
            }
            vscode.window.showInformationMessage(`Skills folder created at .tokamak/skills/ with ${Object.keys(defaultSkills).length} default skills`);
            // 폴더 열기
            const readmeUri = vscode.Uri.joinPath(skillsFolder, 'explain.md');
            await vscode.window.showTextDocument(readmeUri);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to create skills folder: ${error}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('tokamak.initKnowledge', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        const knowledgeDir = vscode.Uri.joinPath(workspaceFolder.uri, '.tokamak', 'knowledge');
        const readmeContent = `# Project Knowledge

Files in this folder are automatically loaded into the AI context when you start a new chat.
Use this for project-specific conventions, architecture decisions, and common patterns.

Supported formats: \`.md\`, \`.txt\` (alphabetical by filename, max ~8KB total).

## Example files you can add
- \`conventions.md\` — Coding style, naming, formatting
- \`architecture.md\` — Structure, layers, folder rules
- \`patterns.md\` — Reusable patterns and how to use them
`;
        const conventionsContent = `# Coding Conventions

- Use TypeScript strict mode.
- Prefer named exports over default exports.
- File naming: camelCase for utilities, PascalCase for components/classes.
- (Edit this file with your project's actual conventions.)
`;
        try {
            await vscode.workspace.fs.createDirectory(knowledgeDir);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(knowledgeDir, 'README.md'), Buffer.from(readmeContent, 'utf8'));
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(knowledgeDir, 'conventions.md'), Buffer.from(conventionsContent, 'utf8'));
            vscode.window.showInformationMessage('Project knowledge folder created at .tokamak/knowledge/');
            await vscode.window.showTextDocument(vscode.Uri.joinPath(knowledgeDir, 'conventions.md'));
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to create knowledge folder: ${error}`);
        }
    }));
    // Listen for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('tokamak')) {
            (0, client_js_1.resetClient)();
        }
    }));
    // Show welcome message on first activation
    const hasShownWelcome = context.globalState.get('tokamak.hasShownWelcome');
    if (!hasShownWelcome) {
        vscode.window
            .showInformationMessage('Tokamak AI Agent activated! Press Cmd+Shift+P and type "Tokamak: Open Chat" to start.', 'Open Chat', 'Open Settings')
            .then((selection) => {
            if (selection === 'Open Chat') {
                chatPanel_js_1.ChatPanel.createOrShow(context.extensionUri);
            }
            else if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'tokamak');
            }
        });
        context.globalState.update('tokamak.hasShownWelcome', true);
    }
}
function deactivate() {
    (0, codeActionProvider_js_1.disposeOutputChannel)();
    (0, client_js_1.resetClient)();
}
//# sourceMappingURL=extension.js.map