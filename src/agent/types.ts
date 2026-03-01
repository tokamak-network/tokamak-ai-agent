import * as vscode from 'vscode';
import { ChatMessage } from '../api/client.js';

export type AgentState =
    | 'Idle'
    | 'Planning'
    | 'Executing'
    | 'Observing'
    | 'Reflecting'
    | 'Fixing'
    | 'Reviewing'
    | 'Debating'
    | 'WaitingForReviewDecision'
    | 'WaitingForDebateDecision'
    | 'Synthesizing'
    | 'Done'
    | 'Error';

export type AgentStrategy = 'review' | 'red-team';
export type PlanStrategy = 'debate' | 'perspectives';

export interface ConvergenceMetrics {
    agreementRatio: number;
    avgStability: number;
    overallScore: number;
    recommendation: 'continue' | 'converged' | 'stalled';
}

export interface DiscussionRound {
    round: number;
    role: 'critique' | 'rebuttal' | 'challenge' | 'defense' | 'risk-analysis' | 'innovation-analysis' | 'cross-review';
    content: string;
}

export interface ReviewSessionState {
    strategy: AgentStrategy;
    rounds: DiscussionRound[];
    convergence: ConvergenceMetrics | null;
    synthesisResult: string | null;
}

export interface DebateSessionState {
    strategy: PlanStrategy;
    rounds: DiscussionRound[];
    convergence: ConvergenceMetrics | null;
    synthesisResult: string | null;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface PlanStep {
    id: string;
    description: string;
    status: StepStatus;
    dependsOn?: string[]; // 의존하는 다른 Step ID들
    action?: string; // AI가 생성한 구체적인 액션/코드
    result?: string; // 실행 결과 (성공 메시지 또는 에러 로그)
    errorFingerprint?: string; // 동일 에러 반복 감지용
    terminalErrors?: import('./terminalOutputParser.js').TerminalError[];
}

export interface AgentContext {
    sessionId: string;
    mode: 'ask' | 'plan' | 'agent';
    userInput: string; // 현재 사용자 요청 (Global RAG 및 Planning용)
    history: ChatMessage[];
    workspacePath: string;
    maxFixAttempts: number;
    tokenBudget: number;
    extensionContext?: vscode.ExtensionContext; // 체크포인트 관리용
    abortSignal?: AbortSignal;                  // 사용자 취소 신호 (Stop 버튼)
    onStateChange?: (state: AgentState) => void;
    onPlanChange?: (plan: PlanStep[]) => void;
    onMessage?: (role: string, content: string) => void;
    onCheckpointCreated?: (checkpointId: string) => void;
    /** 실시간 스트리밍 콜백 — agent 각 단계의 AI 응답을 UI에 실시간 표시 */
    onStreamStart?: () => void;
    onStreamChunk?: (chunk: string) => void;
    onStreamEnd?: () => void;
    /** Multi-model review settings */
    enableMultiModelReview?: boolean;
    reviewerModel?: string;
    criticModel?: string;
    maxReviewIterations?: number;
    maxDebateIterations?: number;
    /** Strategy selection */
    agentStrategy?: AgentStrategy;
    planStrategy?: PlanStrategy;
    /** Multi-model review callbacks */
    onReviewComplete?: (feedback: ReviewFeedback, rounds: DiscussionRound[], convergence: ConvergenceMetrics | null) => void;
    onDebateComplete?: (feedback: DebateFeedback, rounds: DiscussionRound[], convergence: ConvergenceMetrics | null) => void;
    onSynthesisComplete?: (synthesis: string) => void;
    /** Promise resolvers for user decision */
    reviewDecisionResolver?: ((decision: 'apply_fix' | 'skip') => void) | null;
    debateDecisionResolver?: ((decision: 'revise' | 'accept') => void) | null;
}

export interface ReviewFeedback {
    verdict: 'PASS' | 'NEEDS_FIX';
    summary: string;
    issues: { severity: 'critical' | 'major' | 'minor'; description: string; suggestion?: string }[];
    pointsOfAgreement?: string[];
    pointsOfDisagreement?: { claim: string; explanation: string; alternative: string }[];
    unexaminedAssumptions?: string[];
    missingConsiderations?: string[];
}

export interface DebateFeedback {
    verdict: 'APPROVE' | 'CHALLENGE';
    concerns: string[];
    suggestions: string[];
    securityRisks?: { description: string; severity: string }[];
    edgeCases?: string[];
    scalabilityConcerns?: string[];
    maintenanceBurden?: string[];
}

export interface AgentAction {
    type: 'write' | 'read' | 'run' | 'search' | 'ask_user' | 'delete' | 'multi_write' | 'mcp_tool' | 'browser';
    payload: any;
}

export interface MultiFileOperation {
    path: string;
    content: string;
    operation: 'create' | 'edit' | 'delete';
}

export interface MultiWritePayload {
    operations: MultiFileOperation[];
    atomic?: boolean; // Atomic 트랜잭션 여부 (기본값: true)
}
