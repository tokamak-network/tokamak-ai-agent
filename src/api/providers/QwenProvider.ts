import { BaseProvider } from './BaseProvider.js';
import type { ModelCapabilities, ModelDefaults } from './IProvider.js';

export class QwenProvider extends BaseProvider {
    readonly id = 'qwen';
    readonly name = 'Qwen';

    canHandle(model: string): boolean {
        return model.toLowerCase().startsWith('qwen');
    }

    getCapabilities(model: string): ModelCapabilities {
        const m = model.toLowerCase();
        return {
            vision: /qwen.*vl/i.test(m),
            streamUsage: false,
            toolCallsToXml: false,
            thinkingBlocks: true,
            contextWindow: m.includes('235b') ? 131072 : 65536,
        };
    }

    getDefaults(_model: string): ModelDefaults {
        return {};
    }
}
