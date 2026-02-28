import type { PromptVariant, PromptHints } from '../types.js';
import { normalizeHints } from './_helpers.js';

/**
 * thinkingBlocks가 true일 때 JSON 출력 앞에 추가할 프리앰블.
 */
function thinkingPreamble(hints: PromptHints): string {
    if (!hints.thinkingBlocks) return '';
    return `Before outputting the JSON verdict, reason through your analysis step by step inside a <think> block. Then output ONLY the JSON.\n`;
}

/**
 * Review verdict JSON 포맷 — critique/rebuttal 공통.
 * { verdict: PASS|NEEDS_FIX, summary, issues[] }
 */
export function getReviewVerdictFormat(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);
    const preamble = thinkingPreamble(hints);
    if (hints.variant === 'compact') {
        return `${preamble}{ "verdict": "PASS" | "NEEDS_FIX", "summary": "...", "issues": [{ "severity": "critical"|"major"|"minor", "description": "...", "suggestion": "..." }] }`;
    }

    return `${preamble}{ "verdict": "PASS" | "NEEDS_FIX", "summary": "...", "issues": [{ "severity": "critical"|"major"|"minor", "description": "...", "suggestion": "..." }] }`;
}

/**
 * Extended review verdict — pointsOfAgreement, pointsOfDisagreement 등 포함 (review strategy).
 */
export function getExtendedReviewVerdictFormat(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);
    const preamble = thinkingPreamble(hints);
    if (hints.variant === 'compact') {
        return `${preamble}{ "verdict": "PASS" | "NEEDS_FIX", "summary": "...", "issues": [...], "pointsOfAgreement": [...], "pointsOfDisagreement": [{ "claim": "...", "explanation": "...", "alternative": "..." }], "unexaminedAssumptions": [...], "missingConsiderations": [...] }`;
    }

    return `${preamble}{ "verdict": "PASS" | "NEEDS_FIX", "summary": "...", "issues": [{ "severity": "critical"|"major"|"minor", "description": "...", "suggestion": "..." }], "pointsOfAgreement": [...], "pointsOfDisagreement": [{ "claim": "...", "explanation": "...", "alternative": "..." }], "unexaminedAssumptions": [...], "missingConsiderations": [...] }`;
}

/**
 * Debate verdict JSON 포맷 — challenge/defense 공통.
 * { verdict: APPROVE|CHALLENGE, concerns[], suggestions[] }
 */
export function getDebateVerdictFormat(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);
    const preamble = thinkingPreamble(hints);
    if (hints.variant === 'compact') {
        return `${preamble}{ "verdict": "APPROVE" | "CHALLENGE", "concerns": [...], "suggestions": [...] }`;
    }

    return `${preamble}{ "verdict": "APPROVE" | "CHALLENGE", "concerns": [...], "suggestions": [...] }`;
}

/**
 * Review synthesis JSON 포맷.
 */
export function getReviewSynthesisVerdictFormat(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);
    const preamble = thinkingPreamble(hints);
    if (hints.variant === 'compact') {
        return `${preamble}{ "verdict": "PASS" | "NEEDS_FIX", "summary": "...", "resolvedCount": N, "remainingCount": N }`;
    }

    return `${preamble}{ "verdict": "PASS" | "NEEDS_FIX", "summary": "final synthesis summary", "resolvedCount": N, "remainingCount": N }`;
}

/**
 * Debate synthesis JSON 포맷.
 */
export function getDebateSynthesisVerdictFormat(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);
    const preamble = thinkingPreamble(hints);
    if (hints.variant === 'compact') {
        return `${preamble}{ "verdict": "APPROVE" | "CHALLENGE", "summary": "...", "consensusCount": N, "divergenceCount": N }`;
    }

    return `${preamble}{ "verdict": "APPROVE" | "CHALLENGE", "summary": "final synthesis summary", "consensusCount": N, "divergenceCount": N }`;
}
