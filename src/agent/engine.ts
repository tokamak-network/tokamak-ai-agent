import * as vscode from 'vscode';
import { AgentState, AgentContext, PlanStep } from './types.js';
import { Planner } from './planner.js';
import { Executor } from './executor.js';
import { Observer, DiagnosticInfo } from './observer.js';
import { Searcher } from './searcher.js';
import { ContextManager } from './contextManager.js';
import { DependencyAnalyzer } from './dependencyAnalyzer.js';
import { CheckpointManager, Checkpoint } from './checkpointManager.js';
import { streamChatCompletion } from '../api/client.js';
import { isCheckpointsEnabled } from '../config/settings.js';

export class AgentEngine {
    private state: AgentState = 'Idle';
    private plan: PlanStep[] = [];
    private context: AgentContext;
    private currentStepIndex: number = -1;
    private fixAttempts: Map<string, number> = new Map();
    private planner: Planner = new Planner();
    private executor: Executor = new Executor();
    private observer: Observer = new Observer();
    private searcher: Searcher = new Searcher();
    private contextManager: ContextManager;
    private dependencyAnalyzer: DependencyAnalyzer = new DependencyAnalyzer();
    private checkpointManager: CheckpointManager | null = null;
    private lastDiagnostics: DiagnosticInfo[] = [];

