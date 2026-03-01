import * as vscode from 'vscode';

/** Fixed API endpoint (not user-configurable). */
export const TOKAMAK_API_BASE_URL = 'https://api.ai.tokamak.network';

import type { AgentStrategy, PlanStrategy } from '../agent/types.js';
import type { AutoApprovalConfig, ToolCategory, ApprovalLevel } from '../approval/autoApproval.js';
import { getDefaultAutoApprovalConfig } from '../approval/autoApproval.js';

export interface TokamakSettings {
    apiKey: string;
    baseUrl: string;
    models: string[];
    selectedModel: string;
    enableInlineCompletion: boolean;
    completionDebounceMs: number;
    enableCheckpoints: boolean;
    enableMultiModelReview: boolean;
    reviewerModel: string;
    criticModel: string;
    maxReviewIterations: number;
    maxDebateIterations: number;
    agentStrategy: AgentStrategy;
    planStrategy: PlanStrategy;
    enableBrowser: boolean;
}

export function setSettingsContext(context: vscode.ExtensionContext): void {
    // Keep for potential future use or consistency
}

export function isCheckpointsEnabled(): boolean {
    return getSettings().enableCheckpoints;
}

export function getSettings(): TokamakSettings {
    const config = vscode.workspace.getConfiguration('tokamak');
    return {
        apiKey: config.get<string>('apiKey', ''),
        baseUrl: TOKAMAK_API_BASE_URL,
        models: config.get<string[]>('models', ['qwen3-235b', 'qwen3-80b-next', 'qwen3-coder-flash']),
        selectedModel: config.get<string>('selectedModel', 'qwen3-235b'),
        enableInlineCompletion: config.get<boolean>('enableInlineCompletion', true),
        completionDebounceMs: config.get<number>('completionDebounceMs', 300),
        enableCheckpoints: config.get<boolean>('enableCheckpoints', false),
        enableMultiModelReview: config.get<boolean>('enableMultiModelReview', false),
        reviewerModel: config.get<string>('reviewerModel', ''),
        criticModel: config.get<string>('criticModel', ''),
        maxReviewIterations: config.get<number>('maxReviewIterations', 3),
        maxDebateIterations: config.get<number>('maxDebateIterations', 2),
        agentStrategy: config.get<AgentStrategy>('agentStrategy', 'review'),
        planStrategy: config.get<PlanStrategy>('planStrategy', 'debate'),
        enableBrowser: config.get<boolean>('enableBrowser', false),
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

export function getEnableMultiModelReview(): boolean {
    return getSettings().enableMultiModelReview;
}

export async function setEnableMultiModelReview(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration('tokamak').update('enableMultiModelReview', enabled, true);
}

export function getReviewerModel(): string {
    return getSettings().reviewerModel;
}

export async function setReviewerModel(model: string): Promise<void> {
    await vscode.workspace.getConfiguration('tokamak').update('reviewerModel', model, true);
}

export function getCriticModel(): string {
    return getSettings().criticModel;
}

export async function setCriticModel(model: string): Promise<void> {
    await vscode.workspace.getConfiguration('tokamak').update('criticModel', model, true);
}

export function getMaxReviewIterations(): number {
    return getSettings().maxReviewIterations;
}

export function getMaxDebateIterations(): number {
    return getSettings().maxDebateIterations;
}

export function getAgentStrategy(): AgentStrategy {
    return getSettings().agentStrategy;
}

export async function setAgentStrategy(strategy: AgentStrategy): Promise<void> {
    await vscode.workspace.getConfiguration('tokamak').update('agentStrategy', strategy, true);
}

export function getPlanStrategy(): PlanStrategy {
    return getSettings().planStrategy;
}

export async function setPlanStrategy(strategy: PlanStrategy): Promise<void> {
    await vscode.workspace.getConfiguration('tokamak').update('planStrategy', strategy, true);
}

export function isConfigured(): boolean {
    const settings = getSettings();
    return settings.apiKey.length > 0;
}

export function getAutoApprovalConfig(): AutoApprovalConfig {
    const config = vscode.workspace.getConfiguration('tokamak');
    const defaults = getDefaultAutoApprovalConfig();
    const toolCategories: ToolCategory[] = ['read_file', 'write_file', 'create_file', 'delete_file', 'terminal_command', 'search'];
    const tools = { ...defaults.tools };
    for (const cat of toolCategories) {
        const val = config.get<ApprovalLevel>(`autoApproval.tools.${cat}`);
        if (val) { tools[cat] = val; }
    }
    return {
        enabled: config.get<boolean>('autoApproval.enabled', defaults.enabled),
        tools,
        allowedPaths: config.get<string[]>('autoApproval.allowedPaths', defaults.allowedPaths),
        protectedPaths: config.get<string[]>('autoApproval.protectedPaths', defaults.protectedPaths),
        maxAutoApproveFileSize: config.get<number>('autoApproval.maxAutoApproveFileSize', defaults.maxAutoApproveFileSize),
        allowedCommands: config.get<string[]>('autoApproval.allowedCommands', defaults.allowedCommands),
    };
}

export async function promptForConfiguration(): Promise<boolean> {
    const settings = getSettings();

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
