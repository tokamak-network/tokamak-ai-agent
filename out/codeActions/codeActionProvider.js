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
exports.explainCode = explainCode;
exports.refactorCode = refactorCode;
exports.disposeOutputChannel = disposeOutputChannel;
const vscode = __importStar(require("vscode"));
const client_js_1 = require("../api/client.js");
const settings_js_1 = require("../config/settings.js");
let outputChannel = null;
function getOutputChannel() {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Tokamak AI');
    }
    return outputChannel;
}
async function explainCode() {
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
    if (!(0, settings_js_1.isConfigured)()) {
        const configured = await (0, settings_js_1.promptForConfiguration)();
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
        const messages = [
            {
                role: 'system',
                content: 'You are a code explanation assistant. Explain the code clearly and concisely. Include information about what the code does, how it works, and any important patterns or concepts used.',
            },
            {
                role: 'user',
                content: `Explain this ${language} code:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``,
            },
        ];
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Explaining code...',
            cancellable: false,
        }, async () => {
            const explanation = await (0, client_js_1.chatCompletion)(messages);
            output.appendLine(explanation);
            output.appendLine('');
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        output.appendLine(`Error: ${errorMessage}`);
        vscode.window.showErrorMessage(`Failed to explain code: ${errorMessage}`);
    }
}
async function refactorCode() {
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
    if (!(0, settings_js_1.isConfigured)()) {
        const configured = await (0, settings_js_1.promptForConfiguration)();
        if (!configured) {
            return;
        }
    }
    const selectedText = editor.document.getText(selection);
    const language = editor.document.languageId;
    // Ask user what kind of refactoring they want
    const refactorType = await vscode.window.showQuickPick([
        { label: 'Improve Readability', description: 'Make the code cleaner and more readable' },
        { label: 'Optimize Performance', description: 'Improve performance where possible' },
        { label: 'Add Error Handling', description: 'Add proper error handling' },
        { label: 'Extract Function', description: 'Extract into a reusable function' },
        { label: 'Add Types', description: 'Add type annotations (TypeScript/Python)' },
        { label: 'Custom', description: 'Describe your own refactoring goal' },
    ], { placeHolder: 'What kind of refactoring?' });
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
        const messages = [
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
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Refactoring code...',
            cancellable: false,
        }, async () => {
            refactoredCode = await (0, client_js_1.chatCompletion)(messages);
        });
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
        const action = await vscode.window.showInformationMessage('Refactoring complete. What would you like to do?', 'Apply Changes', 'Show in Output', 'Cancel');
        if (action === 'Apply Changes') {
            await editor.edit((editBuilder) => {
                editBuilder.replace(selection, refactoredCode);
            });
            vscode.window.showInformationMessage('Code refactored successfully!');
        }
        else if (action === 'Show in Output') {
            const output = getOutputChannel();
            output.show(true);
            output.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            output.appendLine(`🔧 Refactored Code (${refactorInstruction})`);
            output.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            output.appendLine('');
            output.appendLine(refactoredCode);
            output.appendLine('');
        }
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to refactor code: ${errorMessage}`);
    }
}
function disposeOutputChannel() {
    if (outputChannel) {
        outputChannel.dispose();
        outputChannel = null;
    }
}
//# sourceMappingURL=codeActionProvider.js.map