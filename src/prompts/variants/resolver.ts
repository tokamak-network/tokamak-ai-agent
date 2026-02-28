import { getRegistry } from '../../api/providers/ProviderRegistry.js';
import type { PromptVariant, PromptHints, ContextTier } from '../types.js';

const COMPACT_THRESHOLD = 32768;
const SMALL_CEILING = 65536;
const MEDIUM_CEILING = 200000;

/**
 * 모델의 contextWindow 크기에 따라 PromptVariant를 결정합니다.
 * ProviderRegistry를 활용하여 모델 감지 로직 중복을 방지합니다.
 */
export function resolveVariant(model: string): PromptVariant {
    const provider = getRegistry().resolve(model);
    const caps = provider.getCapabilities(model);
    return caps.contextWindow < COMPACT_THRESHOLD ? 'compact' : 'standard';
}

/**
 * 모델의 capabilities를 기반으로 PromptHints를 결정합니다.
 * contextWindow → ContextTier, thinkingBlocks 등을 포함합니다.
 */
export function resolveHints(model: string): PromptHints {
    const provider = getRegistry().resolve(model);
    const caps = provider.getCapabilities(model);

    const variant: PromptVariant = caps.contextWindow < COMPACT_THRESHOLD ? 'compact' : 'standard';

    let contextTier: ContextTier;
    if (caps.contextWindow <= SMALL_CEILING) {
        contextTier = 'small';
    } else if (caps.contextWindow <= MEDIUM_CEILING) {
        contextTier = 'medium';
    } else {
        contextTier = 'large';
    }

    return {
        variant,
        thinkingBlocks: caps.thinkingBlocks,
        contextTier,
    };
}