    constructor(context: AgentContext) {
        this.context = context;
        this.contextManager = new ContextManager(this.executor);

        // ExtensionContext가 있고 checkpoint 기능이 활성화되어 있으면 CheckpointManager 초기화
        if (context.extensionContext && isCheckpointsEnabled()) {
            this.checkpointManager = new CheckpointManager(context.extensionContext);
            // 체크포인트 로드
            this.checkpointManager.loadCheckpoints().catch(err => {
                console.warn('[AgentEngine] Failed to load checkpoints:', err);
            });
        } else if (!isCheckpointsEnabled()) {
            console.log('[AgentEngine] Checkpoints disabled in settings');
        }
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
            await this.transitionTo('Executing');
        }
    }

    /**
     * 중앙 자율 루프
     */
    public async run(): Promise<void> {
        if (this.state === 'Done' || this.state === 'Error') {
            return;
        }

        try {
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
        console.log('[AgentEngine] Planning phase started...');

        try {
            // [Phase 4] Global RAG: 관련 파일 검색 및 컨텍스트 구성
            const relevantFiles = await this.searcher.searchRelevantFiles(this.context.userInput);
            const globalContext = await this.contextManager.assembleContext(relevantFiles);

            const prompt = `
사용자 요청: ${this.context.userInput}

현재 프로젝트 컨텍스트:
${globalContext}

위 요청을 수행하기 위한 단계별 계획을 세워주세요.
각 단계는 마크다운 체크리스트 형식(- [ ] 설명)으로 작성하세요.

**중요 지침:**
1. **계획만 수립**: 이 단계에서는 어떤 파일을 수정할지 '목록'과 '설명'만 작성하세요.
2. **코드 작성 금지**: 각 단계의 구체적인 코드는 나중에 실행 시점에 따로 요청할 것이므로, 지금은 코드를 포함하지 마세요. (토큰 절약 및 잘림 방지)
3. **의존성**: 순서가 중요하다면 [depends: step-id]를 포함하세요.
4. **멀티 파일 작업**: 여러 관련 파일(예: 컴포넌트 + 테스트 + 타입)을 함께 생성/수정해야 하는 경우, 하나의 단계로 묶어서 "여러 파일 생성" 또는 "관련 파일 수정"으로 표현하세요.
   예: "- [ ] UserProfile 컴포넌트 및 관련 파일 생성 (UserProfile.tsx, UserProfile.test.tsx, UserProfile.styles.ts)"
5. **터미널 명령 실행**: 의존성 설치, 테스트 실행, 빌드 등 터미널 명령이 필요한 경우 명시하세요.
   예: "- [ ] npm install 실행하여 의존성 설치"
   예: "- [ ] npm test 실행하여 테스트 통과 확인"
   예: "- [ ] npm run build 실행하여 빌드 성공 확인"
`;

            let aiResponse = '';
            const streamResult = streamChatCompletion([{ role: 'user', content: prompt }]);
            for await (const chunk of streamResult.content) {
                aiResponse += chunk;
            }

            this.plan = this.planner.parsePlan(aiResponse);
            if (this.plan.length > 0) {
                this.notifyPlanChange();
                await this.transitionTo('Executing');
            } else {
                console.warn('[AgentEngine] No plan extracted.');
                await this.transitionTo('Done');
            }
        } catch (error) {
            console.error('[AgentEngine] Planning failed:', error);
            await this.transitionTo('Error');
        }
    }

    private async handleExecution(): Promise<void> {
        const step = this.getNextExecutableStep();
        if (!step) {
            const allDone = this.plan.every(s => s.status === 'done');
            if (allDone) {
                await this.transitionTo('Done');
            } else {
                console.warn('[AgentEngine] No executable steps found.');
                await this.transitionTo('Idle');
            }
            return;
        }

        this.currentStepIndex = this.plan.indexOf(step);
        step.status = 'running';
        this.notifyPlanChange();

        // 체크포인트 생성 (단계 실행 전)
        let checkpointId: string | undefined;
        if (this.checkpointManager) {
            try {
                console.log(`[AgentEngine] Creating checkpoint before step: ${step.id} - ${step.description}`);
                checkpointId = await this.checkpointManager.createCheckpoint(
                    step.description,
                    step.id,
                    JSON.parse(JSON.stringify(this.plan)), // 깊은 복사
                    {
                        state: this.state,
                        currentStepIndex: this.currentStepIndex,
                    }
                );
                console.log(`[AgentEngine] Checkpoint created: ${checkpointId}`);
                if (this.context.onCheckpointCreated) {
                    this.context.onCheckpointCreated(checkpointId);
                }
            } catch (error) {
                console.error('[AgentEngine] Failed to create checkpoint:', error);
            }
        } else {
            console.warn('[AgentEngine] CheckpointManager not available - extensionContext may not be set');
        }

        try {
            let action: any = null;

            // [Strategy] 지연 액션 생성 (Lazy Action Generation)
            // 계획 수립 시점에 액션이 없었다면, 실행 직전에 AI에게 구체적인 액션을 요청함
            if (!step.action) {
                console.log(`[AgentEngine] Generating action for step: ${step.id}`);
                const relevantFiles = await this.searcher.searchRelevantFiles(step.description);
                const stepContext = await this.contextManager.assembleContext(relevantFiles);

                const prompt = `
현재 단계: ${step.description}

프로젝트 상황:
${stepContext}

위 단계를 실행하기 위한 **JSON Action**을 생성해주세요.

**단일 파일 작업**:
{ "type": "write", "payload": { "path": "...", "content": "전체_내용_또는_SEARCH_REPLACE_블록" } }

**여러 파일 동시 작업** (권장):
여러 파일을 함께 생성/수정해야 하는 경우, multi_write를 사용하세요:
{
  "type": "multi_write",
  "payload": {
    "atomic": true,
    "operations": [
      { "operation": "create", "path": "file1.ts", "content": "새_파일_전체_코드..." },
      { "operation": "edit", "path": "file2.ts", "content": "<<<<<<< SEARCH\\n수정할_기존_코드\\n=======\\n새롭게_바뀔_코드\\n>>>>>>> REPLACE" }
    ]
  }
}

**터미널 명령 실행**:
의존성 설치, 테스트 실행, 빌드, 컴파일 등 터미널 명령이 필요한 경우 run을 사용하세요:
{ "type": "run", "payload": { "command": "npm install" } }
{ "type": "run", "payload": { "command": "npm test" } }
{ "type": "run", "payload": { "command": "npm run build" } }
{ "type": "run", "payload": { "command": "tsc --noEmit" } }

**중요 지침**:
1. 여러 관련 파일(컴포넌트, 테스트, 타입 등)을 함께 생성해야 할 때는 multi_write를 사용하세요.
2. 파일 간 의존성이 있는 경우(import/export) 모든 파일을 한 번에 처리하세요.
3. **[치명적 주의] 기존 파일을 수정할 때는 절대 바꿀 부분만 덩그러니 작성하거나 전체를 덮어쓰지 말고, 반드시 SEARCH/REPLACE 블록을 사용하세요!**
   - 이 블록 없이 새로운 코드 스니펫만 작성하면, 기존 코드가 몽땅 삭제되고 해당 스니펫만 파일에 남게 됩니다!
   - 작성 예시 (\\n 등 이스케이프에 주의하세요):
   <<<<<<< SEARCH
   (원본 파일에 있는 정확히 일치하는 기존 코드)
   =======
   (수정되어 적용될 새로운 코드)
   >>>>>>> REPLACE
4. operation은 "create", "edit", "delete" 중 하나입니다.
5. atomic: true로 설정하면 모든 작업이 성공해야 적용되고, 하나라도 실패하면 전체 롤백됩니다.
6. **터미널 명령 실행**: 파일 작업 외에 의존성 설치, 테스트, 빌드 등이 필요한 경우 run 액션을 사용하세요.
   - npm/yarn/pip 등 패키지 매니저 명령
   - 테스트 실행 (npm test, pytest 등)
   - 빌드/컴파일 (npm run build, tsc 등)
   - 린트/포맷팅 (npm run lint, prettier 등)

답변에는 마크다운 없이 오직 JSON만 포함하거나, \`\`\`json 블록으로 감싸주세요.
`;
                let aiResponse = '';
                const streamResult = streamChatCompletion([{ role: 'user', content: prompt }]);
                for await (const chunk of streamResult.content) {
                    aiResponse += chunk;
                }
                // JSON 부분만 추출
                const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                step.action = jsonMatch ? jsonMatch[0] : aiResponse;
            }

            if (step.action) {
                try {
                    // JSON 내부에 중첩된 마크다운 백틱 처리 등 정제
                    const cleanAction = step.action.replace(/^```json\s*|^```\s*|```$/g, '').trim();
                    action = JSON.parse(cleanAction);
                } catch (e) {
                    console.warn('[AgentEngine] Failed to parse action JSON, falling back to raw write.', e);
                    // 폴백: JSON 파싱 실패 시 내용을 그대로 파일 쓰기로 간주 (위험할 수 있음)
                    const pathMatch = step.description.match(/(`|'|")(.+?\.\w+)\1/);
                    if (pathMatch) {
                        action = { type: 'write', payload: { path: pathMatch[2], content: step.action } };
                    }
                }
            }

            if (action) {
                // 터미널 명령 실행 전 메시지 표시
                if (action.type === 'run' && this.context.onMessage) {
                    this.context.onMessage('assistant', `🔧 Executing: \`${action.payload.command}\``);
                }

                const result = await this.executor.execute(action);
                step.result = result;

                // 실행 결과를 메시지로 표시
                if (this.context.onMessage) {
                    const resultPreview = result.length > 500
                        ? result.substring(0, 500) + '\n... (truncated)'
                        : result;

                    if (action.type === 'run') {
                        // 터미널 명령 결과를 코드 블록으로 표시
                        this.context.onMessage('assistant', `\`\`\`\n${resultPreview}\n\`\`\``);
                    } else {
                        // 파일 작업 결과는 간단히 표시
                        this.context.onMessage('assistant', `✅ ${result}`);
                    }
                }
            } else {
                step.result = 'No executable action found for this step.';
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
            if (!step.dependsOn || step.dependsOn.length === 0) return true;
            return step.dependsOn.every(depId => {
                const depStep = this.plan.find(s => s.id === depId);
                return depStep && depStep.status === 'done';
            });
        });
    }

    private async handleObservation(): Promise<void> {
        this.lastDiagnostics = await this.observer.getDiagnostics();
        const errors = this.lastDiagnostics.filter(d => d.severity === 'Error');

        if (errors.length > 0) {
            const step = this.plan[this.currentStepIndex];
            if (step) {
                step.status = 'failed';
                step.result = this.observer.formatDiagnostics(errors);
                this.notifyPlanChange();
            }
            await this.transitionTo('Fixing');
        } else {
            // 에러가 없으면 Reflecting 단계로 이동하여 AI가 결과 평가
            await this.transitionTo('Reflecting');
        }
    }

    private async handleReflection(): Promise<void> {
        const step = this.plan[this.currentStepIndex];
        if (!step || !step.result) {
            await this.transitionTo('Executing');
            return;
        }

        // AI에게 실행 결과 평가 요청
        const prompt = `
다음 단계를 실행했습니다:
**단계**: ${step.description}
**실행 결과**: ${step.result}

이 결과가 의도한 대로 잘 수행되었는지 평가해주세요.
다음 중 하나로 답변해주세요:
- "SUCCESS": 의도대로 잘 수행됨, 다음 단계로 진행 가능
- "RETRY": 결과가 불완전하거나 에러가 있음, 재시도 필요
- "REPLAN": 계획을 수정해야 함

답변은 위 키워드 하나만 포함하고, 간단한 이유를 한 줄로 추가해주세요.
예: SUCCESS - 파일이 정상적으로 생성되었습니다.
`;

        try {
            let aiResponse = '';
            const streamResult = streamChatCompletion([{ role: 'user', content: prompt }]);
            for await (const chunk of streamResult.content) {
                aiResponse += chunk;
            }

            const evaluation = aiResponse.trim().toUpperCase();

            if (evaluation.includes('SUCCESS')) {
                console.log('[AgentEngine] Reflection: SUCCESS - proceeding to next step');
                await this.transitionTo('Executing');
            } else if (evaluation.includes('RETRY')) {
                console.log('[AgentEngine] Reflection: RETRY - attempting to fix');
                step.status = 'failed';
                this.notifyPlanChange();
                await this.transitionTo('Fixing');
            } else if (evaluation.includes('REPLAN')) {
                console.log('[AgentEngine] Reflection: REPLAN - replanning required');
                const replanContext = `Previous step result: ${step.result}\nAI Evaluation: ${aiResponse}`;
                this.plan = await this.planner.replan(this.plan, replanContext, streamChatCompletion);
                this.notifyPlanChange();
                await this.transitionTo('Executing');
            } else {
                // 불명확한 응답은 일단 진행
                console.warn('[AgentEngine] Reflection: Unclear response, proceeding anyway');
                await this.transitionTo('Executing');
            }
        } catch (error) {
            console.error('[AgentEngine] Reflection failed:', error);
            await this.transitionTo('Executing');
        }
    }

    private async handleFixing(): Promise<void> {
        const step = this.plan[this.currentStepIndex];
        if (!step) {
            await this.transitionTo('Idle');
            return;
        }

        const attemptCount = this.fixAttempts.get(step.id) || 0;
        if (attemptCount >= this.context.maxFixAttempts) {
            await this.transitionTo('Error');
            return;
        }

        this.fixAttempts.set(step.id, attemptCount + 1);
        const errorContext = this.observer.formatDiagnostics(this.lastDiagnostics);
        const prompt = `
작업 중 다음과 같은 에러가 발생했습니다:
${errorContext}

이 에러를 수정하기 위한 JSON Action을 생성해주세요. 
파일이 길 경우 반드시 **Search/Replace** 형식을 사용하여 필요한 부분만 수정하세요.
형식: { "type": "write", "payload": { "path": "...", "content": "<<<<<<< SEARCH\\n...\\n=======\\n...\\n>>>>>>> REPLACE" } }
**중요**: 
- SEARCH와 REPLACE 내용이 동일하면 SEARCH/REPLACE 블록을 생성하지 마세요. 변경이 없으면 해당 작업을 생략하세요.
- 기존 코드를 삭제하지 마세요. REPLACE가 빈 문자열이거나 SEARCH보다 훨씬 짧으면 거부됩니다. 사용자가 명시적으로 삭제를 요청한 경우에만 삭제하세요.
`;

        try {
            let aiResponse = '';
            const streamResult = streamChatCompletion([{ role: 'user', content: prompt }]);
            for await (const chunk of streamResult.content) {
                aiResponse += chunk;
            }

            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const action = JSON.parse(jsonMatch[0]);
                const result = await this.executor.execute(action);
                step.result = `[Auto-Fix] ${result}`;
            }

            await this.transitionTo('Observing');
        } catch (error) {
            await this.transitionTo('Error');
        }
    }

    public updateContext(partialContext: Partial<AgentContext>): void {
        this.context = { ...this.context, ...partialContext };
    }

    public stop(): void {
        this.state = 'Idle';
    }

    /**
     * CheckpointManager에 접근하기 위한 public 메서드
     */
    public getCheckpointManager(): CheckpointManager | null {
        return this.checkpointManager;
    }
}
