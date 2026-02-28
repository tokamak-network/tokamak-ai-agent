import { BaseProvider } from './BaseProvider.js';
import type { ModelCapabilities, ModelDefaults } from './IProvider.js';

export class ClaudeProvider extends BaseProvider {
    readonly id = 'claude';
    readonly name = 'Claude';

    canHandle(model: string): boolean {
        return model.toLowerCase().startsWith('claude');
    }

    getCapabilities(model: string): ModelCapabilities {
        const m = model.toLowerCase();
        return {
            vision: /^claude-3/.test(m),
            streamUsage: false,
            toolCallsToXml: false,
            thinkingBlocks: false,
            contextWindow: 200000,
        };
    }

    getDefaults(_model: string): ModelDefaults {
        return {};
    }
}
