import { describe, it, expect } from 'vitest';
import { detectAgreementRatio, jaccardSimilarity, computeConvergence } from '../agent/convergence.js';
import { DiscussionRound } from '../agent/types.js';

describe('detectAgreementRatio', () => {
    it('returns 0.5 for text with no agreement/disagreement keywords', () => {
        expect(detectAgreementRatio('The sky is blue today.')).toBe(0.5);
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

    it('matches word stems: agreement, correctly, acknowledged', () => {
        const ratio = detectAgreementRatio('The agreement is clear. The reviewer correctly acknowledged the approach.');
        // "agreement" → agree stem, "correctly" → correct stem, "acknowledged" → acknowledg stem
        expect(ratio).toBe(1); // all agreement, no disagreement
    });

    it('matches word stems for disagreement: challenging, issues, concerns', () => {
        const ratio = detectAgreementRatio('There are challenging issues and serious concerns about risks.');
        // "challenging" → challeng stem, "issues" → issue stem, "concerns" → concern stem, "risks" → risk stem
        expect(ratio).toBe(0); // all disagreement, no agreement
    });

    it('ignores section headers like ## Points of Agreement', () => {
        const text = '## Points of Agreement\nThe code is well-structured.\n## Points of Disagreement\nBut there are some flaws.';
        const ratio = detectAgreementRatio(text);
        // Headers stripped. Body: no strong keywords in "well-structured", "flaws" → disagree
        expect(ratio).toBeLessThan(1); // should not be pure agreement
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
        expect(result.avgStability).toBe(0); // no same-role pairs to compare
    });

    it('returns continue for 2 rounds (1 critique + 1 rebuttal) — too early to judge', () => {
        const rounds: DiscussionRound[] = [
            { round: 1, role: 'critique', content: 'There are issues with the implementation and concerns about edge cases.' },
            { round: 2, role: 'rebuttal', content: 'I accept the valid points but disagree with the risk assessment.' },
        ];
        const result = computeConvergence(rounds);
        // Only 2 rounds, different roles → no same-role pairs → avgStability=0
        // stalled requires >= 4 rounds now
        expect(result.recommendation).toBe('continue');
    });

    it('returns converged when same-role rounds are stable and agreement is high', () => {
        const critiqueBase = 'I agree the approach is correct and the solution is valid and sound. The implementation is reasonable and fair.';
        const rounds: DiscussionRound[] = [
            { round: 1, role: 'critique', content: critiqueBase },
            { round: 2, role: 'rebuttal', content: 'I accept all points. The assessment is fair and correct.' },
            { round: 3, role: 'critique', content: critiqueBase + ' No further issues found.' },
            { round: 4, role: 'rebuttal', content: 'I accept all points. The assessment is fair and correct. Agreed.' },
        ];
        const result = computeConvergence(rounds);
        expect(result.agreementRatio).toBeGreaterThanOrEqual(0.6);
        expect(result.avgStability).toBeGreaterThanOrEqual(0.7);
        expect(result.recommendation).toBe('converged');
    });

    it('returns stalled after 4+ rounds when same-role content diverges', () => {
        const rounds: DiscussionRound[] = [
            { round: 1, role: 'critique', content: 'Alpha bravo charlie delta echo foxtrot.' },
            { round: 2, role: 'rebuttal', content: 'Golf hotel india juliet kilo lima.' },
            { round: 3, role: 'critique', content: 'Xylophone quantum rhinoceros symmetry topology.' },
            { round: 4, role: 'rebuttal', content: 'Umbrella volcano waterfall xenon yellow zebra.' },
        ];
        const result = computeConvergence(rounds);
        expect(result.avgStability).toBeLessThan(0.3);
        expect(result.recommendation).toBe('stalled');
    });

    it('does NOT return stalled with only 2 rounds', () => {
        const rounds: DiscussionRound[] = [
            { round: 1, role: 'critique', content: 'Alpha bravo charlie.' },
            { round: 2, role: 'rebuttal', content: 'Xylophone quantum rhinoceros.' },
        ];
        const result = computeConvergence(rounds);
        // Even though content is completely different, 2 rounds is too early
        expect(result.recommendation).toBe('continue');
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

    it('compares same-role rounds, not consecutive rounds', () => {
        // critique1 and critique2 are very similar, but rebuttal is completely different
        const rounds: DiscussionRound[] = [
            { round: 1, role: 'critique', content: 'The code has valid structure and correct logic.' },
            { round: 2, role: 'rebuttal', content: 'Xylophone quantum rhinoceros completely different text here.' },
            { round: 3, role: 'critique', content: 'The code has valid structure and correct logic. No new issues.' },
        ];
        const result = computeConvergence(rounds);
        // critique1 ↔ critique2 are very similar → high stability
        // (if we compared consecutive: critique1↔rebuttal would be 0, rebuttal↔critique2 would be 0)
        expect(result.avgStability).toBeGreaterThan(0.5);
    });
});
