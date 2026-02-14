import * as vscode from 'vscode';
import { AgentEngine } from './agent/engine.js';
import { AgentContext } from './agent/types.js';

/**
 * Extension activation entry point
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('Tokamak Agent is now active.');

    let agentEngine: AgentEngine | null = null;

    const disposable = vscode.commands.registerCommand('tokamak-agent.start', async () => {
        const userInput = await vscode.window.showInputBox({
            prompt: 'What would you like to do?',
            placeHolder: 'e.g., Create a new React component'
        });

        if (!userInput) {
            return;
        }

        const agentContext: AgentContext = {
            sessionId: Date.now().toString(),
            mode: 'agent',
            userInput,
            history: [],
            workspacePath: vscode.workspace.workspaceFolders?.[0].uri.fsPath || '',
            maxFixAttempts: 3,
            tokenBudget: 10000,
            onStateChange: (newState) => {
                console.log(`[Agent] State changed to: ${newState}`);
            },
            onPlanChange: (plan) => {
                console.log(`[Agent] Plan updated: ${plan.length} steps`);
            }
        };

        agentEngine = new AgentEngine(agentContext);
        await agentEngine.transitionTo('Planning');
        await agentEngine.run();
    });

    context.subscriptions.push(disposable);
}

/**
 * Extension deactivation
 */
export function deactivate() {
    console.log('Tokamak Agent is deactivating.');
}
