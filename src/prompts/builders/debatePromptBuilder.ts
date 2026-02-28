import type { PromptVariant, PromptHints, DebateStrategy } from '../types.js';
import { normalizeHints } from '../components/_helpers.js';
import { getDebateVerdictFormat, getDebateSynthesisVerdictFormat } from '../components/jsonVerdictFormat.js';

/**
 * Debate challenge 시스템 프롬프트.
 * 기존 getDebateChallengePrompt() 대체.
 */
export function buildDebateChallengePrompt(strategy: DebateStrategy, input: PromptHints | PromptVariant = 'standard'): string {
    const hints = normalizeHints(input);
    if (strategy === 'perspectives') {
        return `You are analyzing this plan from a specific analytical lens.

**If assigned "risk-analysis" role**: Focus on risks, failure modes, security concerns, and worst-case scenarios.
**If assigned "innovation-analysis" role**: Focus on opportunities, novel approaches, potential improvements, and best-case outcomes.

Your response MUST include:

## Analysis (from your assigned lens)
- Key observations from your perspective

## Recommendations
- Concrete suggestions aligned with your lens

## Confidence Assessment
- How confident are you in this plan's success (from your lens)?

---
JSON (MUST be last):
${getDebateVerdictFormat(hints)}`;
    }

    return `You are a software architecture critic engaged in a structured debate about a development plan.

Your response MUST include these sections as markdown, followed by a JSON block:

## Structural Concerns
- Issues with the plan's architecture or organization

## Missing Steps
- Steps that should be added

## Risk Assessment
- Potential risks and their likelihood

## Alternative Approaches
- Different ways to achieve the same goal

---
JSON (MUST be last):
${getDebateVerdictFormat(hints)}`;
}

/**
 * Debate defense 시스템 프롬프트.
 * 기존 getDebateDefensePrompt() 대체.
 */
export function buildDebateDefensePrompt(strategy: DebateStrategy, input: PromptHints | PromptVariant = 'standard'): string {
    const hints = normalizeHints(input);
    if (strategy === 'perspectives') {
        return `You are performing a cross-review of analyses from different perspectives (risk vs. innovation).

Your response MUST include:

## Cross-Review Summary
- Where the risk analysis and innovation analysis agree
- Where they diverge

## Balanced Recommendation
- A recommendation that incorporates both perspectives

## Remaining Risks
- Risks that still need mitigation

---
JSON (MUST be last):
${getDebateVerdictFormat(hints)}`;
    }

    return `You are the original plan author responding to a structured critique.

Your response MUST include these sections as markdown, followed by a JSON block:

## Conceded Points
- Critique points you accept

## Defended Points
For each defense:
- **Critique**: The original concern
- **Defense**: Why the current plan handles this
- **Evidence**: Supporting reasoning

## Revised Plan
- Summary of adjustments based on valid concerns

---
JSON (MUST be last):
${getDebateVerdictFormat(hints)}`;
}

/**
 * Debate synthesis 시스템 프롬프트.
 * 기존 getDebateSynthesisPrompt() 대체.
 */
export function buildDebateSynthesisPrompt(input: PromptHints | PromptVariant = 'standard'): string {
    const hints = normalizeHints(input);
    return `You are synthesizing the results of a multi-round plan debate.

Given the discussion rounds below, produce a comprehensive synthesis.

Your response MUST include:

## Consensus Points
- Areas where all participants agree

## Key Divergences
- Areas where disagreement remains

## Convergence Assessment
- How close the discussion came to agreement

## Recommended Plan Adjustments
- Specific changes to the plan based on the debate

---
JSON summary (MUST be last):
${getDebateSynthesisVerdictFormat(hints)}`;
}
