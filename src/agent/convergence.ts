import { DiscussionRound, ConvergenceMetrics } from './types.js';

// 어간(stem) 기반 매칭: \bagree 는 agree, agreement, agreed, agreeable 모두 매칭
const AGREEMENT_PATTERNS = /\b(agree|concede|conceded|valid|correct|accept|fair|acknowledg|good point|well taken|well-taken|right|sound|solid|reasonable)\w*/gi;
const DISAGREEMENT_PATTERNS = /\b(disagree|however|incorrect|challeng|oppos|flaw|problematic|issue|concern|wrong|risk|vulnerab|missing|oversight|gap)\w*/gi;

// 구조화 프롬프트에서 나오는 섹션 헤더는 제외 (키워드 카운트 왜곡 방지)
const SECTION_HEADER_RE = /^#+\s+.+$/gm;

/**
 * Detect agreement ratio from text based on agreement/disagreement keyword patterns.
 * Returns a value between 0 and 1 (agreement / (agreement + disagreement)).
 * Returns 0.5 if no patterns found.
 */
export function detectAgreementRatio(text: string): number {
    // 섹션 헤더 제거 (## Points of Agreement 같은 것이 키워드 카운트를 왜곡)
    const cleaned = text.replace(SECTION_HEADER_RE, '');
    const agreements = (cleaned.match(AGREEMENT_PATTERNS) || []).length;
    const disagreements = (cleaned.match(DISAGREEMENT_PATTERNS) || []).length;
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
 *
 * Stability는 같은 역할끼리 비교합니다 (critique1↔critique2, rebuttal1↔rebuttal2).
 * Critique↔Rebuttal은 당연히 어휘가 다르므로, 연속 라운드 비교는 오탐을 유발합니다.
 *
 * - converged: agreementRatio >= 0.55 AND avgStability >= 0.5, OR avgStability >= 0.8
 * - stalled: rounds >= 3
 * - continue: otherwise
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

    // Stability: 같은 역할끼리 비교 (critique↔critique, rebuttal↔rebuttal 등)
    // 역할별로 라운드를 그룹화
    const byRole = new Map<string, DiscussionRound[]>();
    for (const r of rounds) {
        const existing = byRole.get(r.role) || [];
        existing.push(r);
        byRole.set(r.role, existing);
    }

    let stabilitySum = 0;
    let stabilityCount = 0;
    for (const roleRounds of byRole.values()) {
        for (let i = 1; i < roleRounds.length; i++) {
            stabilitySum += jaccardSimilarity(roleRounds[i - 1].content, roleRounds[i].content);
            stabilityCount++;
        }
    }
    const avgStability = stabilityCount > 0 ? stabilitySum / stabilityCount : 0;

    const overallScore = (agreementRatio * 0.6) + (avgStability * 0.4);

    let recommendation: ConvergenceMetrics['recommendation'] = 'continue';
    if ((agreementRatio >= 0.55 && avgStability >= 0.5) || avgStability >= 0.8) {
        recommendation = 'converged';
    } else if (rounds.length >= 3) {
        // maxReviewIterations=3과 정합 — 3라운드 이상이면 stalled
        recommendation = 'stalled';
    }

    return { agreementRatio, avgStability, overallScore, recommendation };
}
