import { describe, it, expect } from 'vitest';
import { detectAgreementRatio, jaccardSimilarity, computeConvergence } from '../agent/convergence.js';
import { DiscussionRound } from '../agent/types.js';

describe('detectAgreementRatio', () => {
    it('returns 0.5 for text with no agreement/disagreement keywords', () => {
        expect(detectAgreementRatio('The sky is blue.')).toBe(0.5);
    });

    it('returns 1 for text with only agreement keywords', () => {
        expect(detectAgreementRatio('I agree, that is correct and fair.')).toBe(1);
    });

    it('returns 0 for text with only disagreement keywords', () => {
        expect(detectAgreementRatio('I disagree, that is incorrect and a flaw.')).toBe(0);
    });

    it('returns a ratio between 0 and 1 for mixed text', () => {
        const ratio = detectAgreementRatio('I agree with the first point, however the second is incorrect.');
        expect(ratio).toBeGreaterThan(0);
        expect(ratio).toBeLessThan(1);
    });

    it('handles empty string', () => {
        expect(detectAgreementRatio('')).toBe(0.5);
    });
});

describe('jaccardSimilarity', () => {
    it('returns 1 for identical texts', () => {
        expect(jaccardSimilarity('hello world test', 'hello world test')).toBe(1);
    });

    it('returns 0 for completely different texts', () => {
        expect(jaccardSimilarity('alpha beta gamma', 'delta epsilon zeta')).toBe(0);
    });

    it('returns a value between 0 and 1 for partially overlapping texts', () => {
        const sim = jaccardSimilarity('the quick brown fox', 'the slow brown dog');
        expect(sim).toBeGreaterThan(0);
        expect(sim).toBeLessThan(1);
    });

    it('ignores words shorter than 3 characters', () => {
        // "is" and "a" should be ignored, leaving only overlapping long words
        expect(jaccardSimilarity('is a test', 'is a test')).toBe(1);
    });

    it('returns 1 for two empty strings', () => {
        expect(jaccardSimilarity('', '')).toBe(1);
    });

    it('returns 0 when one string is empty', () => {
        expect(jaccardSimilarity('', 'hello world test')).toBe(0);
    });
});

describe('computeConvergence', () => {
    it('returns continue for empty rounds', () => {
        const result = computeConvergence([]);
        expect(result.recommendation).toBe('continue');
        expect(result.agreementRatio).toBe(0);
        expect(result.avgStability).toBe(0);
        expect(result.overallScore).toBe(0);
    });

    it('returns continue for a single round', () => {
        const rounds: DiscussionRound[] = [
            { round: 1, role: 'critique', content: 'I agree this is correct.' },
        ];
        const result = computeConvergence(rounds);
        expect(result.recommendation).toBe('continue');
        expect(result.avgStability).toBe(0); // no consecutive pairs
    });

    it('returns converged when agreement is high and content is stable', () => {
        const sharedText = 'I agree this approach is correct and fair. The solution is valid and well taken. The implementation looks good overall.';
        const rounds: DiscussionRound[] = [
            { round: 1, role: 'critique', content: sharedText },
            { round: 2, role: 'rebuttal', content: sharedText + ' I concede the point is valid.' },
        ];
        const result = computeConvergence(rounds);
        expect(result.agreementRatio).toBeGreaterThanOrEqual(0.7);
        expect(result.avgStability).toBeGreaterThanOrEqual(0.8);
        expect(result.recommendation).toBe('converged');
    });

    it('returns stalled when stability is very low across 2+ rounds', () => {
        const rounds: DiscussionRound[] = [
            { round: 1, role: 'critique', content: 'Alpha bravo charlie delta echo foxtrot golf hotel.' },
            { round: 2, role: 'rebuttal', content: 'Xylophone quantum rhinoceros symmetry topology uranium.' },
        ];
        const result = computeConvergence(rounds);
        expect(result.avgStability).toBeLessThan(0.3);
        expect(result.recommendation).toBe('stalled');
    });

    it('computes overallScore as weighted average', () => {
        const rounds: DiscussionRound[] = [
            { round: 1, role: 'critique', content: 'I agree this is correct.' },
            { round: 2, role: 'rebuttal', content: 'I agree this is correct.' },
        ];
        const result = computeConvergence(rounds);
        const expected = (result.agreementRatio * 0.6) + (result.avgStability * 0.4);
        expect(result.overallScore).toBeCloseTo(expected, 5);
    });
});
