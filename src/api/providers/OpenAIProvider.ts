import { BaseProvider } from './BaseProvider.js';
import type { ModelCapabilities, ModelDefaults } from './IProvider.js';

export class OpenAIProvider extends BaseProvider {
    readonly id = 'openai';
    readonly name = 'OpenAI';

    canHandle(model: string): boolean {
        const m = model.toLowerCase();
        return m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3');
    }

    getCapabilities(model: string): ModelCapabilities {
        const m = model.toLowerCase();
        return {
            vision:
                m.startsWith('gpt-4o') ||
                m === 'gpt-4-turbo' ||
                m === 'gpt-4-turbo-preview' ||
                m.startsWith('gpt-4-vision'),
            streamUsage: true,
            toolCallsToXml: false,
            thinkingBlocks: false,
            contextWindow: 128000,
        };
    }

    getDefaults(_model: string): ModelDefaults {
        return {};
    }
}
