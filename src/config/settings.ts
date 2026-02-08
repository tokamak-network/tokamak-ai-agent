import * as vscode from 'vscode';

export interface TokamakSettings {
    apiKey: string;
    baseUrl: string;
    models: string[];
    selectedModel: string;
    enableInlineCompletion: boolean;
    completionDebounceMs: number;
}

export function getSettings(): TokamakSettings {
    const config = vscode.workspace.getConfiguration('tokamak');
    return {
        apiKey: config.get<string>('apiKey', ''),
        baseUrl: config.get<string>('baseUrl', ''),
        models: config.get<string[]>('models', ['qwen3-coder-pro']),
        selectedModel: config.get<string>('selectedModel', 'qwen3-coder-pro'),
        enableInlineCompletion: config.get<boolean>('enableInlineCompletion', true),
        completionDebounceMs: config.get<number>('completionDebounceMs', 300),
    };
}

export function getSelectedModel(): string {
    return getSettings().selectedModel;
}

export function getAvailableModels(): string[] {
    return getSettings().models;
}

export async function setSelectedModel(model: string): Promise<void> {
    await vscode.workspace.getConfiguration('tokamak').update('selectedModel', model, true);
}

export function isConfigured(): boolean {
    const settings = getSettings();
    return settings.apiKey.length > 0 && settings.baseUrl.length > 0;
}

export async function promptForConfiguration(): Promise<boolean> {
    const settings = getSettings();

    if (!settings.baseUrl) {
        const baseUrl = await vscode.window.showInputBox({
            prompt: 'Enter the AI API Base URL',
            placeHolder: 'https://your-api-endpoint.com/v1',
            ignoreFocusOut: true,
        });
        if (baseUrl) {
            await vscode.workspace.getConfiguration('tokamak').update('baseUrl', baseUrl, true);
        } else {
            return false;
        }
    }

    if (!settings.apiKey) {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your API Key',
            placeHolder: 'sk-...',
            password: true,
            ignoreFocusOut: true,
        });
        if (apiKey) {
            await vscode.workspace.getConfiguration('tokamak').update('apiKey', apiKey, true);
        } else {
            return false;
        }
    }

    return true;
}
