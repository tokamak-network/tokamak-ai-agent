import { describe, it, expect, vi } from 'vitest';

// ── VS Code mock ──────────────────────────────────────────────────
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key: string, def: any) => def,
        }),
    },
    window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

import { QwenProvider } from '../api/providers/QwenProvider.js';
import { MinimaxProvider } from '../api/providers/MinimaxProvider.js';
import { GlmProvider } from '../api/providers/GlmProvider.js';
import { OpenAIProvider } from '../api/providers/OpenAIProvider.js';
import { ClaudeProvider } from '../api/providers/ClaudeProvider.js';
import { GeminiProvider } from '../api/providers/GeminiProvider.js';
import { GenericProvider } from '../api/providers/GenericProvider.js';
import { ProviderRegistry } from '../api/providers/ProviderRegistry.js';

describe('Provider Capabilities', () => {
    describe('QwenProvider', () => {
        const provider = new QwenProvider();

        it('should not have vision for qwen3-235b', () => {
            expect(provider.getCapabilities('qwen3-235b').vision).toBe(false);
        });

        it('should have vision for qwen-vl-plus', () => {
            expect(provider.getCapabilities('qwen-vl-plus').vision).toBe(true);
        });

        it('should have thinkingBlocks enabled', () => {
            expect(provider.getCapabilities('qwen3-235b').thinkingBlocks).toBe(true);
        });

        it('should have 131072 contextWindow for 235b', () => {
            expect(provider.getCapabilities('qwen3-235b').contextWindow).toBe(131072);
        });

        it('should have 65536 contextWindow for other qwen models', () => {
            expect(provider.getCapabilities('qwen3-80b-next').contextWindow).toBe(65536);
        });

        it('should not support streamUsage', () => {
            expect(provider.getCapabilities('qwen3-235b').streamUsage).toBe(false);
        });
    });

    describe('MinimaxProvider', () => {
        const provider = new MinimaxProvider();

        it('should have toolCallsToXml enabled', () => {
            expect(provider.getCapabilities('minimax-m2.5').toolCallsToXml).toBe(true);
        });

        it('should not have vision', () => {
            expect(provider.getCapabilities('minimax-m2.5').vision).toBe(false);
        });

        it('should not support streamUsage', () => {
            expect(provider.getCapabilities('minimax-m2.5').streamUsage).toBe(false);
        });
    });

    describe('GlmProvider', () => {
        const provider = new GlmProvider();

        it('should not have vision for glm-4.7', () => {
            expect(provider.getCapabilities('glm-4.7').vision).toBe(false);
        });

        it('should have vision for glm-4v', () => {
            expect(provider.getCapabilities('glm-4v').vision).toBe(true);
        });

        it('should have vision for GLM-4V (case-insensitive)', () => {
            expect(provider.getCapabilities('GLM-4V').vision).toBe(true);
        });
    });

    describe('OpenAIProvider', () => {
        const provider = new OpenAIProvider();

        it('should support streamUsage', () => {
            expect(provider.getCapabilities('gpt-4o').streamUsage).toBe(true);
        });

        it('should have vision for gpt-4o', () => {
            expect(provider.getCapabilities('gpt-4o').vision).toBe(true);
        });

        it('should have vision for gpt-4-turbo', () => {
            expect(provider.getCapabilities('gpt-4-turbo').vision).toBe(true);
        });

        it('should have vision for gpt-4-vision-preview', () => {
            expect(provider.getCapabilities('gpt-4-vision-preview').vision).toBe(true);
        });

        it('should not have vision for gpt-3.5-turbo', () => {
            expect(provider.getCapabilities('gpt-3.5-turbo').vision).toBe(false);
        });

        it('should handle o1 models', () => {
            expect(provider.canHandle('o1')).toBe(true);
            expect(provider.canHandle('o3-mini')).toBe(true);
        });
    });

    describe('ClaudeProvider', () => {
        const provider = new ClaudeProvider();

        it('should have vision for claude-3-opus', () => {
            expect(provider.getCapabilities('claude-3-opus').vision).toBe(true);
        });

        it('should have vision for claude-3.5-sonnet', () => {
            expect(provider.getCapabilities('claude-3.5-sonnet').vision).toBe(true);
        });

        it('should have 200000 contextWindow', () => {
            expect(provider.getCapabilities('claude-3-opus').contextWindow).toBe(200000);
        });
    });

    describe('GeminiProvider', () => {
        const provider = new GeminiProvider();

        it('should always have vision', () => {
            expect(provider.getCapabilities('gemini-2.5-pro').vision).toBe(true);
        });

        it('should have thinkingBlocks enabled', () => {
            expect(provider.getCapabilities('gemini-2.5-pro').thinkingBlocks).toBe(true);
        });

        it('should have 1000000 contextWindow', () => {
            expect(provider.getCapabilities('gemini-2.5-pro').contextWindow).toBe(1000000);
        });
    });

    describe('GenericProvider', () => {
        const provider = new GenericProvider();

        it('should always canHandle', () => {
            expect(provider.canHandle('anything')).toBe(true);
            expect(provider.canHandle('unknown-model-xyz')).toBe(true);
        });

        it('should detect vision from model name containing "vision"', () => {
            expect(provider.getCapabilities('some-vision-model').vision).toBe(true);
        });

        it('should detect vision from model name containing "vl"', () => {
            expect(provider.getCapabilities('some-vl-model').vision).toBe(true);
        });

        it('should not have vision for generic model names', () => {
            expect(provider.getCapabilities('llama-3').vision).toBe(false);
        });
    });

    describe('isVisionCapable regression', () => {
        // These tests verify the provider-based isVisionCapable matches the old behavior
        const registry = new ProviderRegistry();

        function isVisionCapable(model: string): boolean {
            return registry.resolve(model).getCapabilities(model).vision;
        }

        it('gpt-4o → true', () => expect(isVisionCapable('gpt-4o')).toBe(true));
        it('gpt-4-turbo → true', () => expect(isVisionCapable('gpt-4-turbo')).toBe(true));
        it('gpt-4-vision-preview → true', () => expect(isVisionCapable('gpt-4-vision-preview')).toBe(true));
        it('claude-3-opus → true', () => expect(isVisionCapable('claude-3-opus')).toBe(true));
        it('claude-3.5-sonnet → true', () => expect(isVisionCapable('claude-3.5-sonnet')).toBe(true));
        it('qwen-vl-plus → true', () => expect(isVisionCapable('qwen-vl-plus')).toBe(true));
        it('glm-4v → true', () => expect(isVisionCapable('glm-4v')).toBe(true));
        it('glm-4.7 → false', () => expect(isVisionCapable('glm-4.7')).toBe(false));
        it('qwen3-235b → false', () => expect(isVisionCapable('qwen3-235b')).toBe(false));
        it('minimax-m2.5 → false', () => expect(isVisionCapable('minimax-m2.5')).toBe(false));
        it('gemini-2.5-pro → true', () => expect(isVisionCapable('gemini-2.5-pro')).toBe(true));
        it('unknown-model → false', () => expect(isVisionCapable('unknown-model')).toBe(false));
        it('some-vision-model → true', () => expect(isVisionCapable('some-vision-model')).toBe(true));
    });
});
