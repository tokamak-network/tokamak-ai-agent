import type { PromptVariant, PromptHints } from '../types.js';

/**
 * PromptHints | PromptVariant → PromptHints 정규화.
 * 기존 PromptVariant 문자열을 전달하는 호출부와의 하위 호환을 유지합니다.
 */
export function normalizeHints(input: PromptHints | PromptVariant): PromptHints {
    if (typeof input === 'string') {
        return {
            variant: input,
            thinkingBlocks: false,
            contextTier: input === 'compact' ? 'small' : 'medium',
        };
    }
    return input;
}
