import { PlanStep } from './types.js';

export class Planner {
    /**
     * AI의 텍스트 응답에서 구조화된 Plan을 추출합니다.
     * 마크다운 체크리스트 (- [ ] ...) 형식을 선호합니다.
     */
    public parsePlan(text: string): PlanStep[] {
        const steps: PlanStep[] = [];
        const lines = text.split('\n');

        let currentStep: Partial<PlanStep> | null = null;
        let actionBuffer = '';
        let capturingAction = false;

        for (const line of lines) {
            // 새 스텝 감지 패턴: [step: id] 또는 - [ ] 또는 1. [ ]
            const stepMatch = line.match(/^[\s\d.]*[-*]?\s*\[\s*[x ]\s*\]\s*(.+)/i) ||
                line.match(/^\d+\.\s*(.+)/);

            if (stepMatch) {
                // 이전 스텝이 있었다면 저장
                if (currentStep) {
                    if (actionBuffer) currentStep.action = actionBuffer.trim();
                    steps.push(currentStep as PlanStep);
                }

                let description = stepMatch[1].trim();
                const dependsMatch = description.match(/\[depends:\s*(.+?)\]/);
                let dependsOn: string[] | undefined;

                if (dependsMatch) {
                    dependsOn = dependsMatch[1].split(',').map(s => s.trim());
                    description = description.replace(dependsMatch[0], '').trim();
                }

                const idMatch = description.match(/^(\w+):\s*/);
                let id = `step-\${steps.length}`;
                if (idMatch) {
                    id = idMatch[1];
                    description = description.replace(idMatch[0], '').trim();
                }

                currentStep = {
                    id,
                    description,
                    status: 'pending',
                    dependsOn
                };
                actionBuffer = '';
                capturingAction = false;

                // 같은 줄에 JSON 액션이 시작되는지 확인
                const jsonStartIdx = line.indexOf('{');
                if (jsonStartIdx !== -1) {
                    capturingAction = true;
                    actionBuffer = line.substring(jsonStartIdx);
                }
                continue;
            }

            // 액션 캡처 중인 경우 버퍼에 추가
            if (capturingAction && currentStep) {
                actionBuffer += '\n' + line;
                // JSON이 끝났는지 확인 (단순하게 마지막 중괄호 매칭 - 고도화 필요)
                if (line.trim().endsWith('}') || line.trim().endsWith('}```')) {
                    capturingAction = false;
                }
            } else if (currentStep && line.trim().startsWith('{')) {
                // 스텝 다음 줄에 JSON이 시작되는 경우
                capturingAction = true;
                actionBuffer = line;
            }
        }

        // 마지막 스텝 추가
        if (currentStep) {
            if (actionBuffer) {
                // JSON만 남기기 위한 정교한 정제
                let cleanedAction = actionBuffer.trim()
                    .replace(/^```json\s*|^```\s*/g, '') // 시작 백틱 제거
                    .replace(/```$/g, ''); // 끝 백틱 제거

                const lastBraceIdx = cleanedAction.lastIndexOf('}');
                if (lastBraceIdx !== -1) {
                    cleanedAction = cleanedAction.substring(0, lastBraceIdx + 1);
                }
                currentStep.action = cleanedAction;
            }
            steps.push(currentStep as PlanStep);
        }

        return steps;
    }

    /**
     * 실행 중 오류가 발생했거나 상황이 변했을 때 기존 플랜을 수정합니다.
     */
    public async replan(currentPlan: PlanStep[], newContext: string, streamFn: any): Promise<PlanStep[]> {
        const planSummary = currentPlan.map((step, idx) =>
            `${idx + 1}. [${step.status}] ${step.description}${step.result ? `\n   Result: ${step.result.substring(0, 200)}...` : ''}`
        ).join('\n');

        const prompt = `
현재 실행 중인 계획이 다음과 같습니다:
${planSummary}

새로운 상황:
${newContext}

위 상황을 고려하여 계획을 수정해주세요.
- 완료된(done) 단계는 유지
- 실패한(failed) 단계는 수정 또는 제거
- 필요하면 새로운 단계 추가
- 각 단계는 마크다운 체크리스트 형식(- [ ] 설명)으로 작성

수정된 계획:
`;

        let aiResponse = '';
        const stream = streamFn([{ role: 'user', content: prompt }]);
        for await (const chunk of stream) {
            aiResponse += chunk;
        }

        // 새 계획 파싱
        const newPlan = this.parsePlan(aiResponse);

        // 완료된 단계는 유지
        const completedSteps = currentPlan.filter(s => s.status === 'done');

        // 새 계획에 완료된 단계 정보 병합
        for (const completed of completedSteps) {
            const matchingNew = newPlan.find(n =>
                n.description.toLowerCase().includes(completed.description.toLowerCase().substring(0, 30))
            );
            if (matchingNew) {
                matchingNew.status = 'done';
                matchingNew.result = completed.result;
            }
        }

        return newPlan.length > 0 ? newPlan : currentPlan;
    }
}
