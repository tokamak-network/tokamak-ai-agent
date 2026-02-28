import { BaseProvider } from './BaseProvider.js';
import type { ModelCapabilities, ModelDefaults } from './IProvider.js';

export class GenericProvider extends BaseProvider {
    readonly id = 'generic';
    readonly name = 'Generic';

    canHandle(_model: string): boolean {
        return true;
    }

    getCapabilities(model: string): ModelCapabilities {
        const m = model.toLowerCase();
        return {
            vision: /\bvision\b|\bvisual\b|\bvl\b/.test(m),
            streamUsage: false,
            toolCallsToXml: false,
            thinkingBlocks: false,
            contextWindow: 65536,
        };
    }

    getDefaults(_model: string): ModelDefaults {
        return {};
    }
}
