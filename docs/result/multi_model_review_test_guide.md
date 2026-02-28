# 멀티 모델 리뷰 시스템 테스트 가이드

## Level 1: 자동 테스트 (완료)

```bash
npm test        # 89개 통과 (convergence 16 + engine 11 + 기존 62)
npm run compile # 타입 에러 0개
```

---

## Level 2: VS Code에서 수동 테스트

VS Code에서 F5로 Extension Development Host를 실행한 후 아래 시나리오를 순서대로 확인하세요.

### 테스트 A: 기존 동작 유지 (Multi-Model OFF)

1. Chat 패널에서 Review 토글 OFF 상태 확인
2. Agent 모드에서 "Hello World 함수를 만들어줘" 입력
3. 예상 결과: 기존처럼 Planning → Executing → Observing → Done 흐름 (Reviewing/Debating 없음)
4. 전략 드롭다운이 보이지 않아야 함

### 테스트 B: Review 전략 — Multi-Round Review

1. Review 토글 ON
2. Reviewer/Critic 모델 드롭다운 확인 — 모델 선택
3. Strategy 드롭다운 나타남 확인 → Agent: Review, Plan: Debate
4. Agent 모드에서 "src/utils에 formatDate 함수 만들어줘" 입력
5. 예상 흐름:
   `Planning` → `Executing` → `Observing` → `Reviewing` (Round 1/3 Critique)
   → `Reviewing` (Round 2/3 Rebuttal) → ...
   → `Synthesizing` → `[Review Results 패널 표시]`
6. 확인할 것:
   - 상태 배지 색상: `Reviewing`=보라, `Synthesizing`=청록, `Awaiting Decision`=파랑
   - Review Results 패널에 라운드별 critique/rebuttal 표시
   - Convergence 배지 (초록=converged, 빨강=stalled, 파랑=continue)
   - Synthesis 블록 표시
7. "Skip & Continue" 클릭 → 다음 step으로 진행 확인
8. 같은 테스트 반복 후 "Apply Fix" 클릭 → Fixing 상태로 전환 확인

### 테스트 C: Red-Team 전략

1. Agent Strategy 드롭다운에서 Red-Team 선택
2. Agent 모드에서 "사용자 로그인 API 만들어줘" 입력
3. 예상 결과: Critique에 Security Risks, Edge Cases, Scalability 섹션이 보임
4. Rebuttal에 Accepted/Rejected Challenges 섹션이 보임

### 테스트 D: Debate 전략 — Plan 비평

1. Plan 모드에서 "REST API 서버 구축 계획 세워줘" 입력
2. Plan Strategy: Debate 확인
3. 예상 흐름:
   `Planning` → `Debating` (Round 1 Challenge) → `Debating` (Round 2 Defense) → ...
   → `Synthesizing` → `[Debate Results 패널 표시]`
4. "Revise Plan" 클릭 → Planning으로 돌아가 수정된 플랜 생성 확인
5. 같은 테스트 반복 후 "Accept as-is" 클릭 → Executing으로 진행 확인

### 테스트 E: Perspectives 전략

1. Plan Strategy 드롭다운에서 Perspectives 선택
2. Plan 모드에서 "마이크로서비스 아키텍처 전환 계획" 입력
3. 예상 결과:
   - Round 1: 🔴 Risk Analysis (위험 관점)
   - Round 2: 🟢 Innovation Analysis (혁신 관점)
   - Round 3: 🔄 Cross-Review (교차 검토)

### 테스트 F: 수렴 조기 종료

1. maxReviewIterations: 6 으로 설정 (Settings → `tokamak.maxReviewIterations`)
2. Review 실행 — AI 응답이 많이 겹치면(agreement 높으면) maxIter 전에 Synthesizing으로 전환되는지 확인
3. 로그에 `Review convergence: score=X.XX, recommendation=converged` 출력 확인

### 테스트 G: Settings 저장

1. VS Code Settings (JSON)에서 확인:
   `"tokamak.agentStrategy": "red-team"`
   `"tokamak.planStrategy": "perspectives"`
2. VS Code 재시작 후 드롭다운에 저장된 값이 유지되는지 확인

---

## Level 3: 빠른 체크리스트

| # | 검증 항목 | 확인 방법 |
|---|---|---|
| 1 | 타입 에러 없음 | `npm run compile` |
| 2 | 테스트 89개 통과 | `npm test` |
| 3 | 토글 OFF → 기존 동작 100% | 테스트 A |
| 4 | Strategy 드롭다운 표시/숨김 | 토글 ON/OFF |
| 5 | Review 멀티라운드 | 테스트 B |
| 6 | 상태 배지 색상 4종 | Reviewing/Debating/Awaiting/Synthesizing |
| 7 | Review 패널 표시 | 라운드, 수렴 배지, Synthesis |
| 8 | Skip → Executing | 테스트 B-7 |
| 9 | Apply Fix → Fixing | 테스트 B-8 |
| 10 | Red-Team 프롬프트 | 테스트 C |
| 11 | Debate 멀티라운드 | 테스트 D |
| 12 | Revise → Planning | 테스트 D-4 |
| 13 | Accept → Executing | 테스트 D-5 |
| 14 | Perspectives 3라운드 | 테스트 E |
| 15 | 수렴 조기 종료 | 테스트 F |
| 16 | Settings 영속 | 테스트 G |

> [!IMPORTANT]
> 가장 중요한 핵심 3개: **테스트 A**(하위호환), **테스트 B**(리뷰 전체 흐름), **테스트 D**(비평 전체 흐름)를 먼저 확인하세요.
