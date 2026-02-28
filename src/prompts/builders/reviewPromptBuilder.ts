import type { PromptVariant, PromptHints, ReviewStrategy } from '../types.js';
import { normalizeHints } from '../components/_helpers.js';
import { getReviewVerdictFormat, getExtendedReviewVerdictFormat, getReviewSynthesisVerdictFormat } from '../components/jsonVerdictFormat.js';

/**
 * Review critique 시스템 프롬프트.
 * 기존 getReviewCritiquePrompt() 대체.
 */
export function buildReviewCritiquePrompt(strategy: ReviewStrategy, input: PromptHints | PromptVariant = 'standard'): string {
    const hints = normalizeHints(input);
    if (strategy === 'red-team') {
        return `You are a security-focused red-team reviewer. Analyze the code changes with adversarial thinking.

Your response MUST include these sections as markdown, followed by a JSON verdict block:

## Security Risks
List each risk with severity (CRITICAL/MAJOR/MINOR):
- [SEVERITY] Description

## Edge Cases
- Unhandled edge cases that could cause failures

## Scalability Concerns
- Performance or scaling issues

## Maintenance Burden
- Long-term maintenance concerns

## Missing Requirements
- Requirements not addressed by this code

## Issue Summary
Total: X issues (Y CRITICAL, Z MAJOR, W MINOR)

---
JSON verdict (MUST be last):
${getReviewVerdictFormat(hints)}`;
    }

    return `You are a senior code reviewer engaged in a structured review dialogue.

Your response MUST include these sections as markdown, followed by a JSON verdict block:

## Points of Agreement
- Aspects of the code that are well-implemented

## Points of Disagreement
For each disagreement:
- **Claim**: What you disagree with
- **Explanation**: Why it's problematic
- **Alternative**: Suggested approach

## Unexamined Assumptions
- Assumptions the code makes that haven't been validated

## Missing Considerations
- Important aspects not addressed

---
JSON verdict (MUST be last):
${getExtendedReviewVerdictFormat(hints)}`;
}

/**
 * Review rebuttal 시스템 프롬프트.
 * 기존 getReviewRebuttalPrompt() 대체.
 */
export function buildReviewRebuttalPrompt(strategy: ReviewStrategy, input: PromptHints | PromptVariant = 'standard'): string {
    const hints = normalizeHints(input);
    if (strategy === 'red-team') {
        return `You are the original code author responding to a red-team security review.

Your response MUST include these sections as markdown, followed by a JSON block:

## Accepted Challenges
- Challenges you accept as valid, with planned fixes

## Rejected Challenges
For each rejection:
- **Challenge**: The original concern
- **Defense**: Why it's not applicable or already handled

## Revised Solution
- Summary of changes you would make based on accepted challenges

---
JSON (MUST be last):
${getReviewVerdictFormat(hints)}`;
    }

    return `You are the original code author responding to a structured code review.

Your response MUST include these sections as markdown, followed by a JSON block:

## Conceded Points
- Review points you accept as valid

## Defended Points
For each defense:
- **Original Critique**: What was criticized
- **Defense**: Why the current approach is correct or preferred
- **Evidence**: Supporting reasoning

## Refined Recommendation
- Updated assessment considering both perspectives

---
JSON (MUST be last):
${getReviewVerdictFormat(hints)}`;
}

/**
 * Review synthesis 시스템 프롬프트.
 * 기존 getReviewSynthesisPrompt() 대체.
 */
export function buildReviewSynthesisPrompt(input: PromptHints | PromptVariant = 'standard'): string {
    const hints = normalizeHints(input);
    return `You are synthesizing the results of a multi-round code review dialogue.

Given the discussion rounds below, produce a comprehensive synthesis.

Your response MUST include:

## Consensus
- Points both reviewer and author agree on

## Resolved Issues
- Issues raised and successfully addressed during the dialogue

## Remaining Concerns
- Unresolved issues that still need attention

## Final Recommendation
- Overall assessment and recommended next steps

---
JSON summary (MUST be last):
${getReviewSynthesisVerdictFormat(hints)}`;
}
