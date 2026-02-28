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

import { buildModePrompt, buildReviewCritiquePrompt, buildReviewRebuttalPrompt, buildReviewSynthesisPrompt, buildDebateChallengePrompt, buildDebateDefensePrompt, buildDebateSynthesisPrompt, buildAgentEngineSystemPrompt, resolveVariant, resolveHints, normalizeHints } from '../prompts/index.js';
import type { PromptContext, PromptHints } from '../prompts/index.js';

// ── Test helpers ──────────────────────────────────────────────────

function makeCtx(variant: 'standard' | 'compact' = 'standard'): PromptContext {
    return {
        workspaceInfo: ' Workspace: test-project',
        projectStructure: 'src/\n  index.ts',
        projectKnowledge: '',
        variant,
    };
}

// ── buildModePrompt ──────────────────────────────────────────────

describe('buildModePrompt', () => {
    it('ask mode includes FILE_OPERATION read format', () => {
        const result = buildModePrompt('ask', makeCtx());
        expect(result).toContain('FILE_OPERATION');
        expect(result).toContain('TYPE: read');
        expect(result).toContain('helpful coding assistant');
    });

    it('plan mode includes plan output format and read instructions', () => {
        const result = buildModePrompt('plan', makeCtx());
        expect(result).toContain('software architect');
        expect(result).toContain('FILE_OPERATION');
        expect(result).toContain('Overview');
        expect(result).toContain('Steps');
    });

    it('agent mode includes full FILE_OPERATION format', () => {
        const result = buildModePrompt('agent', makeCtx());
        expect(result).toContain('FILE_OPERATION');
        expect(result).toContain('create|write_full|replace|prepend|append|delete|read');
        expect(result).toContain('ONE block per file');
        expect(result).toContain('autonomous coding agent');
    });

    it('agent mode includes SEARCH/REPLACE instructions', () => {
        const result = buildModePrompt('agent', makeCtx());
        expect(result).toContain('SEARCH:');
        expect(result).toContain('REPLACE:');
    });

    it('includes workspace info and project structure', () => {
        const ctx = makeCtx();
        ctx.workspaceInfo = ' Workspace: my-app';
        ctx.projectStructure = 'src/\n  main.ts';
        const result = buildModePrompt('ask', ctx);
        expect(result).toContain('Workspace: my-app');
        expect(result).toContain('main.ts');
    });

    it('compact variant produces shorter output than standard', () => {
        const standard = buildModePrompt('agent', makeCtx('standard'));
        const compact = buildModePrompt('agent', makeCtx('compact'));
        expect(compact.length).toBeLessThan(standard.length);
    });

    it('unknown mode returns empty string', () => {
        const result = buildModePrompt('unknown' as any, makeCtx());
        expect(result).toBe('');
    });
});

// ── buildReviewCritiquePrompt ────────────────────────────────────

describe('buildReviewCritiquePrompt', () => {
    it('review strategy includes Points of Agreement', () => {
        const result = buildReviewCritiquePrompt('review');
        expect(result).toContain('Points of Agreement');
        expect(result).toContain('Points of Disagreement');
        expect(result).toContain('PASS');
        expect(result).toContain('NEEDS_FIX');
    });

    it('red-team strategy includes Security Risks', () => {
        const result = buildReviewCritiquePrompt('red-team');
        expect(result).toContain('Security Risks');
        expect(result).toContain('Edge Cases');
        expect(result).toContain('red-team');
    });

    it('includes JSON verdict format', () => {
        const result = buildReviewCritiquePrompt('review');
        expect(result).toContain('"verdict"');
        expect(result).toContain('"issues"');
    });
});

// ── buildReviewRebuttalPrompt ────────────────────────────────────

describe('buildReviewRebuttalPrompt', () => {
    it('review strategy includes Conceded Points', () => {
        const result = buildReviewRebuttalPrompt('review');
        expect(result).toContain('Conceded Points');
        expect(result).toContain('Defended Points');
    });

    it('red-team strategy includes Accepted Challenges', () => {
        const result = buildReviewRebuttalPrompt('red-team');
        expect(result).toContain('Accepted Challenges');
        expect(result).toContain('Rejected Challenges');
    });
});

// ── buildReviewSynthesisPrompt ───────────────────────────────────

describe('buildReviewSynthesisPrompt', () => {
    it('includes synthesis sections', () => {
        const result = buildReviewSynthesisPrompt();
        expect(result).toContain('Consensus');
        expect(result).toContain('Resolved Issues');
        expect(result).toContain('Remaining Concerns');
        expect(result).toContain('resolvedCount');
    });
});

