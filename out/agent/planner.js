"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Planner = void 0;
class Planner {
    /**
     * AI의 텍스트 응답에서 구조화된 Plan을 추출합니다.
     * 마크다운 체크리스트 (- [ ] ...) 형식을 선호합니다.
     */
    parsePlan(text) {
        const steps = [];
        const lines = text.split('\n');
        let currentStep = null;
        let actionBuffer = '';
        let capturingAction = false;
        for (const line of lines) {
            // 새 스텝 감지 패턴: [step: id] 또는 - [ ] 또는 1. [ ]
            const stepMatch = line.match(/^[\s\d.]*[-*]?\s*\[\s*[x ]\s*\]\s*(.+)/i) ||
                line.match(/^\d+\.\s*(.+)/);
            if (stepMatch) {
                // 이전 스텝이 있었다면 저장
                if (currentStep) {
                    if (actionBuffer)
                        currentStep.action = actionBuffer.trim();
                    steps.push(currentStep);
                }
                let description = stepMatch[1].trim();
                const dependsMatch = description.match(/\[depends:\s*(.+?)\]/);
                let dependsOn;
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
            }
            else if (currentStep && line.trim().startsWith('{')) {
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
            steps.push(currentStep);
        }
        return steps;
    }
    /**
     * 실행 중 오류가 발생했거나 상황이 변했을 때 기존 플랜을 수정합니다.
     */
    replan(currentPlan, newContext) {
        // TODO: AI와 협력하여 플랜 업데이트
        return currentPlan;
    }
}
exports.Planner = Planner;
//# sourceMappingURL=planner.js.map