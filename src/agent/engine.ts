import * as vscode from 'vscode';
import { AgentState, AgentContext, PlanStep, ReviewFeedback, DebateFeedback, ReviewSessionState, DebateSessionState, DiscussionRound } from './types.js';
import { computeConvergence } from './convergence.js';
import { Planner } from './planner.js';
import { Executor } from './executor.js';
import { Observer, DiagnosticInfo } from './observer.js';
import { Searcher } from './searcher.js';
import { ContextManager } from './contextManager.js';
import { DependencyAnalyzer } from './dependencyAnalyzer.js';
import { CheckpointManager, Checkpoint } from './checkpointManager.js';
import { streamChatCompletion, ChatMessage } from '../api/client.js';
import { isCheckpointsEnabled, getSettings as getConfigSettings } from '../config/settings.js';
import {
    getReviewerSystemPrompt, getCriticSystemPrompt,
    getReviewCritiquePrompt, getReviewRebuttalPrompt,
    getDebateChallengePrompt, getDebateDefensePrompt,
    getReviewSynthesisPrompt, getDebateSynthesisPrompt,
} from '../chat/systemPromptBuilder.js';
import { logger } from '../utils/logger.js';
import { stripThinkingBlocks } from '../utils/contentUtils.js';

/**
 * AI 응답 텍스트에서 가장 바깥쪽 JSON 객체를 올바르게 추출합니다.
 * 중첩된 {} 와 문자열 내부의 {} 를 모두 정확히 처리합니다.
 * naive regex(/\{[\s\S]*\}/) 대신 사용하세요.
 */