// ── buildDebateChallengePrompt ───────────────────────────────────

describe('buildDebateChallengePrompt', () => {
    it('debate strategy includes Structural Concerns', () => {
        const result = buildDebateChallengePrompt('debate');
        expect(result).toContain('Structural Concerns');
        expect(result).toContain('Missing Steps');
        expect(result).toContain('APPROVE');
        expect(result).toContain('CHALLENGE');
    });

    it('perspectives strategy includes analytical lens', () => {
        const result = buildDebateChallengePrompt('perspectives');
        expect(result).toContain('risk-analysis');
        expect(result).toContain('innovation-analysis');
        expect(result).toContain('Confidence Assessment');
    });
});

// ── buildDebateDefensePrompt ─────────────────────────────────────

describe('buildDebateDefensePrompt', () => {
    it('debate strategy includes Conceded Points', () => {
        const result = buildDebateDefensePrompt('debate');
        expect(result).toContain('Conceded Points');
        expect(result).toContain('Revised Plan');
    });

    it('perspectives strategy includes Cross-Review', () => {
        const result = buildDebateDefensePrompt('perspectives');
        expect(result).toContain('Cross-Review Summary');
        expect(result).toContain('Balanced Recommendation');
    });
});

// ── buildDebateSynthesisPrompt ───────────────────────────────────

describe('buildDebateSynthesisPrompt', () => {
    it('includes synthesis sections', () => {
        const result = buildDebateSynthesisPrompt();
        expect(result).toContain('Consensus Points');
        expect(result).toContain('Key Divergences');
        expect(result).toContain('consensusCount');
    });
});

// ── buildAgentEngineSystemPrompt ─────────────────────────────────

describe('buildAgentEngineSystemPrompt', () => {
    it('standard variant includes SEARCH/REPLACE format', () => {
        const result = buildAgentEngineSystemPrompt('standard');
        expect(result).toContain('SEARCH/REPLACE');
        expect(result).toContain('NO tool calls');
        expect(result).toContain('expert AI coding agent');
    });

    it('compact variant is shorter than standard', () => {
        const standard = buildAgentEngineSystemPrompt('standard');
        const compact = buildAgentEngineSystemPrompt('compact');
        expect(compact.length).toBeLessThan(standard.length);
    });

    it('defaults to standard variant', () => {
        const result = buildAgentEngineSystemPrompt();
        const standard = buildAgentEngineSystemPrompt('standard');
        expect(result).toBe(standard);
    });
});

// ── resolveVariant ───────────────────────────────────────────────

describe('resolveVariant', () => {
    it('qwen3-235b resolves to standard (large context)', () => {
        expect(resolveVariant('qwen3-235b')).toBe('standard');
    });

    it('large context model resolves to standard', () => {
        // gpt-4o has large context
        expect(resolveVariant('gpt-4o')).toBe('standard');
    });

    it('unknown model falls back to GenericProvider → standard', () => {
        // GenericProvider defaults to 128k context
        expect(resolveVariant('some-unknown-model')).toBe('standard');
    });
});

// ── resolveHints ────────────────────────────────────────────────

describe('resolveHints', () => {
    it('Qwen3-235b → thinkingBlocks=true, contextTier=medium', () => {
        const hints = resolveHints('qwen3-235b');
        expect(hints.thinkingBlocks).toBe(true);
        expect(hints.contextTier).toBe('medium');
        expect(hints.variant).toBe('standard');
    });

    it('Qwen3 (non-235b) → thinkingBlocks=true, contextTier=small', () => {
        const hints = resolveHints('qwen3-30b-a3b');
        expect(hints.thinkingBlocks).toBe(true);
        expect(hints.contextTier).toBe('small');
    });

    it('Gemini → thinkingBlocks=true, contextTier=large', () => {
        const hints = resolveHints('gemini-2.5-pro');
        expect(hints.thinkingBlocks).toBe(true);
        expect(hints.contextTier).toBe('large');
    });

    it('Minimax → contextTier=small', () => {
        const hints = resolveHints('minimax-text-01');
        expect(hints.contextTier).toBe('small');
        expect(hints.thinkingBlocks).toBe(false);
    });

    it('Claude → contextTier=medium', () => {
        const hints = resolveHints('claude-sonnet-4-20250514');
        expect(hints.contextTier).toBe('medium');
    });

    it('OpenAI → contextTier=medium', () => {
        const hints = resolveHints('gpt-4o');
        expect(hints.contextTier).toBe('medium');
    });

    it('unknown model → GenericProvider defaults (small, no thinking)', () => {
        const hints = resolveHints('some-unknown-model');
        expect(hints.contextTier).toBe('small');
        expect(hints.thinkingBlocks).toBe(false);
    });
});

