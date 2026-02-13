import * as vscode from 'vscode';
import { AgentState, AgentContext, PlanStep, StepStatus } from './types.js';
import { Planner } from './planner.js';
import { Executor } from './executor.js';
import { streamChatCompletion, ChatMessage } from '../api/client.js';

export class AgentEngine {
    private state: AgentState = 'Idle';
    private plan: PlanStep[] = [];
    private context: AgentContext;
    private currentStepIndex: number = -1;
    private fixAttempts: Map<string, number> = new Map();
    private planner: Planner = new Planner();
    private executor: Executor = new Executor();

    constructor(context: AgentContext) {
        this.context = context;
    }

    public async transitionTo(nextState: AgentState): Promise<void> {
        console.log(`[AgentEngine] Transitioning from ${this.state} to ${nextState}`);
        this.state = nextState;
        if (this.context.onStateChange) {
            this.context.onStateChange(nextState);
        }
    }

    public getState(): AgentState {
        return this.state;
    }

    public getPlan(): PlanStep[] {
        return this.plan;
    }

    private notifyPlanChange(): void {
        if (this.context.onPlanChange) {
            this.context.onPlanChange([...this.plan]);
        }
    }

    public async setPlanFromResponse(response: string): Promise<void> {
        this.plan = this.planner.parsePlan(response);
        this.notifyPlanChange();
        if (this.plan.length > 0) {
            await this.transitionTo('Planning');
        }
    }

    public async setPlan(steps: string[]): Promise<void> {
        this.plan = steps.map((desc, index) => ({
            id: `step-${index}`,
            description: desc,
            status: 'pending'
        }));
        this.notifyPlanChange();
        await this.transitionTo('Planning');
    }

    /**
     * 중앙 자율 루프
     */
    public async run(): Promise<void> {
        // 이미 종료되었거나 에러 상태면 무시
        if (this.state === 'Done' || this.state === 'Error') {
            return;
        }

        try {
            // 자율 실행 루프
            while (true) {
                const currentState: AgentState = this.state;
                if (currentState === 'Idle' || (currentState as string) === 'Done' || (currentState as string) === 'Error') {
                    break;
                }

                switch (currentState) {
                    case 'Planning':
                        await this.handlePlanning();
                        break;
                    case 'Executing':
                        await this.handleExecution();
                        break;
                    case 'Observing':
                        await this.handleObservation();
                        break;
                    case 'Reflecting':
                        await this.handleReflection();
                        break;
                    case 'Fixing':
                        await this.handleFixing();
                        break;
                    default:
                        await this.transitionTo('Idle');
                        return;
                }
            }
        } catch (error) {
            console.error('[AgentEngine] Critical Error in Loop:', error);
            await this.transitionTo('Error');
        }
    }

    private async handlePlanning(): Promise<void> {
        // 플랜이 이미 있으면 실행으로 전환, 없으면 플랜 생성 요청 (AI 호출)
        if (this.plan.length > 0) {
            this.currentStepIndex = 0;
            await this.transitionTo('Executing');
        } else {
            // TODO: AI 호출하여 플랜 생성
            await this.transitionTo('Idle');
        }
    }

    private async handleExecution(): Promise<void> {
        const step = this.getNextExecutableStep();
        if (!step) {
            // 모든 단계가 완료되었는지 확인
            const allDone = this.plan.every(s => s.status === 'done');
            if (allDone) {
                await this.transitionTo('Done');
            } else {
                // 더 이상 실행할 수 있는 단계가 없는데 완료되지 않음 (교착 상태 또는 실패)
                console.warn('[AgentEngine] No executable steps found, but not all steps are done.');
                await this.transitionTo('Idle');
            }
            return;
        }

        this.currentStepIndex = this.plan.indexOf(step);
        step.status = 'running';
        this.notifyPlanChange();

        try {
            // Executor를 통해 실제 동작 수행 (action 필드가 있으면 우선 사용, 없으면 description에서 유추)
            let action: any = null;

            if (step.action) {
                try {
                    action = JSON.parse(step.action);
                } catch {
                    // JSON 형식이 아니면 기본 write 액션으로 간주 (임시)
                    action = { type: 'write', payload: { path: '', content: step.action } };
                }
            } else {
                // description에서 파일 경로 유추 시도 (임시)
                const pathMatch = step.description.match(/(`|'|")(.+?\.\w+)\1/);
                if (pathMatch) {
                    action = { type: 'read', payload: { path: pathMatch[2] } };
                }
            }

            if (action) {
                const result = await this.executor.execute(action);
                step.result = result;
            } else {
                step.result = 'No specific action identified for this step.';
            }

            step.status = 'done';
            this.notifyPlanChange();
            await this.transitionTo('Observing');
        } catch (error) {
            step.status = 'failed';
            step.result = error instanceof Error ? error.message : 'Unknown error';
            this.notifyPlanChange();
            await this.transitionTo('Fixing');
        }
    }

    private getNextExecutableStep(): PlanStep | undefined {
        return this.plan.find(step => {
            if (step.status !== 'pending') return false;

            // 의존성이 없으면 즉시 실행 가능
            if (!step.dependsOn || step.dependsOn.length === 0) return true;

            // 모든 의존성 단계가 'done' 상태인지 확인
            return step.dependsOn.every(depId => {
                const depStep = this.plan.find(s => s.id === depId);
                return depStep && depStep.status === 'done';
            });
        });
    }

    private async handleObservation(): Promise<void> {
        // [Phase 3에서 고도화] Diagnostics 및 터미널 결과 확인 로직이 들어갈 자리
        // 현재는 단순히 다음 단계 실행을 위해 Executing으로 복귀
        await this.transitionTo('Executing');
    }

    private async handleReflection(): Promise<void> {
        // [Phase 2] 결과에 대해 비판적으로 검토 (필요시 Re-planning)
        await this.transitionTo('Executing');
    }

    private async handleFixing(): Promise<void> {
        const step = this.plan[this.currentStepIndex];
        if (!step) {
            await this.transitionTo('Idle');
            return;
        }

        const attemptCount = this.fixAttempts.get(step.id) || 0;
        if (attemptCount >= this.context.maxFixAttempts) {
            console.error(`[AgentEngine] Max fix attempts reached for step: ${step.id}`);
            await this.transitionTo('Error');
            return;
        }

        this.fixAttempts.set(step.id, attemptCount + 1);
        // TODO: AI에게 수정을 맡기는 로직
        await this.transitionTo('Executing');
    }

    public stop(): void {
        this.transitionTo('Idle');
    }
}
