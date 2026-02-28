import { DiscussionRound, ConvergenceMetrics } from './types.js';

const AGREEMENT_PATTERNS = /\b(agree|concede|valid point|correct|accept|fair|acknowledged|good point|well taken|right)\b/gi;
const DISAGREEMENT_PATTERNS = /\b(disagree|however|incorrect|but|challenge|oppose|flaw|problematic|issue|concern|wrong)\b/gi;

/**
 * Detect agreement ratio from text based on agreement/disagreement keyword patterns.
 * Returns a value between 0 and 1 (agreement / (agreement + disagreement)).
 * Returns 0.5 if no patterns found.
 */
export function detectAgreementRatio(text: string): number {
    const agreements = (text.match(AGREEMENT_PATTERNS) || []).length;
    const disagreements = (text.match(DISAGREEMENT_PATTERNS) || []).length;
    const total = agreements + disagreements;
    if (total === 0) return 0.5;
    return agreements / total;
}

/**
 * Compute Jaccard similarity between two texts.
 * Uses words of 3+ characters only.
 * Returns a value between 0 and 1.
 */
export function jaccardSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().match(/\b\w{3,}\b/g) || []);
    const wordsB = new Set(b.toLowerCase().match(/\b\w{3,}\b/g) || []);

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const word of wordsA) {
        if (wordsB.has(word)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Compute convergence metrics from discussion rounds.
 * - agreementRatio: average agreement ratio across all rounds
 * - avgStability: average Jaccard similarity between consecutive rounds
 * - overallScore: (agreementRatio * 0.6) + (avgStability * 0.4)
 * - recommendation:
 *   - converged: agreementRatio >= 0.7 AND avgStability >= 0.8
 *   - stalled: rounds >= 2 AND avgStability < 0.3
 *   - continue: otherwise
 */
export function computeConvergence(rounds: DiscussionRound[]): ConvergenceMetrics {
    if (rounds.length === 0) {
        return {
            agreementRatio: 0,
            avgStability: 0,
            overallScore: 0,
            recommendation: 'continue',
        };
    }

    // Agreement ratio: average across all rounds
    const ratios = rounds.map(r => detectAgreementRatio(r.content));
    const agreementRatio = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;

    // Stability: average Jaccard similarity between consecutive rounds
    let stabilitySum = 0;
    let stabilityCount = 0;
    for (let i = 1; i < rounds.length; i++) {
        stabilitySum += jaccardSimilarity(rounds[i - 1].content, rounds[i].content);
        stabilityCount++;
    }
    const avgStability = stabilityCount > 0 ? stabilitySum / stabilityCount : 0;

    const overallScore = (agreementRatio * 0.6) + (avgStability * 0.4);

    let recommendation: ConvergenceMetrics['recommendation'] = 'continue';
    if (agreementRatio >= 0.7 && avgStability >= 0.8) {
        recommendation = 'converged';
    } else if (rounds.length >= 2 && avgStability < 0.3) {
        recommendation = 'stalled';
    }

    return { agreementRatio, avgStability, overallScore, recommendation };
}
