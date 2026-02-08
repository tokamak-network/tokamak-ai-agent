import * as vscode from 'vscode';
import { chatCompletion, ChatMessage } from '../api/client.js';
import { isConfigured, promptForConfiguration } from '../config/settings.js';

let outputChannel: vscode.OutputChannel | null = null;

function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Tokamak AI');
    }
    return outputChannel;
}

export async function explainCode(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showWarningMessage('Please select code to explain');
        return;
    }

    if (!isConfigured()) {
        const configured = await promptForConfiguration();
        if (!configured) {
            return;
        }
    }

    const selectedText = editor.document.getText(selection);
    const language = editor.document.languageId;

    const output = getOutputChannel();
    output.show(true);
    output.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    output.appendLine('📖 Code Explanation');
    output.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    output.appendLine('');

    try {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: 'You are a code explanation assistant. Explain the code clearly and concisely. Include information about what the code does, how it works, and any important patterns or concepts used.',
            },
            {
                role: 'user',
                content: `Explain this ${language} code:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``,
            },
        ];

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Explaining code...',
                cancellable: false,
            },
            async () => {
                const explanation = await chatCompletion(messages);
                output.appendLine(explanation);
                output.appendLine('');
            }
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        output.appendLine(`Error: ${errorMessage}`);
        vscode.window.showErrorMessage(`Failed to explain code: ${errorMessage}`);
    }
}

export async function refactorCode(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showWarningMessage('Please select code to refactor');
        return;
    }

    if (!isConfigured()) {
        const configured = await promptForConfiguration();
        if (!configured) {
            return;
        }
    }

    const selectedText = editor.document.getText(selection);
    const language = editor.document.languageId;

    // Ask user what kind of refactoring they want
    const refactorType = await vscode.window.showQuickPick(
        [
            { label: 'Improve Readability', description: 'Make the code cleaner and more readable' },
            { label: 'Optimize Performance', description: 'Improve performance where possible' },
            { label: 'Add Error Handling', description: 'Add proper error handling' },
            { label: 'Extract Function', description: 'Extract into a reusable function' },
            { label: 'Add Types', description: 'Add type annotations (TypeScript/Python)' },
            { label: 'Custom', description: 'Describe your own refactoring goal' },
        ],
        { placeHolder: 'What kind of refactoring?' }
    );

    if (!refactorType) {
        return;
    }

    let refactorInstruction = refactorType.label;
    if (refactorType.label === 'Custom') {
        const custom = await vscode.window.showInputBox({
            prompt: 'Describe the refactoring you want',
            placeHolder: 'e.g., Convert to async/await',
        });
        if (!custom) {
            return;
        }
        refactorInstruction = custom;
    }

    try {
        const messages: ChatMessage[] = [
            {
                role: 'system',
                content: `You are a code refactoring assistant. Provide ONLY the refactored code without any explanation or markdown code fences. The code should be ready to use as a direct replacement.`,
            },
            {
                role: 'user',
                content: `Refactor this ${language} code with the following goal: ${refactorInstruction}

Original code:
${selectedText}

Provide only the refactored code, nothing else:`,
            },
        ];

        let refactoredCode = '';

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Refactoring code...',
                cancellable: false,
            },
            async () => {
                refactoredCode = await chatCompletion(messages);
            }
        );

        // Clean up the response (remove markdown code fences if present)
        const codeBlockMatch = refactoredCode.match(/^```\w*\n?([\s\S]*?)\n?```$/);
        if (codeBlockMatch) {
            refactoredCode = codeBlockMatch[1];
        }
        refactoredCode = refactoredCode.trim();

        if (!refactoredCode) {
            vscode.window.showWarningMessage('No refactored code received');
            return;
        }

        // Show diff and ask for confirmation
        const action = await vscode.window.showInformationMessage(
            'Refactoring complete. What would you like to do?',
            'Apply Changes',
            'Show in Output',
            'Cancel'
        );

        if (action === 'Apply Changes') {
            await editor.edit((editBuilder) => {
                editBuilder.replace(selection, refactoredCode);
            });
            vscode.window.showInformationMessage('Code refactored successfully!');
        } else if (action === 'Show in Output') {
            const output = getOutputChannel();
            output.show(true);
            output.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            output.appendLine(`🔧 Refactored Code (${refactorInstruction})`);
            output.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            output.appendLine('');
            output.appendLine(refactoredCode);
            output.appendLine('');
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to refactor code: ${errorMessage}`);
    }
}

export function disposeOutputChannel(): void {
    if (outputChannel) {
        outputChannel.dispose();
        outputChannel = null;
    }
}
