"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentEngine = void 0;
const planner_js_1 = require("./planner.js");
const executor_js_1 = require("./executor.js");
const observer_js_1 = require("./observer.js");
const searcher_js_1 = require("./searcher.js");
const contextManager_js_1 = require("./contextManager.js");
const client_js_1 = require("../api/client.js");
class AgentEngine {
    state = 'Idle';
    plan = [];
    context;
    currentStepIndex = -1;
    fixAttempts = new Map();
    planner = new planner_js_1.Planner();
    executor = new executor_js_1.Executor();
    observer = new observer_js_1.Observer();
    searcher = new searcher_js_1.Searcher();
    contextManager;
    lastDiagnostics = [];
    constructor(context) {
        this.context = context;
        this.contextManager = new contextManager_js_1.ContextManager(this.executor);
    }
    async transitionTo(nextState) {
        console.log(`[AgentEngine] Transitioning from ${this.state} to ${nextState}`);
        this.state = nextState;
        if (this.context.onStateChange) {
            this.context.onStateChange(nextState);
        }
    }
    getState() {
        return this.state;
    }
    getPlan() {
        return this.plan;
    }
    notifyPlanChange() {
        if (this.context.onPlanChange) {
            this.context.onPlanChange([...this.plan]);
        }
    }
    async setPlanFromResponse(response) {
        this.plan = this.planner.parsePlan(response);
        this.notifyPlanChange();
        if (this.plan.length > 0) {
            await this.transitionTo('Executing');
        }
    }
    /**
     * 중앙 자율 루프
     */
    async run() {
        if (this.state === 'Done' || this.state === 'Error') {
            return;
        }
        try {
            while (true) {
                const currentState = this.state;
                if (currentState === 'Idle' || currentState === 'Done' || currentState === 'Error') {
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
        }
        catch (error) {
            console.error('[AgentEngine] Critical Error in Loop:', error);
            await this.transitionTo('Error');
        }
    }
    async handlePlanning() {
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
`;
            let aiResponse = '';
            const streamResult = (0, client_js_1.streamChatCompletion)([{ role: 'user', content: prompt }]);
            for await (const chunk of streamResult.content) {
                aiResponse += chunk;
            }
            this.plan = this.planner.parsePlan(aiResponse);
            if (this.plan.length > 0) {
                this.notifyPlanChange();
                await this.transitionTo('Executing');
            }
            else {
                console.warn('[AgentEngine] No plan extracted.');
                await this.transitionTo('Done');
            }
        }
        catch (error) {
            console.error('[AgentEngine] Planning failed:', error);
            await this.transitionTo('Error');
        }
    }
    async handleExecution() {
        const step = this.getNextExecutableStep();
        if (!step) {
            const allDone = this.plan.every(s => s.status === 'done');
            if (allDone) {
                await this.transitionTo('Done');
            }
            else {
                console.warn('[AgentEngine] No executable steps found.');
                await this.transitionTo('Idle');
            }
            return;
        }
        this.currentStepIndex = this.plan.indexOf(step);
        step.status = 'running';
        this.notifyPlanChange();
        try {
            let action = null;
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

위 단계를 실행하기 위한 구체적인 **JSON Action** 하나만 답변해주세요.
- 파일 생성/수정 시: { "type": "write", "payload": { "path": "...", "content": "..." } }
- 내용이 길 경우 반드시 **SEARCH/REPLACE** 형식을 사용하세요.
- 답변에는 마크다운 없이 오직 JSON만 포함하거나, \`\`\`json 블록으로 감싸주세요.
`;
                let aiResponse = '';
                const streamResult = (0, client_js_1.streamChatCompletion)([{ role: 'user', content: prompt }]);
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
                }
                catch (e) {
                    console.warn('[AgentEngine] Failed to parse action JSON, falling back to raw write.', e);
                    // 폴백: JSON 파싱 실패 시 내용을 그대로 파일 쓰기로 간주 (위험할 수 있음)
                    const pathMatch = step.description.match(/(`|'|")(.+?\.\w+)\1/);
                    if (pathMatch) {
                        action = { type: 'write', payload: { path: pathMatch[2], content: step.action } };
                    }
                }
            }
            if (action) {
                const result = await this.executor.execute(action);
                step.result = result;
            }
            else {
                step.result = 'No executable action found for this step.';
            }
            step.status = 'done';
            this.notifyPlanChange();
            await this.transitionTo('Observing');
        }
        catch (error) {
            step.status = 'failed';
            step.result = error instanceof Error ? error.message : 'Unknown error';
            this.notifyPlanChange();
            await this.transitionTo('Fixing');
        }
    }
    getNextExecutableStep() {
        return this.plan.find(step => {
            if (step.status !== 'pending')
                return false;
            if (!step.dependsOn || step.dependsOn.length === 0)
                return true;
            return step.dependsOn.every(depId => {
                const depStep = this.plan.find(s => s.id === depId);
                return depStep && depStep.status === 'done';
            });
        });
    }
    async handleObservation() {
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
        }
        else {
            // 에러가 없으면 Reflecting 단계로 이동하여 AI가 결과 평가
            await this.transitionTo('Reflecting');
        }
    }
    async handleReflection() {
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
            const streamResult = (0, client_js_1.streamChatCompletion)([{ role: 'user', content: prompt }]);
            for await (const chunk of streamResult.content) {
                aiResponse += chunk;
            }
            const evaluation = aiResponse.trim().toUpperCase();
            if (evaluation.includes('SUCCESS')) {
                console.log('[AgentEngine] Reflection: SUCCESS - proceeding to next step');
                await this.transitionTo('Executing');
            }
            else if (evaluation.includes('RETRY')) {
                console.log('[AgentEngine] Reflection: RETRY - attempting to fix');
                step.status = 'failed';
                this.notifyPlanChange();
                await this.transitionTo('Fixing');
            }
            else if (evaluation.includes('REPLAN')) {
                console.log('[AgentEngine] Reflection: REPLAN - replanning required');
                const replanContext = `Previous step result: ${step.result}\nAI Evaluation: ${aiResponse}`;
                this.plan = await this.planner.replan(this.plan, replanContext, client_js_1.streamChatCompletion);
                this.notifyPlanChange();
                await this.transitionTo('Executing');
            }
            else {
                // 불명확한 응답은 일단 진행
                console.warn('[AgentEngine] Reflection: Unclear response, proceeding anyway');
                await this.transitionTo('Executing');
            }
        }
        catch (error) {
            console.error('[AgentEngine] Reflection failed:', error);
            await this.transitionTo('Executing');
        }
    }
    async handleFixing() {
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
`;
        try {
            let aiResponse = '';
            const streamResult = (0, client_js_1.streamChatCompletion)([{ role: 'user', content: prompt }]);
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
        }
        catch (error) {
            await this.transitionTo('Error');
        }
    }
    updateContext(partialContext) {
        this.context = { ...this.context, ...partialContext };
    }
    stop() {
        this.state = 'Idle';
    }
}
exports.AgentEngine = AgentEngine;
//# sourceMappingURL=engine.js.map