// ── normalizeHints ──────────────────────────────────────────────

describe('normalizeHints', () => {
    it('string "standard" → PromptHints with medium tier', () => {
        const hints = normalizeHints('standard');
        expect(hints.variant).toBe('standard');
        expect(hints.thinkingBlocks).toBe(false);
        expect(hints.contextTier).toBe('medium');
    });

    it('string "compact" → PromptHints with small tier', () => {
        const hints = normalizeHints('compact');
        expect(hints.variant).toBe('compact');
        expect(hints.contextTier).toBe('small');
    });

    it('PromptHints object passes through unchanged', () => {
        const input: PromptHints = { variant: 'standard', thinkingBlocks: true, contextTier: 'large' };
        const hints = normalizeHints(input);
        expect(hints).toBe(input);
    });
});

// ── thinking preamble in verdicts ───────────────────────────────

describe('thinking preamble in verdicts', () => {
    const thinkingHints: PromptHints = { variant: 'standard', thinkingBlocks: true, contextTier: 'medium' };
    const noThinkingHints: PromptHints = { variant: 'standard', thinkingBlocks: false, contextTier: 'medium' };

    it('review critique includes <think> preamble when thinkingBlocks=true', () => {
        const result = buildReviewCritiquePrompt('review', thinkingHints);
        expect(result).toContain('<think>');
    });

    it('review critique excludes <think> preamble when thinkingBlocks=false', () => {
        const result = buildReviewCritiquePrompt('review', noThinkingHints);
        expect(result).not.toContain('<think>');
    });

    it('debate challenge includes <think> preamble when thinkingBlocks=true', () => {
        const result = buildDebateChallengePrompt('debate', thinkingHints);
        expect(result).toContain('<think>');
    });

    it('synthesis includes <think> preamble when thinkingBlocks=true', () => {
        const reviewResult = buildReviewSynthesisPrompt(thinkingHints);
        const debateResult = buildDebateSynthesisPrompt(thinkingHints);
        expect(reviewResult).toContain('<think>');
        expect(debateResult).toContain('<think>');
    });

    it('backward compat: string variant still works without thinking', () => {
        const result = buildReviewCritiquePrompt('review', 'standard');
        expect(result).not.toContain('<think>');
        expect(result).toContain('"verdict"');
    });
});

// ── contextTier-based prompt differences ────────────────────────

describe('contextTier-based prompts', () => {
    const smallHints: PromptHints = { variant: 'standard', thinkingBlocks: false, contextTier: 'small' };
    const mediumHints: PromptHints = { variant: 'standard', thinkingBlocks: false, contextTier: 'medium' };
    const largeHints: PromptHints = { variant: 'standard', thinkingBlocks: true, contextTier: 'large' };

    it('small tier agent mode prompt is shorter than medium', () => {
        const smallCtx: PromptContext = { workspaceInfo: '', projectStructure: '', projectKnowledge: '', variant: 'standard', hints: smallHints };
        const mediumCtx: PromptContext = { workspaceInfo: '', projectStructure: '', projectKnowledge: '', variant: 'standard', hints: mediumHints };
        const small = buildModePrompt('agent', smallCtx);
        const medium = buildModePrompt('agent', mediumCtx);
        expect(small.length).toBeLessThan(medium.length);
    });

    it('large tier includes exploration-first and extra edit example', () => {
        const largeCtx: PromptContext = { workspaceInfo: '', projectStructure: '', projectKnowledge: '', variant: 'standard', hints: largeHints };
        const result = buildModePrompt('agent', largeCtx);
        expect(result).toContain('Exploration first');
        expect(result).toContain('Example (edit)');
    });

    it('small tier omits examples', () => {
        const smallCtx: PromptContext = { workspaceInfo: '', projectStructure: '', projectKnowledge: '', variant: 'standard', hints: smallHints };
        const result = buildModePrompt('agent', smallCtx);
        expect(result).not.toContain('Example:');
    });

    it('agent system prompt includes thinking rule for thinking models', () => {
        const result = buildAgentEngineSystemPrompt(largeHints);
        expect(result).toContain('Structured thinking');
        expect(result).toContain('<think>');
        expect(result).toContain('Exploration first');
    });

    it('agent system prompt excludes thinking/exploration for standard models', () => {
        const result = buildAgentEngineSystemPrompt(mediumHints);
        expect(result).not.toContain('Structured thinking');
        expect(result).not.toContain('Exploration first');
    });
});
