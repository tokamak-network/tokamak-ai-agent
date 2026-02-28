import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── VS Code mock ──────────────────────────────────────────────────
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key: string, def: any) => def,
        }),
    },
    window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

import { ProviderRegistry } from '../api/providers/ProviderRegistry.js';
import { QwenProvider } from '../api/providers/QwenProvider.js';
import { MinimaxProvider } from '../api/providers/MinimaxProvider.js';
import { GlmProvider } from '../api/providers/GlmProvider.js';
import { OpenAIProvider } from '../api/providers/OpenAIProvider.js';
import { ClaudeProvider } from '../api/providers/ClaudeProvider.js';
import { GeminiProvider } from '../api/providers/GeminiProvider.js';
import { GenericProvider } from '../api/providers/GenericProvider.js';

describe('ProviderRegistry', () => {
    let registry: ProviderRegistry;

    beforeEach(() => {
        registry = new ProviderRegistry();
    });

    describe('resolve', () => {
        it('should resolve qwen3-235b to QwenProvider', () => {
            expect(registry.resolve('qwen3-235b')).toBeInstanceOf(QwenProvider);
        });

        it('should resolve qwen3-80b-next to QwenProvider', () => {
            expect(registry.resolve('qwen3-80b-next')).toBeInstanceOf(QwenProvider);
        });

        it('should resolve qwen3-coder-flash to QwenProvider', () => {
            expect(registry.resolve('qwen3-coder-flash')).toBeInstanceOf(QwenProvider);
        });

        it('should resolve minimax-m2.5 to MinimaxProvider', () => {
            expect(registry.resolve('minimax-m2.5')).toBeInstanceOf(MinimaxProvider);
        });

        it('should resolve glm-4.7 to GlmProvider', () => {
            expect(registry.resolve('glm-4.7')).toBeInstanceOf(GlmProvider);
        });

        it('should resolve glm-4v to GlmProvider', () => {
            expect(registry.resolve('glm-4v')).toBeInstanceOf(GlmProvider);
        });

        it('should resolve gpt-4o to OpenAIProvider', () => {
            expect(registry.resolve('gpt-4o')).toBeInstanceOf(OpenAIProvider);
        });

        it('should resolve o1 to OpenAIProvider', () => {
            expect(registry.resolve('o1')).toBeInstanceOf(OpenAIProvider);
        });

        it('should resolve o3 to OpenAIProvider', () => {
            expect(registry.resolve('o3')).toBeInstanceOf(OpenAIProvider);
        });

        it('should resolve claude-3.5-sonnet to ClaudeProvider', () => {
            expect(registry.resolve('claude-3.5-sonnet')).toBeInstanceOf(ClaudeProvider);
        });

        it('should resolve claude-3-opus to ClaudeProvider', () => {
            expect(registry.resolve('claude-3-opus')).toBeInstanceOf(ClaudeProvider);
        });

        it('should resolve gemini-2.5-pro to GeminiProvider', () => {
            expect(registry.resolve('gemini-2.5-pro')).toBeInstanceOf(GeminiProvider);
        });

        it('should resolve unknown-xyz to GenericProvider', () => {
            expect(registry.resolve('unknown-xyz')).toBeInstanceOf(GenericProvider);
        });

        it('should resolve llama-3 to GenericProvider', () => {
            expect(registry.resolve('llama-3')).toBeInstanceOf(GenericProvider);
        });
    });

    describe('caching', () => {
        it('should return the same provider instance for the same model', () => {
            const first = registry.resolve('qwen3-235b');
            const second = registry.resolve('qwen3-235b');
            expect(first).toBe(second);
        });

        it('should return different providers for different model families', () => {
            const qwen = registry.resolve('qwen3-235b');
            const openai = registry.resolve('gpt-4o');
            expect(qwen).not.toBe(openai);
        });
    });
});
