// Types
export type { PromptVariant, ChatMode, ReviewStrategy, DebateStrategy, PromptContext, ContextTier, PromptHints } from './types.js';

// Variant resolver
export { resolveVariant, resolveHints } from './variants/resolver.js';

// Helpers
export { normalizeHints } from './components/_helpers.js';

// Builders (public API)
export { buildModePrompt } from './builders/modePromptBuilder.js';
export { buildReviewCritiquePrompt, buildReviewRebuttalPrompt, buildReviewSynthesisPrompt } from './builders/reviewPromptBuilder.js';
export { buildDebateChallengePrompt, buildDebateDefensePrompt, buildDebateSynthesisPrompt } from './builders/debatePromptBuilder.js';
export { buildAgentEngineSystemPrompt } from './builders/agentSystemPrompt.js';
