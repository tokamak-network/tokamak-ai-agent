import * as vscode from 'vscode';
import { ChatPanel } from './chat/chatPanel.js';
import { InlineCompletionProvider } from './completion/inlineCompletionProvider.js';
import { explainCode, refactorCode, disposeOutputChannel } from './codeActions/codeActionProvider.js';
import { resetClient } from './api/client.js';
import { setSettingsContext } from './config/settings.js';

export function activate(context: vscode.ExtensionContext): void {
    console.log('Tokamak AI Agent is now active!');

    // Set context for settings and ChatPanel
    setSettingsContext(context);
    ChatPanel.setContext(context);

    // Register Inline Completion Provider
    const inlineCompletionProvider = new InlineCompletionProvider();
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            inlineCompletionProvider
        )
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('tokamak.openChat', () => {
            ChatPanel.createOrShow(context.extensionUri);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tokamak.explainCode', explainCode)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tokamak.refactorCode', refactorCode)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tokamak.clearChat', () => {
            if (ChatPanel.currentPanel) {
                ChatPanel.currentPanel.clearChat();
                vscode.window.showInformationMessage('Chat history cleared');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tokamak.sendToChat', () => {
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

            ChatPanel.createOrShow(context.extensionUri);
            // Small delay to ensure panel is ready
            setTimeout(() => {
                if (ChatPanel.currentPanel) {
                    ChatPanel.currentPanel.sendCodeToChat(selectedText, relativePath, languageId);
                }
            }, 100);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('tokamak.initSkills', async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }

            const skillsFolder = vscode.Uri.joinPath(workspaceFolder.uri, '.tokamak', 'skills');

            // 기본 스킬 파일 내용
            const defaultSkills: { [key: string]: string } = {
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

                vscode.window.showInformationMessage(
                    `Skills folder created at .tokamak/skills/ with ${Object.keys(defaultSkills).length} default skills`
                );

                // 폴더 열기
                const readmeUri = vscode.Uri.joinPath(skillsFolder, 'explain.md');
                await vscode.window.showTextDocument(readmeUri);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create skills folder: ${error}`);
            }
        })
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('tokamak')) {
                resetClient();
            }
        })
    );

    // Show welcome message on first activation
    const hasShownWelcome = context.globalState.get<boolean>('tokamak.hasShownWelcome');
    if (!hasShownWelcome) {
        vscode.window
            .showInformationMessage(
                'Tokamak AI Agent activated! Press Cmd+Shift+P and type "Tokamak: Open Chat" to start.',
                'Open Chat',
                'Open Settings'
            )
            .then((selection) => {
                if (selection === 'Open Chat') {
                    ChatPanel.createOrShow(context.extensionUri);
                } else if (selection === 'Open Settings') {
                    vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        'tokamak'
                    );
                }
            });
        context.globalState.update('tokamak.hasShownWelcome', true);
    }
}

export function deactivate(): void {
    disposeOutputChannel();
    resetClient();
}
