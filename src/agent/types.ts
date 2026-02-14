import { ChatMessage } from '../api/client.js';

export type AgentState =
    | 'Idle'
    | 'Planning'
    | 'Executing'
    | 'Observing'
    | 'Reflecting'
    | 'Fixing'
    | 'Done'
    | 'Error';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface PlanStep {
    id: string;
    description: string;
    status: StepStatus;
    dependsOn?: string[]; // 의존하는 다른 Step ID들
    action?: string; // AI가 생성한 구체적인 액션/코드
    result?: string; // 실행 결과 (성공 메시지 또는 에러 로그)
    errorFingerprint?: string; // 동일 에러 반복 감지용
}

export interface AgentContext {
    sessionId: string;
    mode: 'ask' | 'plan' | 'agent';
    userInput: string; // 현재 사용자 요청 (Global RAG 및 Planning용)
    history: ChatMessage[];
    workspacePath: string;
    maxFixAttempts: number;
    tokenBudget: number;
    onStateChange?: (state: AgentState) => void;
    onPlanChange?: (plan: PlanStep[]) => void;
    onMessage?: (role: string, content: string) => void;
}

export interface AgentAction {
    type: 'write' | 'read' | 'run' | 'search' | 'ask_user' | 'delete';
    payload: any;
}
