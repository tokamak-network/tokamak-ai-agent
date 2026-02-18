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
exports.setSettingsContext = setSettingsContext;
exports.isCheckpointsEnabled = isCheckpointsEnabled;
exports.getSettings = getSettings;
exports.getSelectedModel = getSelectedModel;
exports.getAvailableModels = getAvailableModels;
exports.setSelectedModel = setSelectedModel;
exports.isConfigured = isConfigured;
exports.promptForConfiguration = promptForConfiguration;
const vscode = __importStar(require("vscode"));
function setSettingsContext(context) {
    // Keep for potential future use or consistency
}
function isCheckpointsEnabled() {
    return getSettings().enableCheckpoints;
}
function getSettings() {
    const config = vscode.workspace.getConfiguration('tokamak');
    return {
        apiKey: config.get('apiKey', ''),
        baseUrl: config.get('baseUrl', ''),
        models: config.get('models', ['qwen3-coder-pro']),
        selectedModel: config.get('selectedModel', 'qwen3-coder-pro'),
        enableInlineCompletion: config.get('enableInlineCompletion', true),
        completionDebounceMs: config.get('completionDebounceMs', 300),
        enableCheckpoints: config.get('enableCheckpoints', false),
    };
}
function getSelectedModel() {
    return getSettings().selectedModel;
}
function getAvailableModels() {
    return getSettings().models;
}
async function setSelectedModel(model) {
    await vscode.workspace.getConfiguration('tokamak').update('selectedModel', model, true);
}
function isConfigured() {
    const settings = getSettings();
    return settings.apiKey.length > 0 && settings.baseUrl.length > 0;
}
async function promptForConfiguration() {
    const settings = getSettings();
    if (!settings.baseUrl) {
        const baseUrl = await vscode.window.showInputBox({
            prompt: 'Enter the AI API Base URL',
            placeHolder: 'https://your-api-endpoint.com/v1',
            ignoreFocusOut: true,
        });
        if (baseUrl) {
            await vscode.workspace.getConfiguration('tokamak').update('baseUrl', baseUrl, true);
        }
        else {
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
        }
        else {
            return false;
        }
    }
    return true;
}
//# sourceMappingURL=settings.js.map