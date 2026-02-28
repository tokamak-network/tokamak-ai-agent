import { BaseProvider } from './BaseProvider.js';
import type { ModelCapabilities, ModelDefaults } from './IProvider.js';

export class GeminiProvider extends BaseProvider {
    readonly id = 'gemini';
    readonly name = 'Gemini';

    canHandle(model: string): boolean {
        return model.toLowerCase().startsWith('gemini');
    }

    getCapabilities(_model: string): ModelCapabilities {
        return {
            vision: true,
            streamUsage: false,
            toolCallsToXml: false,
            thinkingBlocks: true,
            contextWindow: 1000000,
        };
    }

    getDefaults(_model: string): ModelDefaults {
        return {};
    }
}
