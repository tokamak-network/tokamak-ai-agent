import type { IProvider } from './IProvider.js';
import { QwenProvider } from './QwenProvider.js';
import { MinimaxProvider } from './MinimaxProvider.js';
import { GlmProvider } from './GlmProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ClaudeProvider } from './ClaudeProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { GenericProvider } from './GenericProvider.js';

export class ProviderRegistry {
    private providers: IProvider[] = [];
    private cache = new Map<string, IProvider>();

    constructor() {
        // 순서 중요: 구체적인 것 먼저, GenericProvider 마지막
        this.register(new QwenProvider());
        this.register(new MinimaxProvider());
        this.register(new GlmProvider());
        this.register(new OpenAIProvider());
        this.register(new ClaudeProvider());
        this.register(new GeminiProvider());
        this.register(new GenericProvider());
    }

    register(provider: IProvider): void {
        this.providers.push(provider);
    }

    resolve(model: string): IProvider {
        const cached = this.cache.get(model);
        if (cached) return cached;

        for (const provider of this.providers) {
            if (provider.canHandle(model)) {
                this.cache.set(model, provider);
                return provider;
            }
        }

        // GenericProvider always returns true, so this should never happen
        throw new Error(`No provider found for model: ${model}`);
    }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let registryInstance: ProviderRegistry | null = null;

export function getRegistry(): ProviderRegistry {
    if (!registryInstance) {
        registryInstance = new ProviderRegistry();
    }
    return registryInstance;
}

export function resetRegistry(): void {
    registryInstance = null;
}
