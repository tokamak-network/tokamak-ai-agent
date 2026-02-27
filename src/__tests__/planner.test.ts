import { describe, it, expect, beforeEach } from 'vitest';
import { Planner } from '../agent/planner.js';

describe('Planner.parsePlan', () => {
    let planner: Planner;

    beforeEach(() => {
        planner = new Planner();
    });

    describe('markdown checklist format', () => {
        it('parses basic - [ ] checklist items', () => {
            const text = '- [ ] Install dependencies\n- [ ] Write tests\n- [ ] Deploy';
            const steps = planner.parsePlan(text);
            expect(steps).toHaveLength(3);
            expect(steps[0].description).toBe('Install dependencies');
            expect(steps[1].description).toBe('Write tests');
            expect(steps[2].description).toBe('Deploy');
        });

        it('parses completed - [x] items with pending status', () => {
            const text = '- [x] Step one done\n- [ ] Step two pending';
            const steps = planner.parsePlan(text);
            expect(steps).toHaveLength(2);
            expect(steps[0].status).toBe('pending');
        });

        it('assigns sequential IDs when no explicit ID', () => {
            const text = '- [ ] First step\n- [ ] Second step';
            const steps = planner.parsePlan(text);
            expect(steps[0].id).toBe('step-0');
            expect(steps[1].id).toBe('step-1');
        });

        it('extracts explicit step IDs', () => {
            const text = '- [ ] setup: Install packages\n- [ ] build: Compile code';
            const steps = planner.parsePlan(text);
            expect(steps[0].id).toBe('setup');
            expect(steps[0].description).toBe('Install packages');
            expect(steps[1].id).toBe('build');
        });

        it('parses depends-on annotation', () => {
            const text = '- [ ] deploy: Deploy app [depends: build, test]';
            const steps = planner.parsePlan(text);
            expect(steps[0].dependsOn).toEqual(['build', 'test']);
            expect(steps[0].description).toBe('Deploy app');
        });

        it('returns empty array for empty string', () => {
            expect(planner.parsePlan('')).toHaveLength(0);
        });

        it('returns empty array for text without plan markers', () => {
            const text = 'This is just a regular response without any plan.';
            expect(planner.parsePlan(text)).toHaveLength(0);
        });
    });

    describe('numbered list format', () => {
        it('parses numbered list items', () => {
            const text = '1. First step\n2. Second step\n3. Third step';
            const steps = planner.parsePlan(text);
            expect(steps).toHaveLength(3);
            expect(steps[0].description).toBe('First step');
            expect(steps[1].description).toBe('Second step');
            expect(steps[2].description).toBe('Third step');
        });

        it('assigns step IDs for numbered items', () => {
            const text = '1. Do something\n2. Do something else';
            const steps = planner.parsePlan(text);
            expect(steps[0].id).toBe('step-0');
            expect(steps[1].id).toBe('step-1');
        });

        it('handles mixed numbered and checklist format', () => {
            const text = '1. First\n- [ ] Second';
            const steps = planner.parsePlan(text);
            expect(steps.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('JSON plan format', () => {
        it('parses JSON plan with type:plan and payload array', () => {
            const text = '{"type":"plan","payload":["- [ ] Step one","- [ ] Step two"]}';
            const steps = planner.parsePlan(text);
            expect(steps).toHaveLength(2);
            expect(steps[0].description).toBe('Step one');
            expect(steps[1].description).toBe('Step two');
        });

        it('falls back to markdown parsing when JSON is invalid', () => {
            const text = '{invalid json}\n- [ ] Regular step';
            const steps = planner.parsePlan(text);
            expect(steps).toHaveLength(1);
            expect(steps[0].description).toBe('Regular step');
        });

        it('falls back to markdown when JSON has wrong structure', () => {
            const text = '{"type":"other","data":[]}\n- [ ] Step A';
            const steps = planner.parsePlan(text);
            expect(steps).toHaveLength(1);
        });
    });
});
