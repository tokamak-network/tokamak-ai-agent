import { describe, it, expect } from 'vitest';
import { getActiveRules, formatRulesForPrompt, matchesCondition } from '../rules/ruleEvaluator.js';
import type { Rule } from '../rules/ruleTypes.js';

const rules: Rule[] = [
    {
        id: 'ts-conv',
        description: 'TypeScript conventions',
        condition: { languages: ['typescript'], modes: ['agent'] },
        priority: 10,
        content: '- Use strict TS',
        source: 'ts.md',
    },
    {
        id: 'general',
        description: 'General rules',
        condition: {},
        priority: 5,
        content: '- Be clean',
        source: 'general.md',
    },
    {
        id: 'py-conv',
        description: 'Python conventions',
        condition: { languages: ['python'] },
        priority: 8,
        content: '- Use type hints',
        source: 'py.md',
    },
];

describe('matchesCondition', () => {
    it('matches everything when condition is empty', () => {
        expect(matchesCondition({}, 'typescript', 'agent')).toBe(true);
        expect(matchesCondition({}, 'python', 'plan')).toBe(true);
        expect(matchesCondition({}, 'go', 'chat')).toBe(true);
    });

    it('matches when language is in the condition list', () => {
        const condition = { languages: ['typescript', 'typescriptreact'] };
        expect(matchesCondition(condition, 'typescript', 'agent')).toBe(true);
    });

    it('does not match when language is not in the condition list', () => {
        const condition = { languages: ['typescript'] };
        expect(matchesCondition(condition, 'python', 'agent')).toBe(false);
    });

    it('matches when mode is in the condition list', () => {
        const condition = { modes: ['agent', 'plan'] };
        expect(matchesCondition(condition, 'typescript', 'agent')).toBe(true);
    });

    it('does not match when mode is not in the condition list', () => {
        const condition = { modes: ['plan'] };
        expect(matchesCondition(condition, 'typescript', 'agent')).toBe(false);
    });
});

describe('getActiveRules', () => {
    it('filters rules by language and mode', () => {
        const active = getActiveRules(rules, 'typescript', 'agent');
        // Should include ts-conv (typescript + agent) and general (no condition)
        // Should NOT include py-conv (python only)
        expect(active.map(r => r.id)).toContain('ts-conv');
        expect(active.map(r => r.id)).toContain('general');
        expect(active.map(r => r.id)).not.toContain('py-conv');
    });

    it('returns rules with no conditions regardless of context', () => {
        const active = getActiveRules(rules, 'go', 'chat');
        // Only general has no language/mode restrictions
        expect(active.map(r => r.id)).toContain('general');
    });

    it('returns results sorted by priority descending', () => {
        const active = getActiveRules(rules, 'typescript', 'agent');
        for (let i = 1; i < active.length; i++) {
            expect(active[i - 1].priority).toBeGreaterThanOrEqual(active[i].priority);
        }
        // Specifically: ts-conv (10) should come before general (5)
        const tsIdx = active.findIndex(r => r.id === 'ts-conv');
        const genIdx = active.findIndex(r => r.id === 'general');
        expect(tsIdx).toBeLessThan(genIdx);
    });
});

describe('formatRulesForPrompt', () => {
    it('formats rules with description and content', () => {
        const active = getActiveRules(rules, 'typescript', 'agent');
        const output = formatRulesForPrompt(active);

        expect(output).toContain('## Project Rules');
        expect(output).toContain('### TypeScript conventions');
        expect(output).toContain('- Use strict TS');
        expect(output).toContain('### General rules');
        expect(output).toContain('- Be clean');
    });

    it('returns empty string when no rules are provided', () => {
        const output = formatRulesForPrompt([]);
        expect(output).toBe('');
    });
});
