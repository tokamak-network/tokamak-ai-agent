import * as vscode from 'vscode';
import { codeCompletion } from '../api/client.js';
import { getSettings, isConfigured } from '../config/settings.js';

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private debounceTimer: NodeJS.Timeout | null = null;
    private lastRequestId = 0;

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | null> {
        const settings = getSettings();

        if (!settings.enableInlineCompletion || !isConfigured()) {
            return null;
        }

        // Only trigger on typing, not on explicit invoke
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke) {
            return this.getCompletion(document, position, token);
        }

        // Debounce for automatic triggers
        return new Promise((resolve) => {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            const requestId = ++this.lastRequestId;

            this.debounceTimer = setTimeout(async () => {
                if (token.isCancellationRequested || requestId !== this.lastRequestId) {
                    resolve(null);
                    return;
                }

                const result = await this.getCompletion(document, position, token);
                resolve(result);
            }, settings.completionDebounceMs);

            token.onCancellationRequested(() => {
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }
                resolve(null);
            });
        });
    }

    private async getCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | null> {
        try {
            // Get context around cursor
            const prefixRange = new vscode.Range(
                new vscode.Position(Math.max(0, position.line - 50), 0),
                position
            );
            const suffixRange = new vscode.Range(
                position,
                new vscode.Position(Math.min(document.lineCount - 1, position.line + 20), 0)
            );

            const prefix = document.getText(prefixRange);
            const suffix = document.getText(suffixRange);
            const language = document.languageId;

            // Skip if line is empty or just whitespace
            const currentLine = document.lineAt(position.line).text;
            const textBeforeCursor = currentLine.substring(0, position.character);
            if (textBeforeCursor.trim().length === 0 && position.character < 2) {
                return null;
            }

            if (token.isCancellationRequested) {
                return null;
            }

            const completion = await codeCompletion(prefix, suffix, language);

            if (token.isCancellationRequested || !completion) {
                return null;
            }

            // Clean up the completion (remove markdown code fences if present)
            let cleanedCompletion = completion;
            const codeBlockMatch = completion.match(/^```\w*\n?([\s\S]*?)\n?```$/);
            if (codeBlockMatch) {
                cleanedCompletion = codeBlockMatch[1];
            }

            // Remove leading/trailing empty lines but preserve indentation
            cleanedCompletion = cleanedCompletion.replace(/^\n+/, '').replace(/\n+$/, '');

            if (!cleanedCompletion) {
                return null;
            }

            const item = new vscode.InlineCompletionItem(
                cleanedCompletion,
                new vscode.Range(position, position)
            );

            return [item];
        } catch (error) {
            console.error('Inline completion error:', error);
            return null;
        }
    }
}
