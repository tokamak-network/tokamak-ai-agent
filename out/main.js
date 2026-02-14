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
const engine_js_1 = require("./agent/engine.js");
/**
 * Extension activation entry point
 */
async function activate(context) {
    console.log('Tokamak Agent is now active.');
    let agentEngine = null;
    const disposable = vscode.commands.registerCommand('tokamak-agent.start', async () => {
        const userInput = await vscode.window.showInputBox({
            prompt: 'What would you like to do?',
            placeHolder: 'e.g., Create a new React component'
        });
        if (!userInput) {
            return;
        }
        const agentContext = {
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
        agentEngine = new engine_js_1.AgentEngine(agentContext);
        await agentEngine.transitionTo('Planning');
        await agentEngine.run();
    });
    context.subscriptions.push(disposable);
}
/**
 * Extension deactivation
 */
function deactivate() {
    console.log('Tokamak Agent is deactivating.');
}
//# sourceMappingURL=main.js.map