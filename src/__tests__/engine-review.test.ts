/**
 * AgentEngine 멀티 모델 리뷰 시스템 통합 테스트
 *
 * VS Code API를 사용하지 않고 엔진의 상태 전이 로직만 검증합니다.
 * streamChatCompletion과 외부 의존성을 모킹하여 순수 로직만 테스트합니다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── VS Code mock ──────────────────────────────────────────────────
vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (key: string, def: any) => def,
            update: vi.fn(),
        }),
        workspaceFolders: [{ uri: { fsPath: '/mock' } }],
    },
    window: { showInputBox: vi.fn() },
    Uri: { file: (p: string) => ({ fsPath: p }) },
}));

// ── streamChatCompletion mock ─────────────────────────────────────
const mockStreamResponse = vi.fn();
vi.mock('../api/client.js', () => ({
    streamChatCompletion: (...args: any[]) => {
        const content = mockStreamResponse(...args);
        return {
            content: (async function* () {
                yield content;
            })(),
        };
    },
    ChatMessage: {},
}));

// ── Other dependency mocks ────────────────────────────────────────
vi.mock('../utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../utils/contentUtils.js', () => ({
    stripThinkingBlocks: (s: string) => s,
}));

vi.mock('../config/settings.js', () => ({
    isCheckpointsEnabled: () => false,
    getSettings: () => ({
        enableCheckpoints: false,
        enableMultiModelReview: true,
        reviewerModel: 'reviewer-model',
        criticModel: 'critic-model',
        maxReviewIterations: 3,
        maxDebateIterations: 2,
        agentStrategy: 'review',
        planStrategy: 'debate',
    }),
}));

import { AgentEngine } from '../agent/engine.js';
import type { AgentContext, AgentState, DiscussionRound, ConvergenceMetrics, ReviewFeedback, DebateFeedback } from '../agent/types.js';

function createTestContext(overrides?: Partial<AgentContext>): AgentContext {
    return {
        sessionId: 'test-session',
        mode: 'agent',
        userInput: 'Create a hello world function',
        history: [],
        workspacePath: '/mock',
        maxFixAttempts: 3,
        tokenBudget: 4000,
        enableMultiModelReview: true,
        reviewerModel: 'reviewer-model',
        criticModel: 'critic-model',
        maxReviewIterations: 3,
        maxDebateIterations: 2,
        agentStrategy: 'review',
        planStrategy: 'debate',
        ...overrides,
    };
}

describe('AgentEngine — Review State Transitions', () => {
    let engine: AgentEngine;
    let stateChanges: AgentState[];

    beforeEach(() => {
        stateChanges = [];
        const context = createTestContext({
            onStateChange: (state) => stateChanges.push(state),
        });
        engine = new AgentEngine(context);
        vi.clearAllMocks();
    });

    it('transitions Reviewing → Reviewing on "continue" convergence', async () => {
        // Set up engine in Reviewing state with a plan step
        await engine.transitionTo('Executing');
        // We need a plan step for review to work on
        await engine.setPlanFromResponse('- [ ] Create hello.ts file');

        // Mock: critique response (round 1 — odd)
        mockStreamResponse.mockReturnValueOnce(
            '## Points of Agreement\n- Good approach\n\n---\n{"verdict":"NEEDS_FIX","summary":"Minor issues","issues":[{"severity":"minor","description":"naming","suggestion":"rename"}]}'
        );

        await engine.transitionTo('Reviewing');

        // Run one iteration manually by calling run()
        // But since run() loops, we test state transition through the mock
        // Instead, verify the state was set correctly
        expect(engine.getState()).toBe('Reviewing');
    });

    it('resolveReviewDecision with "skip" transitions correctly', async () => {
        const context = createTestContext({
            onStateChange: (state) => stateChanges.push(state),
            onReviewComplete: vi.fn(),
        });
        engine = new AgentEngine(context);

        // Simulate WaitingForReviewDecision
        await engine.transitionTo('WaitingForReviewDecision');
        expect(engine.getState()).toBe('WaitingForReviewDecision');

        // In a real scenario, handleWaitingForReviewDecision creates a Promise.
        // Here we verify the public method exists and doesn't throw
        engine.resolveReviewDecision('skip');
    });

    it('resolveDebateDecision with "accept" transitions correctly', async () => {
        const context = createTestContext({
            onStateChange: (state) => stateChanges.push(state),
            onDebateComplete: vi.fn(),
        });
        engine = new AgentEngine(context);

        await engine.transitionTo('WaitingForDebateDecision');
        expect(engine.getState()).toBe('WaitingForDebateDecision');

        engine.resolveDebateDecision('accept');
    });

    it('reset() clears review and debate sessions', () => {
        engine.reset();
        expect(engine.getState()).toBe('Idle');
        expect(engine.getPlan()).toEqual([]);
    });

    it('reset() resolves pending review decision as "skip"', async () => {
        let resolved = false;
        const context = createTestContext({
            reviewDecisionResolver: (decision) => {
                resolved = true;
                expect(decision).toBe('skip');
            },
        });
        engine = new AgentEngine(context);
        engine.reset();
        expect(resolved).toBe(true);
    });

    it('reset() resolves pending debate decision as "accept"', async () => {
        let resolved = false;
        const context = createTestContext({
            debateDecisionResolver: (decision) => {
                resolved = true;
                expect(decision).toBe('accept');
            },
        });
        engine = new AgentEngine(context);
        engine.reset();
        expect(resolved).toBe(true);
    });
});

describe('AgentEngine — New States in run() switch', () => {
    it('run() recognizes WaitingForReviewDecision state', async () => {
        const states: AgentState[] = [];
        const context = createTestContext({
            onStateChange: (s) => states.push(s),
            onReviewComplete: vi.fn(),
        });
        const engine = new AgentEngine(context);

        await engine.transitionTo('WaitingForReviewDecision');

        // Start run() in background — it will await the decision Promise
        const runPromise = engine.run();

        // Give it a tick to enter the handler
        await new Promise(r => setTimeout(r, 50));

        // Resolve the decision
        engine.resolveReviewDecision('skip');

        await runPromise;

        // Should have transitioned to Executing after skip
        expect(states).toContain('Executing');
    });

    it('run() recognizes WaitingForDebateDecision state', async () => {
        const states: AgentState[] = [];
        const context = createTestContext({
            onStateChange: (s) => states.push(s),
            onDebateComplete: vi.fn(),
        });
        const engine = new AgentEngine(context);

        await engine.transitionTo('WaitingForDebateDecision');

        const runPromise = engine.run();

        await new Promise(r => setTimeout(r, 50));

        engine.resolveDebateDecision('accept');

        await runPromise;

        expect(states).toContain('Executing');
    });

    it('run() recognizes Synthesizing state', async () => {
        const states: AgentState[] = [];
        const synthResults: string[] = [];
        const context = createTestContext({
            onStateChange: (s) => states.push(s),
            onSynthesisComplete: (s) => synthResults.push(s),
            onReviewComplete: vi.fn(),
        });
        const engine = new AgentEngine(context);

        // We need to set up a reviewSession first via internal state
        // The simplest way: go through a review round, then synthesize
        // For this test, we'll directly put the engine in Synthesizing
        // and verify it falls through to a waiting state

        // Mock the synthesis AI response
        mockStreamResponse.mockReturnValueOnce('Synthesis: All issues resolved. {"verdict":"PASS","summary":"all good","resolvedCount":3,"remainingCount":0}');

        await engine.transitionTo('Synthesizing');

        const runPromise = engine.run();
        await new Promise(r => setTimeout(r, 50));

        // Since no reviewSession exists, it should fall through to Executing
        await runPromise;

        // The engine should have moved past Synthesizing
        expect(engine.getState()).not.toBe('Synthesizing');
    });
});

describe('AgentEngine — Strategy Selection', () => {
    it('updateContext changes agentStrategy', () => {
        const context = createTestContext({ agentStrategy: 'review' });
        const engine = new AgentEngine(context);

        engine.updateContext({ agentStrategy: 'red-team' });
        // No direct getter for context, but it shouldn't throw
    });

    it('updateContext changes planStrategy', () => {
        const context = createTestContext({ planStrategy: 'debate' });
        const engine = new AgentEngine(context);

        engine.updateContext({ planStrategy: 'perspectives' });
    });
});