function extractJsonFromText(text: string): string | null {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\' && inString) {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

export class AgentEngine {
    private state: AgentState = 'Idle';
    private plan: PlanStep[] = [];
    private context: AgentContext;
    private currentStepIndex: number = -1;
    private fixAttempts: Map<string, number> = new Map();
    /** Cline의 consecutiveMistakeCount 패턴: 연속 실패 횟수 추적. 성공 시 0으로 리셋. */
    private consecutiveMistakeCount: number = 0;
    private reviewIterations: number = 0;
    private debateIterations: number = 0;
    private reviewSession: ReviewSessionState | null = null;
    private debateSession: DebateSessionState | null = null;
    /** 리뷰 완료된 step ID — 동일 step 재리뷰 방지 (무한루프 차단) */
    private reviewedStepIds: Set<string> = new Set();
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
                logger.warn('[AgentEngine]', 'Failed to load checkpoints', err);
            });
        } else if (!isCheckpointsEnabled()) {
            logger.info('[AgentEngine]', 'Checkpoints disabled in settings');
        }
    }

    public async transitionTo(nextState: AgentState): Promise<void> {
        logger.info('[AgentEngine]', `Transitioning from ${this.state} to ${nextState}`);
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
                    case 'Reviewing':
                        await this.handleReview();
                        break;
                    case 'Debating':
                        await this.handleDebate();
                        break;
                    case 'WaitingForReviewDecision':
                        await this.handleWaitingForReviewDecision();
                        break;
                    case 'WaitingForDebateDecision':
                        await this.handleWaitingForDebateDecision();
                        break;
                    case 'Synthesizing':
                        await this.handleSynthesis();
                        break;
                    default:
                        await this.transitionTo('Idle');
                        return;
                }
            }
        } catch (error) {
            logger.error('[AgentEngine]', 'Critical Error in Loop', error);
            await this.transitionTo('Error');
        }
    }

    private async handlePlanning(): Promise<void> {
        logger.info('[AgentEngine]', 'Planning phase started...');

        try {
            // [Phase 4] Global RAG: 관련 파일 검색 및 컨텍스트 구성
            const relevantFiles = await this.searcher.searchRelevantFiles(this.context.userInput);
            const globalContext = await this.contextManager.assembleContext(relevantFiles, this.context.tokenBudget);

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

            let aiResponse = await this.streamWithUI([{ role: 'user', content: prompt }]);

            this.plan = this.planner.parsePlan(aiResponse);

            // plan이 비어있으면 (모델이 [TOOL_CALL]이나 설명만 출력한 경우) 즉시 재시도
            if (this.plan.length === 0 && aiResponse.trim().length > 0) {
                logger.warn('[AgentEngine]', 'No plan steps extracted — retrying with explicit format instruction');
                const retryPrompt = `이전 응답에서 실행 가능한 계획을 추출하지 못했습니다. [TOOL_CALL] 블록이나 도구 호출 없이, 반드시 마크다운 체크리스트 형식으로만 답변해주세요.

사용자 요청: ${this.context.userInput}

출력 형식 (이것만 출력, 다른 내용 없음):
- [ ] 첫 번째 단계 설명
- [ ] 두 번째 단계 설명
- [ ] 세 번째 단계 설명`;
                aiResponse = await this.streamWithUI([{ role: 'user', content: retryPrompt }]);
                this.plan = this.planner.parsePlan(aiResponse);
            }

            if (this.plan.length > 0) {
                this.notifyPlanChange();
                // Multi-model debate: route to Debating if enabled
                if (this.context.enableMultiModelReview && this.context.criticModel) {
                    await this.transitionTo('Debating');
                } else {
                    await this.transitionTo('Executing');
                }
            } else {
                logger.warn('[AgentEngine]', 'No plan extracted after retry.');
                await this.transitionTo('Done');
            }
        } catch (error) {
            logger.error('[AgentEngine]', 'Planning failed', error);
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
                logger.warn('[AgentEngine]', 'No executable steps found.');
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
                logger.info('[AgentEngine]', `Creating checkpoint before step: ${step.id} - ${step.description}`);
                checkpointId = await this.checkpointManager.createCheckpoint(
                    step.description,
                    step.id,
                    JSON.parse(JSON.stringify(this.plan)), // 깊은 복사
                    {
                        state: this.state,
                        currentStepIndex: this.currentStepIndex,
                    }
                );
                logger.info('[AgentEngine]', `Checkpoint created: ${checkpointId}`);
                if (this.context.onCheckpointCreated) {
                    this.context.onCheckpointCreated(checkpointId);
                }
            } catch (error) {
                logger.error('[AgentEngine]', 'Failed to create checkpoint', error);
            }
        } else {
            logger.warn('[AgentEngine]', 'CheckpointManager not available - extensionContext may not be set');
        }

        try {
            let action: any = null;

            // [Strategy] 지연 액션 생성 (Lazy Action Generation)
            // 계획 수립 시점에 액션이 없었다면, 실행 직전에 AI에게 구체적인 액션을 요청함
            if (!step.action) {
                logger.info('[AgentEngine]', `Generating action for step: ${step.id}`);
                const relevantFiles = await this.searcher.searchRelevantFiles(step.description);
                const stepContext = await this.contextManager.assembleContext(relevantFiles, this.context.tokenBudget);

                // 단계 설명에서 파일 경로를 추출하여 현재 내용을 직접 포함
                // → AI가 SEARCH 블록 작성 시 정확한 파일 내용을 참조할 수 있게 함
                let directFileContext = '';
                const fileInDesc = step.description.match(/[`'"]([\w./\\-]+\.\w+)[`'"]/)?.[1];
                if (fileInDesc) {
                    try {
                        const fileContent = await this.executor.readFile(fileInDesc);
                        const filePreview = fileContent.length > 3000
                            ? fileContent.substring(0, 3000) + '\n... (truncated)'
                            : fileContent;
                        directFileContext = `\n**수정 대상 파일의 현재 전체 내용 (\`${fileInDesc}\`) — SEARCH 블록 작성 시 이 내용에서 정확히 복사하세요:**\n\`\`\`\n${filePreview}\n\`\`\`\n`;
                    } catch { /* 파일 미존재 → 새 파일 생성 케이스 */ }
                }

                const prompt = `
현재 단계: ${step.description}

프로젝트 상황:
${stepContext}
${directFileContext}
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
                const aiResponse = await this.streamWithUI([{ role: 'user', content: prompt }]);
                // JSON 부분만 추출 (중첩 JSON을 올바르게 처리)
                step.action = extractJsonFromText(aiResponse) ?? undefined;
            }

            if (step.action) {
                try {
                    // JSON 내부에 중첩된 마크다운 백틱 처리 등 정제
                    const cleanAction = step.action.replace(/^```json\s*|^```\s*|```$/g, '').trim();
                    action = JSON.parse(cleanAction);
                } catch (e) {
                    logger.warn('[AgentEngine]', 'Failed to parse action JSON, falling back to raw write.', e);
                    // 폴백: JSON 파싱 실패 시 내용을 그대로 파일 쓰기로 간주 (위험할 수 있음)
                    const pathMatch = step.description.match(/(`|'|")(.+?\.\w+)\1/);
                    if (pathMatch) {
                        action = { type: 'write', payload: { path: pathMatch[2], content: step.action } };
                    }
                }
            }

            if (action) {
                // Pre-flight: SEARCH/REPLACE 블록이 대상 파일에 실제로 존재하는지 사전 검사
                // 불일치 시 현재 파일 내용을 제공하여 AI에게 즉시 수정 요청
                action = await this.preflightCheckAction(action, step);

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
                // 액션이 생성되지 않음 → 실패로 처리, Fixing에서 재시도
                // (silent skip 방지 — AI가 JSON 없이 설명만 출력하는 경우 대응)
                throw new Error(
                    'No executable action generated. The AI response did not contain a valid JSON action.\n' +
                    'Please output ONLY a JSON action like: { "type": "write", "payload": { "path": "...", "content": "..." } }'
                );
            }

            step.status = 'done';
            this.consecutiveMistakeCount = 0; // 성공 시 연속 실패 카운터 리셋
            this.notifyPlanChange();
            await this.transitionTo('Observing');
        } catch (error) {
            this.consecutiveMistakeCount++;
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
                // 존재하지 않는 의존성 ID는 충족된 것으로 처리
                // (AI가 잘못된 ID를 참조하거나 오타냈을 때 플랜 전체가 멈추는 문제 방지)
                if (!depStep) return true;
                return depStep.status === 'done';
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
            // 에러 없음 — 실행 결과가 명백한 성공이면 Reflection AI 호출을 건너뜀
            // (매 단계마다 Reflection을 호출하면 API 비용/지연이 2배가 됨)
            const currentStep = this.plan[this.currentStepIndex];
            const resultText = currentStep?.result ?? '';
            const isCleanSuccess = /successfully|success|created|updated|wrote/i.test(resultText);
            if (isCleanSuccess) {
                logger.info('[AgentEngine]', 'Clean execution, no errors — skipping Reflection');
                // Multi-model review: route to Reviewing if enabled (이미 리뷰한 step은 제외)
                const alreadyReviewed = currentStep && this.reviewedStepIds.has(currentStep.id);
                if (this.context.enableMultiModelReview && this.context.reviewerModel && !alreadyReviewed) {
                    await this.transitionTo('Reviewing');
                } else {
                    await this.transitionTo('Executing');
                }
            } else {
                await this.transitionTo('Reflecting');
            }
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
            const aiResponse = await this.streamWithUI([{ role: 'user', content: prompt }]);
            const evaluation = aiResponse.trim().toUpperCase();

            if (evaluation.includes('SUCCESS')) {
                logger.info('[AgentEngine]', 'Reflection: SUCCESS - proceeding to next step');
                await this.transitionTo('Executing');
            } else if (evaluation.includes('RETRY')) {
                logger.info('[AgentEngine]', 'Reflection: RETRY - attempting to fix');
                step.status = 'failed';
                this.notifyPlanChange();
                await this.transitionTo('Fixing');
            } else if (evaluation.includes('REPLAN')) {
                logger.info('[AgentEngine]', 'Reflection: REPLAN - replanning required');
                const replanContext = `Previous step result: ${step.result}\nAI Evaluation: ${aiResponse}`;
                this.plan = await this.planner.replan(this.plan, replanContext, streamChatCompletion);
                this.notifyPlanChange();
                await this.transitionTo('Executing');
            } else {
                // 불명확한 응답은 일단 진행
                logger.warn('[AgentEngine]', 'Reflection: Unclear response, proceeding anyway');
                await this.transitionTo('Executing');
            }
        } catch (error) {
            logger.error('[AgentEngine]', 'Reflection failed', error);
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
        this.consecutiveMistakeCount++;

        const errorContext = this.observer.formatDiagnostics(this.lastDiagnostics);
        const stepResult = step.result || '(No result recorded)';

        // SEARCH/REPLACE 불일치 실패 감지 → 대상 파일의 현재 내용을 명시적으로 포함
        let searchReplaceHint = '';
        const isSearchReplaceFail = /SEARCH block does not match|Search\/Replace failed|No valid SEARCH\/REPLACE/.test(stepResult);
        if (isSearchReplaceFail) {
            const filePathMatch = stepResult.match(/(?:failed in|in )\s*([\w./\\-]+\.\w+)/);
            if (filePathMatch) {
                try {
                    const currentContent = await this.executor.readFile(filePathMatch[1]);
                    const preview = currentContent.length > 3000
                        ? currentContent.substring(0, 3000) + '\n... (truncated)'
                        : currentContent;
                    searchReplaceHint = `\n\n⚠️ **SEARCH/REPLACE 불일치**: SEARCH 블록이 파일에 존재하지 않습니다.\n`
                        + `현재 **${filePathMatch[1]}** 파일의 정확한 내용 (SEARCH 블록은 이 텍스트에서 그대로 복사해야 합니다):\n\`\`\`\n${preview}\n\`\`\`\n`;
                } catch { /* 무시 */ }
            }
        }

        // 연속 실패 횟수에 따라 가이드 강도 조절 (Cline의 progressiveErrorMessage 패턴)
        const mistakeWarning = this.consecutiveMistakeCount >= 3
            ? `\n⚠️  ${this.consecutiveMistakeCount}번 연속 실패 중입니다. 지금까지와 다른 방법을 시도하세요. ` +
              `이전에 시도한 방법과 동일한 코드를 제안하지 마세요.\n`
            : this.consecutiveMistakeCount >= 2
            ? `\n주의: ${this.consecutiveMistakeCount}번 연속으로 실패했습니다. 접근 방식을 다시 검토하세요.\n`
            : '';

        // 에러가 발생한 파일들의 현재 내용을 컨텍스트에 포함
        const errorFiles = this.lastDiagnostics
            .map(d => d.file)
            .filter((f, i, arr) => arr.indexOf(f) === i); // 중복 제거
        let fileContext = '';
        for (const filePath of errorFiles.slice(0, 3)) { // 최대 3개 파일
            try {
                const content = await this.executor.readFile(filePath);
                const preview = content.length > 2000 ? content.substring(0, 2000) + '\n... (truncated)' : content;
                fileContext += `\n--- 현재 ${filePath} 내용 ---\n${preview}\n`;
            } catch { /* 파일 읽기 실패는 무시 */ }
        }

        const prompt = `
작업 중 에러가 발생했습니다. (시도 횟수: ${attemptCount + 1}/${this.context.maxFixAttempts})
${mistakeWarning}
**실패한 단계**: ${step.description}
**실행 결과**: ${stepResult.substring(0, 500)}

**발생한 에러**:
${errorContext}
${fileContext}${searchReplaceHint}
이 에러를 수정하기 위한 JSON Action을 생성해주세요.
기존 파일 수정 시 반드시 SEARCH/REPLACE 형식을 사용하세요 (파일 전체를 덮어쓰지 마세요):
{ "type": "write", "payload": { "path": "...", "content": "<<<<<<< SEARCH\\n(원본 코드 일부)\\n=======\\n(수정된 코드)\\n>>>>>>> REPLACE" } }

**중요 규칙**:
- SEARCH 내용은 파일에 실제로 존재하는 코드여야 합니다
- REPLACE가 빈 문자열이거나 SEARCH보다 70% 이상 짧으면 거부됩니다
- 여러 파일 수정이 필요하면 multi_write를 사용하세요
`;

        try {
            const aiResponse = await this.streamWithUI([{ role: 'user', content: prompt }]);
            const jsonStr = extractJsonFromText(aiResponse);
            if (jsonStr) {
                const action = JSON.parse(jsonStr);
                const result = await this.executor.execute(action);
                step.result = `[Auto-Fix attempt ${attemptCount + 1}] ${result}`;
            } else {
                logger.warn('[AgentEngine]', 'Fix response contained no valid JSON action');
            }

            await this.transitionTo('Observing');
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Unknown error';
            logger.error('[AgentEngine]', `Fix attempt ${attemptCount + 1} failed: ${errMsg}`);
            step.result = `[Fix failed] ${errMsg}`;
            // 마지막 시도에서도 실패하면 에러 상태로 전환, 아니면 다시 Observing
            if (attemptCount + 1 >= this.context.maxFixAttempts) {
                await this.transitionTo('Error');
            } else {
                await this.transitionTo('Observing');
            }
        }
    }

    /**
     * Multi-model review: Multi-round critique/rebuttal with convergence detection.
     * Odd rounds: Reviewer CRITIQUE, Even rounds: Coder REBUTTAL.
     * On convergence/maxIter → Synthesizing → WaitingForReviewDecision.
     */
    private async handleReview(): Promise<void> {
        const maxIter = this.context.maxReviewIterations ?? 3;
        const strategy = this.context.agentStrategy ?? 'review';

        // Initialize session if needed
        if (!this.reviewSession) {
            this.reviewSession = {
                strategy,
                rounds: [],
                convergence: null,
                synthesisResult: null,
            };
        }

        this.reviewIterations++;

        if (this.reviewIterations > maxIter) {
            logger.info('[AgentEngine]', `Review iterations exceeded max (${maxIter}), moving to synthesis`);
            if (this.reviewSession && !this.reviewSession.convergence) {
                const convergence = computeConvergence(this.reviewSession.rounds);
                convergence.recommendation = 'stalled';
                this.reviewSession.convergence = convergence;
            }
            await this.transitionTo('Synthesizing');
            return;
        }

        const step = this.plan[this.currentStepIndex];
        if (!step) {
            this.reviewIterations = 0;
            this.reviewSession = null;
            await this.transitionTo('Executing');
            return;
        }

        const roundNumber = this.reviewIterations;
        const isOddRound = roundNumber % 2 === 1;

        if (this.context.onMessage) {
            const roleLabel = isOddRound ? 'Critique' : 'Rebuttal';
            this.context.onMessage('assistant', `🔍 **Review ${roleLabel}** (round ${roundNumber}/${maxIter})...`);
        }

        try {
            const codeContext = `**Step**: ${step.description}\n**Action**: ${step.action ?? '(no action recorded)'}\n**Result**: ${step.result ?? '(no result)'}`;

            // Build conversation from previous rounds
            const previousRoundsText = this.reviewSession.rounds
                .map(r => `[Round ${r.round} - ${r.role}]:\n${r.content}`)
                .join('\n\n');

            if (isOddRound) {
                // Reviewer CRITIQUE
                const critiquePrompt = `Review the following code change:\n\n${codeContext}${previousRoundsText ? `\n\nPrevious discussion:\n${previousRoundsText}` : ''}\n\nProvide your structured critique.`;

                const response = await this.streamWithUI(
                    [{ role: 'user', content: critiquePrompt }],
                    this.context.reviewerModel,
                    getReviewCritiquePrompt(strategy)
                );

                this.reviewSession.rounds.push({
                    round: roundNumber,
                    role: 'critique',
                    content: response,
                });
            } else {
                // Coder REBUTTAL (uses default model)
                const rebuttalPrompt = `The reviewer has provided critique of your code change:\n\n${codeContext}\n\nPrevious discussion:\n${previousRoundsText}\n\nProvide your structured rebuttal.`;

                const response = await this.streamWithUI(
                    [{ role: 'user', content: rebuttalPrompt }],
                    undefined,
                    getReviewRebuttalPrompt(strategy)
                );

                this.reviewSession.rounds.push({
                    round: roundNumber,
                    role: 'rebuttal',
                    content: response,
                });
            }

            // Compute convergence
            const convergence = computeConvergence(this.reviewSession.rounds);
            this.reviewSession.convergence = convergence;

            logger.info('[AgentEngine]', `Review convergence: score=${convergence.overallScore.toFixed(2)}, recommendation=${convergence.recommendation}`);

            if (this.context.onMessage) {
                this.context.onMessage('assistant', `📊 Convergence: ${convergence.overallScore.toFixed(2)} (${convergence.recommendation})`);
            }

            if (convergence.recommendation === 'converged' || convergence.recommendation === 'stalled') {
                await this.transitionTo('Synthesizing');
            } else {
                // Continue to next round
                await this.transitionTo('Reviewing');
            }
        } catch (error) {
            logger.error('[AgentEngine]', 'Review failed', error);
            this.reviewIterations = 0;
            this.reviewSession = null;
            await this.transitionTo('Executing');
        }
    }

    /**
     * Multi-model debate: Multi-round challenge/defense with convergence detection.
     * 'debate' strategy: Odd rounds = Critic CHALLENGE, Even rounds = Planner DEFENSE.
     * 'perspectives' strategy: Round 1 = Risk lens, Round 2 = Innovation lens, Round 3 = Cross-review.
     * On convergence/maxIter → Synthesizing → WaitingForDebateDecision.
     */
    private async handleDebate(): Promise<void> {
        const maxIter = this.context.maxDebateIterations ?? 2;
        const strategy = this.context.planStrategy ?? 'debate';

        // Initialize session if needed
        if (!this.debateSession) {
            this.debateSession = {
                strategy,
                rounds: [],
                convergence: null,
                synthesisResult: null,
            };
        }

        this.debateIterations++;

        if (this.debateIterations > maxIter) {
            logger.info('[AgentEngine]', `Debate iterations exceeded max (${maxIter}), moving to synthesis`);
            await this.transitionTo('Synthesizing');
            return;
        }

        const planSummary = this.plan.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
        const planContext = `**User request**: ${this.context.userInput}\n\n**Plan**:\n${planSummary}`;

        const previousRoundsText = this.debateSession.rounds
            .map(r => `[Round ${r.round} - ${r.role}]:\n${r.content}`)
            .join('\n\n');

        const roundNumber = this.debateIterations;

        try {
            if (strategy === 'perspectives') {
                // Perspectives strategy: Risk → Innovation → Cross-review
                let role: DiscussionRound['role'];
                let systemPrompt: string;
                let overrideModel: string | undefined;

                if (roundNumber === 1) {
                    role = 'risk-analysis';
                    systemPrompt = getDebateChallengePrompt('perspectives');
                    overrideModel = this.context.criticModel;
                    if (this.context.onMessage) {
                        this.context.onMessage('assistant', `🔴 **Risk Analysis** (round ${roundNumber}/${maxIter})...`);
                    }
                } else if (roundNumber === 2) {
                    role = 'innovation-analysis';
                    systemPrompt = getDebateChallengePrompt('perspectives');
                    overrideModel = undefined; // default model
                    if (this.context.onMessage) {
                        this.context.onMessage('assistant', `🟢 **Innovation Analysis** (round ${roundNumber}/${maxIter})...`);
                    }
                } else {
                    role = 'cross-review';
                    systemPrompt = getDebateDefensePrompt('perspectives');
                    overrideModel = this.context.criticModel;
                    if (this.context.onMessage) {
                        this.context.onMessage('assistant', `🔄 **Cross-Review** (round ${roundNumber}/${maxIter})...`);
                    }
                }

                const prompt = `${planContext}${previousRoundsText ? `\n\nPrevious analysis:\n${previousRoundsText}` : ''}\n\nYour assigned role for this round: **${role}**`;

                const response = await this.streamWithUI(
                    [{ role: 'user', content: prompt }],
                    overrideModel,
                    systemPrompt
                );

                this.debateSession.rounds.push({ round: roundNumber, role, content: response });
            } else {
                // Debate strategy: Odd = Critic CHALLENGE, Even = Planner DEFENSE
                const isOddRound = roundNumber % 2 === 1;

                if (isOddRound) {
                    if (this.context.onMessage) {
                        this.context.onMessage('assistant', `💬 **Debate Challenge** (round ${roundNumber}/${maxIter})...`);
                    }

                    const challengePrompt = `${planContext}${previousRoundsText ? `\n\nPrevious discussion:\n${previousRoundsText}` : ''}\n\nProvide your structured critique.`;

                    const response = await this.streamWithUI(
                        [{ role: 'user', content: challengePrompt }],
                        this.context.criticModel,
                        getDebateChallengePrompt('debate')
                    );

                    this.debateSession.rounds.push({ round: roundNumber, role: 'challenge', content: response });
                } else {
                    if (this.context.onMessage) {
                        this.context.onMessage('assistant', `💬 **Debate Defense** (round ${roundNumber}/${maxIter})...`);
                    }

                    const defensePrompt = `${planContext}\n\nPrevious discussion:\n${previousRoundsText}\n\nProvide your structured defense.`;

                    const response = await this.streamWithUI(
                        [{ role: 'user', content: defensePrompt }],
                        undefined,
                        getDebateDefensePrompt('debate')
                    );

                    this.debateSession.rounds.push({ round: roundNumber, role: 'defense', content: response });
                }
            }

            // Compute convergence
            const convergence = computeConvergence(this.debateSession.rounds);
            this.debateSession.convergence = convergence;

            logger.info('[AgentEngine]', `Debate convergence: score=${convergence.overallScore.toFixed(2)}, recommendation=${convergence.recommendation}`);

            if (this.context.onMessage) {
                this.context.onMessage('assistant', `📊 Convergence: ${convergence.overallScore.toFixed(2)} (${convergence.recommendation})`);
            }

            if (convergence.recommendation === 'converged' || convergence.recommendation === 'stalled') {
                await this.transitionTo('Synthesizing');
            } else {
                await this.transitionTo('Debating');
            }
        } catch (error) {
            logger.error('[AgentEngine]', 'Debate failed', error);
            this.debateIterations = 0;
            this.debateSession = null;
            await this.transitionTo('Executing');
        }
    }

    /**
     * Synthesize multi-round discussion results into a concise summary.
     * Handles both review and debate sessions.
     */
    private async handleSynthesis(): Promise<void> {
        const isReview = this.reviewSession !== null;
        const session = isReview ? this.reviewSession : this.debateSession;

        if (!session || session.rounds.length === 0) {
            logger.warn('[AgentEngine]', 'Synthesis: No session or rounds available');
            if (isReview) {
                this.reviewIterations = 0;
                this.reviewSession = null;
                await this.transitionTo('Executing');
            } else {
                this.debateIterations = 0;
                this.debateSession = null;
                await this.transitionTo('Executing');
            }
            return;
        }

        if (this.context.onMessage) {
            this.context.onMessage('assistant', `🔄 **Synthesizing** ${isReview ? 'review' : 'debate'} results...`);
        }

        try {
            const roundsSummary = session.rounds
                .map(r => `[Round ${r.round} - ${r.role}]:\n${r.content}`)
                .join('\n\n---\n\n');

            const synthesisPrompt = `Here are the discussion rounds to synthesize:\n\n${roundsSummary}\n\nPlease provide a comprehensive synthesis.`;
            const systemPrompt = isReview ? getReviewSynthesisPrompt() : getDebateSynthesisPrompt();

            const synthesisResponse = await this.streamWithUI(
                [{ role: 'user', content: synthesisPrompt }],
                undefined,
                systemPrompt
            );

            session.synthesisResult = synthesisResponse;

            if (this.context.onSynthesisComplete) {
                this.context.onSynthesisComplete(synthesisResponse);
            }
        } catch (error) {
            logger.error('[AgentEngine]', 'Synthesis failed, using fallback', error);
            // Fallback: concatenate round contents
            session.synthesisResult = session.rounds.map(r => `[${r.role}]: ${r.content}`).join('\n\n');

            if (this.context.onSynthesisComplete) {
                this.context.onSynthesisComplete(session.synthesisResult);
            }
        }

        if (isReview) {
            await this.transitionTo('WaitingForReviewDecision');
        } else {
            await this.transitionTo('WaitingForDebateDecision');
        }
    }

    /**
     * Pause engine and wait for user decision on review results.
     * Uses Promise to suspend until resolveReviewDecision() is called.
     */
    private async handleWaitingForReviewDecision(): Promise<void> {
        if (!this.reviewSession) {
            await this.transitionTo('Executing');
            return;
        }

        // Extract final feedback from the last critique round
        const lastCritique = [...this.reviewSession.rounds].reverse().find(r => r.role === 'critique');
        const feedback = lastCritique ? this.parseReviewFeedback(lastCritique.content) : null;

        // Notify UI with complete results
        if (this.context.onReviewComplete) {
            this.context.onReviewComplete(
                feedback ?? { verdict: 'NEEDS_FIX', summary: 'Review completed', issues: [] },
                this.reviewSession.rounds,
                this.reviewSession.convergence
            );
        }

        // Create Promise and wait for user decision
        const decision = await new Promise<'apply_fix' | 'skip'>((resolve) => {
            this.context.reviewDecisionResolver = resolve;
        });

        logger.info('[AgentEngine]', `Review decision: ${decision}`);
        this.context.reviewDecisionResolver = null;

        const step = this.plan[this.currentStepIndex];

        if (decision === 'apply_fix' && step && feedback) {
            // 이 step을 리뷰 완료로 표시 — Fixing → Observing 후 재리뷰 방지
            this.reviewedStepIds.add(step.id);
            // Transition to Fixing with review feedback
            const issueList = feedback.issues.map(i => `- **[${i.severity}]** ${i.description}${i.suggestion ? ` → ${i.suggestion}` : ''}`).join('\n');
            step.status = 'failed';
            step.result = `[Review NEEDS_FIX] ${feedback.summary}\n${issueList}\n\n[Synthesis]: ${this.reviewSession.synthesisResult ?? ''}`;
            this.notifyPlanChange();
            this.reviewIterations = 0;
            this.reviewSession = null;
            await this.transitionTo('Fixing');
        } else {
            // Skip — proceed to next step
            this.reviewIterations = 0;
            this.reviewSession = null;
            await this.transitionTo('Executing');
        }
    }

    /**
     * Pause engine and wait for user decision on debate results.
     * Uses Promise to suspend until resolveDebateDecision() is called.
     */
    private async handleWaitingForDebateDecision(): Promise<void> {
        if (!this.debateSession) {
            await this.transitionTo('Executing');
            return;
        }

        // Extract final feedback from the last challenge round
        const lastChallenge = [...this.debateSession.rounds].reverse().find(
            r => r.role === 'challenge' || r.role === 'cross-review'
        );
        const feedback = lastChallenge ? this.parseDebateFeedback(lastChallenge.content) : null;

        // Notify UI with complete results
        if (this.context.onDebateComplete) {
            this.context.onDebateComplete(
                feedback ?? { verdict: 'CHALLENGE', concerns: [], suggestions: [] },
                this.debateSession.rounds,
                this.debateSession.convergence
            );
        }

        // Create Promise and wait for user decision
        const decision = await new Promise<'revise' | 'accept'>((resolve) => {
            this.context.debateDecisionResolver = resolve;
        });

        logger.info('[AgentEngine]', `Debate decision: ${decision}`);
        this.context.debateDecisionResolver = null;

        if (decision === 'revise') {
            // Revise plan with synthesis feedback
            const synthesisContext = this.debateSession.synthesisResult ?? '';
            const revisePrompt = `Based on the debate synthesis, revise the plan:\n\n${synthesisContext}\n\nOriginal user request: ${this.context.userInput}\n\nOutput ONLY a markdown checklist (- [ ] ...) with the revised steps.`;

            const revisedResponse = await this.streamWithUI([{ role: 'user', content: revisePrompt }]);
            const revisedPlan = this.planner.parsePlan(revisedResponse);

            if (revisedPlan.length > 0) {
                this.plan = revisedPlan;
                this.notifyPlanChange();
            }

            this.debateIterations = 0;
            this.debateSession = null;
            await this.transitionTo('Planning');
        } else {
            // Accept — proceed with current plan
            this.debateIterations = 0;
            this.debateSession = null;
            await this.transitionTo('Executing');
        }
    }

    /**
     * Public method for UI to resolve review decision.
     */
    public resolveReviewDecision(decision: 'apply_fix' | 'skip'): void {
        if (this.context.reviewDecisionResolver) {
            this.context.reviewDecisionResolver(decision);
        }
    }

    /**
     * Public method for UI to resolve debate decision.
     */
    public resolveDebateDecision(decision: 'revise' | 'accept'): void {
        if (this.context.debateDecisionResolver) {
            this.context.debateDecisionResolver(decision);
        }
    }

    private parseReviewFeedback(response: string): ReviewFeedback | null {
        const jsonStr = extractJsonFromText(response);
        if (!jsonStr) return null;
        try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.verdict === 'PASS' || parsed.verdict === 'NEEDS_FIX') {
                return {
                    verdict: parsed.verdict,
                    summary: parsed.summary || '',
                    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
                    pointsOfAgreement: Array.isArray(parsed.pointsOfAgreement) ? parsed.pointsOfAgreement : undefined,
                    pointsOfDisagreement: Array.isArray(parsed.pointsOfDisagreement) ? parsed.pointsOfDisagreement : undefined,
                    unexaminedAssumptions: Array.isArray(parsed.unexaminedAssumptions) ? parsed.unexaminedAssumptions : undefined,
                    missingConsiderations: Array.isArray(parsed.missingConsiderations) ? parsed.missingConsiderations : undefined,
                };
            }
        } catch {
            logger.warn('[AgentEngine]', 'Failed to parse review feedback JSON');
        }
        return null;
    }

    private parseDebateFeedback(response: string): DebateFeedback | null {
        const jsonStr = extractJsonFromText(response);
        if (!jsonStr) return null;
        try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.verdict === 'APPROVE' || parsed.verdict === 'CHALLENGE') {
                return {
                    verdict: parsed.verdict,
                    concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
                    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
                    securityRisks: Array.isArray(parsed.securityRisks) ? parsed.securityRisks : undefined,
                    edgeCases: Array.isArray(parsed.edgeCases) ? parsed.edgeCases : undefined,
                    scalabilityConcerns: Array.isArray(parsed.scalabilityConcerns) ? parsed.scalabilityConcerns : undefined,
                    maintenanceBurden: Array.isArray(parsed.maintenanceBurden) ? parsed.maintenanceBurden : undefined,
                };
            }
        } catch {
            logger.warn('[AgentEngine]', 'Failed to parse debate feedback JSON');
        }
        return null;
    }

    /** 에이전트 역할, 도구 사용 규칙, 코드 품질 기준을 AI에게 지정하는 System Prompt */
    private static readonly SYSTEM_PROMPT = `You are an expert AI coding agent integrated into a VS Code extension. Your role is to autonomously plan and execute software engineering tasks by writing, reading, and modifying files.

## CRITICAL RESTRICTIONS (read first)
- **NO tool calls**: Do NOT output [TOOL_CALL], <tool_call>, or any native function-calling blocks. You have no external tools.
- **NO shell commands for exploration**: Do not try to run ls, cat, or other commands to explore the project. The context you need is already provided.
- **Planning mode**: When asked to make a plan, output ONLY a markdown checklist (- [ ] ...). Nothing else.
- **Action mode**: When asked for an action, output ONLY a JSON object. Nothing else.

## Core Rules
1. **SEARCH/REPLACE format**: When modifying existing files, ALWAYS use the SEARCH/REPLACE format. NEVER overwrite the entire file unless explicitly creating a brand-new file.
   The delimiters must be EXACTLY as shown (7 < characters, 7 = characters, 7 > characters):
   <<<<<<< SEARCH
   (exact lines copied from the original file — must match precisely)
   =======
   (new replacement lines)
   >>>>>>> REPLACE

2. **JSON output for actions**: Output ONLY valid JSON (optionally wrapped in a \`\`\`json block). No explanation text outside the JSON.
   When the SEARCH/REPLACE content is inside a JSON string, escape newlines as \\n:
   { "type": "write", "payload": { "path": "src/foo.ts", "content": "<<<<<<< SEARCH\\nold line\\n=======\\nnew line\\n>>>>>>> REPLACE" } }

3. **Minimal changes**: Only modify what is strictly necessary. Do not reformat unrelated code.
4. **Correctness first**: Ensure all imports, types, and references are valid before finalizing.
5. **Language**: Respond in the same language as the user's request.`;

    /**
     * AI 스트리밍 응답을 수집하면서 동시에 webview UI에 실시간 전달합니다.
     * System Prompt를 자동으로 prepend합니다.
     * 모든 handlePlanning / handleExecution / handleReflection / handleFixing 에서 공통 사용.
     *
     * - context.abortSignal이 설정되어 있으면 스트리밍을 조기 종료합니다 (Stop 버튼 지원).
     * - Qwen3 등의 <think>...</think> 블록을 제거한 후 반환합니다.
     */
    private async streamWithUI(
        messages: ChatMessage[],
        overrideModel?: string,
        overrideSystemPrompt?: string
    ): Promise<string> {
        if (this.context.onStreamStart) this.context.onStreamStart();

        const systemContent = overrideSystemPrompt ?? AgentEngine.SYSTEM_PROMPT;
        const systemMessage: ChatMessage = { role: 'system', content: systemContent };
        const fullMessages = [systemMessage, ...messages];

        let aiResponse = '';
        // 현재 숨겨진 블록(<think>, [TOOL_CALL]) 안에 있는지 추적
        let hiddenDepth = 0;

        const OPEN_RE  = /<think>|\[TOOL_CALL\]/i;
        const CLOSE_RE = /<\/think>|<\/thinking>|\[\/TOOL_CALL\]/i;

        const streamResult = streamChatCompletion(fullMessages, this.context.abortSignal, overrideModel);
        for await (const chunk of streamResult.content) {
            if (this.context.abortSignal?.aborted) break;
            aiResponse += chunk;

            // <think> / [TOOL_CALL] 블록을 UI에 실시간으로 숨기고, 그 외 내용만 전달
            if (this.context.onStreamChunk) {
                let remaining = chunk;
                let visibleChunk = '';

                while (remaining.length > 0) {
                    if (hiddenDepth === 0) {
                        const m = OPEN_RE.exec(remaining);
                        if (!m) { visibleChunk += remaining; remaining = ''; }
                        else {
                            visibleChunk += remaining.slice(0, m.index);
                            remaining = remaining.slice(m.index + m[0].length);
                            hiddenDepth++;
                        }
                    } else {
                        const m = CLOSE_RE.exec(remaining);
                        if (!m) { remaining = ''; }
                        else {
                            remaining = remaining.slice(m.index + m[0].length);
                            hiddenDepth = Math.max(0, hiddenDepth - 1);
                        }
                    }
                }

                if (visibleChunk) this.context.onStreamChunk(visibleChunk);
            }
        }

        if (this.context.onStreamEnd) this.context.onStreamEnd();
        // 전체 응답에서 <think>, [TOOL_CALL] 블록 제거 후 반환
        return stripThinkingBlocks(aiResponse);
    }

    public updateContext(partialContext: Partial<AgentContext>): void {
        this.context = { ...this.context, ...partialContext };
    }

    /**
     * 새 요청 전에 에이전트 상태를 완전히 초기화합니다.
     * Agent 모드에서 요청마다 호출하여 이전 실행의 잔류 상태를 제거합니다.
     */
    public reset(): void {
        // Resolve any pending decisions before clearing state
        if (this.context.reviewDecisionResolver) {
            this.context.reviewDecisionResolver('skip');
            this.context.reviewDecisionResolver = null;
        }
        if (this.context.debateDecisionResolver) {
            this.context.debateDecisionResolver('accept');
            this.context.debateDecisionResolver = null;
        }

        this.state = 'Idle';
        this.plan = [];
        this.currentStepIndex = -1;
        this.fixAttempts.clear();
        this.consecutiveMistakeCount = 0;
        this.reviewIterations = 0;
        this.debateIterations = 0;
        this.reviewSession = null;
        this.debateSession = null;
        this.reviewedStepIds.clear();
        this.lastDiagnostics = [];
    }

    /**
     * Plan 모드 전용: AI 응답에서 계획을 파싱하여 사이드바에 표시합니다.
     * 상태를 변경하거나 실행을 시작하지 않습니다.
     */
    public setPlanForDisplay(response: string): void {
        this.plan = this.planner.parsePlan(response);
        this.notifyPlanChange();
        // 의도적으로 state를 'Executing'으로 전환하지 않음 — 계획 표시만
    }

    /**
     * Agent 모드 전용: Apply Changes 후 multi-model review를 시작합니다.
     * chatPanel에서 파일 작업이 성공한 뒤 호출됩니다.
     * 합성 PlanStep을 생성하고 Reviewing 상태에서 run()을 실행합니다.
     */
    public async startReviewForOperations(
        operationDescriptions: string[],
        operationResults: string
    ): Promise<void> {
        // 합성 PlanStep 생성
        const syntheticStep: PlanStep = {
            id: `review-${Date.now()}`,
            description: operationDescriptions.join('; '),
            status: 'done',
            action: operationDescriptions.map(d => `[Applied] ${d}`).join('\n'),
            result: operationResults,
        };

        this.plan = [syntheticStep];
        this.currentStepIndex = 0;
        this.reviewIterations = 0;
        this.reviewSession = null;
        this.notifyPlanChange();

        await this.transitionTo('Reviewing');
        await this.run();
    }

    /**
     * Plan 모드 전용: Apply Changes 없이 debate를 시작합니다.
     * chatPanel에서 Plan 응답 후 호출됩니다.
     */
    public async startDebateForPlan(): Promise<void> {
        this.debateIterations = 0;
        this.debateSession = null;

        await this.transitionTo('Debating');
        await this.run();
    }

    public stop(): void {
        this.state = 'Idle';
    }

    /**
     * 실행 전 pre-flight 검사: SEARCH/REPLACE 액션의 SEARCH 블록이 대상 파일에
     * 실제로 존재하는지 확인합니다. 불일치 시 현재 파일 내용을 AI에게 제공하고
     * 즉시 수정을 요청합니다.
     *
     * 이를 통해 Executing → Observing → Reflecting → Fixing 전체 사이클 없이
     * SEARCH 블록 불일치를 사전에 해결합니다 (qwen3/glm/minimax 안정성 향상).
     */
    private async preflightCheckAction(action: any, _step: PlanStep): Promise<any> {
        if (!action) return action;

        if (action.type === 'write') {
            return await this.checkWriteAction(action);
        }

        // multi_write — 각 edit 작업을 개별 검사
        if (action.type === 'multi_write') {
            const ops: any[] = action.payload?.operations ?? [];
            const checkedOps: any[] = [];
            for (const op of ops) {
                if (op.operation === 'edit' && typeof op.content === 'string' && op.content.includes('<<<<<<< SEARCH')) {
                    const checked = await this.checkWriteAction({ type: 'write', payload: { path: op.path, content: op.content } });
                    checkedOps.push({ ...op, content: checked.payload.content });
                } else {
                    checkedOps.push(op);
                }
            }
            return { ...action, payload: { ...action.payload, operations: checkedOps } };
        }

        return action;
    }

    /** write 액션에서 SEARCH 블록이 파일에 존재하는지 확인하고, 없으면 AI에게 수정 요청 */
    private async checkWriteAction(action: any): Promise<any> {
        const content: string = action.payload?.content ?? '';
        if (!content.includes('<<<<<<< SEARCH')) return action;

        const filePath: string = action.payload?.path ?? '';
        if (!filePath) return action;

        let currentContent: string;
        try {
            currentContent = await this.executor.readFile(filePath);
        } catch {
            return action; // 파일 없음 → 새 파일 생성 케이스
        }

        const searchMatch = content.match(/<<<<<<< SEARCH\n([\s\S]*?)\n?=======/);
        if (!searchMatch) return action;

        const searchContent = searchMatch[1];

        // exact match 또는 공백 무시 line-trimmed match 확인
        const searchLines = searchContent.split('\n');
        const fileLines = currentContent.split('\n');
        const exactFound = currentContent.includes(searchContent);
        const trimFound = !exactFound && fileLines.some((_, i) =>
            fileLines.slice(i, i + searchLines.length)
                .map(l => l.trim()).join('\n') === searchLines.map(l => l.trim()).join('\n')
        );

        if (exactFound || trimFound) return action; // ✅ SEARCH 블록 확인됨

        logger.warn('[AgentEngine]', `Pre-flight: SEARCH mismatch in ${filePath} — requesting inline correction`);

        const replaceMatch = content.match(/=======\n([\s\S]*?)\n?>>>>>>>/);
        const replaceContent = replaceMatch?.[1] ?? '';
        const filePreview = currentContent.length > 3000
            ? currentContent.substring(0, 3000) + '\n... (truncated)'
            : currentContent;

        const fixPrompt = `The SEARCH block does not match the actual content of \`${filePath}\`.

**Current file content** (copy exact lines from here for your SEARCH block):
\`\`\`
${filePreview}
\`\`\`

**Your SEARCH block** (did NOT match):
\`\`\`
${searchContent}
\`\`\`

**Your REPLACE block** (intended change — keep this):
\`\`\`
${replaceContent}
\`\`\`

Provide a corrected JSON action with the SEARCH section exactly matching the current file above.
Output ONLY valid JSON, no explanation.`;

        const fixResponse = await this.streamWithUI([{ role: 'user', content: fixPrompt }]);
        const fixJson = extractJsonFromText(fixResponse);
        if (fixJson) {
            try {
                const fixed = JSON.parse(fixJson);
                logger.info('[AgentEngine]', `Pre-flight: Corrected action for ${filePath}`);
                return fixed;
            } catch {
                logger.warn('[AgentEngine]', 'Pre-flight: Could not parse corrected action, using original');
            }
        }
        return action;
    }

    /**
     * CheckpointManager에 접근하기 위한 public 메서드
     */
    public getCheckpointManager(): CheckpointManager | null {
        return this.checkpointManager;
    }
}
