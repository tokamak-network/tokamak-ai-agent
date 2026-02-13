import { PlanStep } from './types.js';

export class Planner {
    /**
     * AI의 텍스트 응답에서 구조화된 Plan을 추출합니다.
     * 마크다운 체크리스트 (- [ ] ...) 형식을 선호합니다.
     */
    public parsePlan(text: string): PlanStep[] {
        const steps: PlanStep[] = [];
        const lines = text.split('\n');

        for (const line of lines) {
            // 마크다운 체크리스트 패턴 매칭 (- [ ] 제목 또는 1. [ ] 제목)
            // 추가로 의존성 힌트 감지: [depends: step-0]
            const match = line.match(/^[\s\d.]*[-*]?\s*\[\s*[x ]\s*\]\s*(.+)/i) ||
                line.match(/^\d+\.\s*(.+)/);

            if (match && match[1]) {
                let description = match[1].trim();
                if (description && !description.toLowerCase().startsWith('plan')) {
                    const dependsMatch = description.match(/\[depends:\s*(.+?)\]/);
                    let dependsOn: string[] | undefined;

                    if (dependsMatch) {
                        dependsOn = dependsMatch[1].split(',').map(s => s.trim());
                        description = description.replace(dependsMatch[0], '').trim();
                    }

                    // 수동 ID 지정이 있으면 사용, 없으면 자동 생성
                    const idMatch = description.match(/^(\w+):\s*/);
                    let id = `step-${steps.length}`;
                    if (idMatch) {
                        id = idMatch[1];
                        description = description.replace(idMatch[0], '').trim();
                    }

                    steps.push({
                        id,
                        description,
                        status: 'pending',
                        dependsOn
                    });
                }
            }
        }

        return steps;
    }

    /**
     * 실행 중 오류가 발생했거나 상황이 변했을 때 기존 플랜을 수정합니다.
     */
    public replan(currentPlan: PlanStep[], newContext: string): PlanStep[] {
        // TODO: AI와 협력하여 플랜 업데이트
        return currentPlan;
    }
}
