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
exports.InlineCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
const client_js_1 = require("../api/client.js");
const settings_js_1 = require("../config/settings.js");
class InlineCompletionProvider {
    debounceTimer = null;
    lastRequestId = 0;
    async provideInlineCompletionItems(document, position, context, token) {
        const settings = (0, settings_js_1.getSettings)();
        if (!settings.enableInlineCompletion || !(0, settings_js_1.isConfigured)()) {
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
    async getCompletion(document, position, token) {
        try {
            // Get context around cursor
            const prefixRange = new vscode.Range(new vscode.Position(Math.max(0, position.line - 50), 0), position);
            const suffixRange = new vscode.Range(position, new vscode.Position(Math.min(document.lineCount - 1, position.line + 20), 0));
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
            const completion = await (0, client_js_1.codeCompletion)(prefix, suffix, language);
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
            const item = new vscode.InlineCompletionItem(cleanedCompletion, new vscode.Range(position, position));
            return [item];
        }
        catch (error) {
            console.error('Inline completion error:', error);
            return null;
        }
    }
}
exports.InlineCompletionProvider = InlineCompletionProvider;
//# sourceMappingURL=inlineCompletionProvider.js.map