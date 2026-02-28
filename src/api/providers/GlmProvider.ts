import { BaseProvider } from './BaseProvider.js';
import type { ModelCapabilities, ModelDefaults } from './IProvider.js';

export class GlmProvider extends BaseProvider {
    readonly id = 'glm';
    readonly name = 'GLM';

    canHandle(model: string): boolean {
        return model.toLowerCase().startsWith('glm');
    }

    getCapabilities(model: string): ModelCapabilities {
        const m = model.toLowerCase();
        return {
            vision: /glm-4v/i.test(m),
            streamUsage: false,
            toolCallsToXml: false,
            thinkingBlocks: false,
            contextWindow: 131072,
        };
    }

    getDefaults(_model: string): ModelDefaults {
        return {};
    }
}
