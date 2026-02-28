# 멀티 모델 리뷰 시스템 — Mysti 수준 개선

## Context

이전 구현에서 기본적인 멀티 모델 리뷰가 동작하지만 Mysti BrainstormManager 대비 5가지 핵심 부족:
1. 수렴 감지 없음 — 단순 카운터만 사용
2. 구조화 프롬프트 없음 — 간단한 JSON 지시만
3. 자동 적용 위험 — NEEDS_FIX 시 사용자 확인 없이 자동 수정
4. Synthesis 없음 — 토론 결과 통합 단계 부재
5. 전략 선택 불가 — 고정 패턴 1개만

목표: 5가지 전부 Mysti 수준으로 개선

---

## Phase 1: 타입 + 수렴 감지 모듈

### 1A. src/agent/types.ts — 타입 확장

`AgentState`에 3개 추가:
```typescript
 | 'WaitingForReviewDecision'  // 리뷰 결과 표시, 사용자 결정 대기
 | 'WaitingForDebateDecision'  // 비평 결과 표시, 사용자 결정 대기
 | 'Synthesizing'              // 토론 종합 생성 중
```

새 타입:
```typescript
type AgentStrategy = 'review' | 'red-team';
type PlanStrategy = 'debate' | 'perspectives';

interface ConvergenceMetrics {
    agreementRatio: number;   // agreement / (agreement + disagreement)
    avgStability: number;     // Jaccard similarity between rounds
    overallScore: number;     // (agreementRatio * 0.6) + (avgStability * 0.4)
    recommendation: 'continue' | 'converged' | 'stalled';
}

interface DiscussionRound {
    round: number;
    role: 'critique' | 'rebuttal' | 'challenge' | 'defense' | 'risk-analysis' | 'innovation-analysis' | 'cross-review';
    content: string;
}

interface ReviewSessionState {
    strategy: AgentStrategy;
    rounds: DiscussionRound[];
    convergence: ConvergenceMetrics | null;
    synthesisResult: string | null;
}

interface DebateSessionState {
    strategy: PlanStrategy;
    rounds: DiscussionRound[];
    convergence: ConvergenceMetrics | null;
    synthesisResult: string | null;
}
```

`AgentContext`에 추가:
```typescript
agentStrategy?: AgentStrategy;
planStrategy?: PlanStrategy;
onReviewComplete?: (feedback: ReviewFeedback, rounds: DiscussionRound[], convergence: ConvergenceMetrics | null) => void;
onDebateComplete?: (feedback: DebateFeedback, rounds: DiscussionRound[], convergence: ConvergenceMetrics | null) => void;
onSynthesisComplete?: (synthesis: string) => void;
reviewDecisionResolver?: ((decision: 'apply_fix' | 'skip') => void) | null;
debateDecisionResolver?: ((decision: 'revise' | 'accept') => void) | null;
```

`ReviewFeedback` 확장:
```typescript
pointsOfAgreement?: string[];
pointsOfDisagreement?: { claim: string; explanation: string; alternative: string }[];
unexaminedAssumptions?: string[];
missingConsiderations?: string[];
```

`DebateFeedback` 확장:
```typescript
securityRisks?: { description: string; severity: string }[];
edgeCases?: string[];
scalabilityConcerns?: string[];
maintenanceBurden?: string[];
```

### 1B. src/agent/convergence.ts — 새 파일 (순수 함수, 테스트 가능)

Mysti `_assessConvergence` 패턴 포팅:

```typescript
// Agreement 패턴: agree, concede, valid point, correct, accept, fair, acknowledged
// Disagreement 패턴: disagree, however, incorrect, but, challenge, oppose, flaw
export function detectAgreementRatio(text: string): number;

// Jaccard: |A ∩ B| / |A ∪ B|, 3글자 이상 단어만
export function jaccardSimilarity(a: string, b: string): number;

// 전체 수렴 계산: rounds 배열로부터
// converged: agreementRatio >= 0.7 AND avgStability >= 0.8
// stalled: prevScore >= currentScore AND avgStability < 0.3
export function computeConvergence(rounds: DiscussionRound[]): ConvergenceMetrics;
```

### 1C. src/__tests__/convergence.test.ts — 단위 테스트

`detectAgreementRatio`, `jaccardSimilarity`, `computeConvergence` 테스트

---

## Phase 2: 구조화 프롬프트

`src/chat/systemPromptBuilder.ts`

기존 `getReviewerSystemPrompt()`, `getCriticSystemPrompt()` 유지 (하위호환), 새 함수 추가:

**Review 전략별:**
- `getReviewCritiquePrompt('review')` — Points of Agreement/Disagreement, Unexamined Assumptions, Missing Considerations + JSON verdict
- `getReviewCritiquePrompt('red-team')` — Security Risks, Edge Cases, Scalability, Maintenance, Missing Requirements, Issue Summary (CRITICAL/MAJOR/MINOR) + JSON verdict
- `getReviewRebuttalPrompt('review')` — Conceded Points, Defended Points, Refined Recommendation + JSON
- `getReviewRebuttalPrompt('red-team')` — Accepted/Rejected Challenges, Revised Solution + JSON

**Debate 전략별:**
- `getDebateChallengePrompt('debate')` — structured critique with sections + JSON
- `getDebateChallengePrompt('perspectives')` — Risk lens / Innovation lens prompts
- `getDebateDefensePrompt('debate')` — Conceded/Defended Points, Revised Plan + JSON
- `getDebateDefensePrompt('perspectives')` — Cross-review (review other lens) + JSON

**Synthesis:**
- `getReviewSynthesisPrompt()` — Consensus, Resolved Issues, Remaining Concerns
- `getDebateSynthesisPrompt()` — Consensus Points, Divergences, Convergence Score

---

## Phase 3: 엔진 핵심 로직 (가장 큰 변경)

`src/agent/engine.ts`

**새 인스턴스 변수**
```typescript
private reviewSession: ReviewSessionState | null = null;
private debateSession: DebateSessionState | null = null;
```

**`handleReview()` 재작성 — 멀티 라운드 + 수렴 + 사용자 결정**
1. `reviewSession` 없으면 초기화 (`strategy`, `rounds=[]`, `convergence=null`)
2. 라운드 결정:
   - 홀수 라운드: Reviewer가 CRITIQUE (`overrideModel=reviewerModel`, `prompt=getCritiquePrompt`)
   - 짝수 라운드: Coder가 REBUTTAL (기본 모델, `prompt=getRebuttalPrompt`)
3. 응답을 `rounds[]`에 추가
4. `computeConvergence(rounds)` 실행
5. 분기:
   - converged OR maxIter → Synthesizing
   - stalled → Synthesizing
   - continue → 다음 라운드 (`Reviewing` 유지)

**`handleDebate()` 재작성 — 멀티 라운드 + 수렴 + 사용자 결정**
- **debate 전략:**
  홀수: Critic CHALLENGE, 짝수: Planner DEFENSE
- **perspectives 전략:**
  Round 1: Agent A → Risk lens, Round 2: Agent B → Innovation lens
  Round 3: Cross-review
→ converged/maxIter → Synthesizing

**`handleSynthesis()` 새로 추가**
1. `reviewSession`/`debateSession`의 rounds를 요약
2. `streamWithUI(synthesisPrompt)` 호출
3. 결과를 `session.synthesisResult`에 저장
4. `onSynthesisComplete` 콜백으로 UI에 전달
5. Fallback: 실패 시 라운드 내용 연결
6. 전환: `WaitingForReviewDecision` 또는 `WaitingForDebateDecision`

**`handleWaitingForReviewDecision()` 새로 추가 — Promise 기반 일시정지**
1. `onReviewComplete` 콜백으로 UI에 결과 전달
2. `new Promise<'apply_fix' | 'skip'>` 생성, `resolver`를 context에 저장
3. `await` — 사용자 결정까지 엔진 일시정지
4. `apply_fix`: `step.status='failed'`, `step.result=피드백` → Fixing
5. `skip`: 세션 정리 → Executing

**`handleWaitingForDebateDecision()` 새로 추가**
1. `onDebateComplete` 콜백으로 UI에 결과 전달
2. `await Promise<'revise' | 'accept'>`
3. `revise`: Planning (synthesis 피드백 포함)
4. `accept`: Executing (현재 플랜 유지)

**Public 메서드 추가**
```typescript
resolveReviewDecision(decision: 'apply_fix' | 'skip'): void;
resolveDebateDecision(decision: 'revise' | 'accept'): void;
```

**`run()` switch 확장**
```typescript
case 'WaitingForReviewDecision': await this.handleWaitingForReviewDecision(); break;
case 'WaitingForDebateDecision': await this.handleWaitingForDebateDecision(); break;
case 'Synthesizing': await this.handleSynthesis(); break;
```

**`reset()` 확장**
`reviewSession`, `debateSession` 정리. pending resolver가 있으면 skip/accept로 해제.

---

## Phase 4: ChatPanel 연동

`src/chat/chatPanel.ts`

**새 메시지 핸들러:**
- `reviewAction` → `agentEngine.resolveReviewDecision(message.decision)`
- `debateAction` → `agentEngine.resolveDebateDecision(message.decision)`
- `selectAgentStrategy` → `agentEngine.updateContext({ agentStrategy })`
- `selectPlanStrategy` → `agentEngine.updateContext({ planStrategy })`

**`initAgentEngine` 콜백 추가:**
- `onReviewComplete`: → `postMessage showReviewResults`
- `onDebateComplete`: → `postMessage showDebateResults`
- `onSynthesisComplete`: → `postMessage showSynthesis`
- `agentStrategy: 'review'`, `planStrategy: 'debate'`

---

## Phase 5: WebView UI

`src/chat/webviewContent.ts`

**전략 드롭다운:** Agent 모드 → `review`/`red-team`, Plan 모드 → `debate`/`perspectives`

**리뷰 결과 패널 (operations-panel과 유사):**
```html
<div id="review-results-panel">
  <h4>Review Results</h4>
  <span class="convergence-badge"></span>  <!-- converged: 초록, stalled: 빨강 -->
  <div id="review-rounds-list"></div>       <!-- 라운드별 critique/rebuttal -->
  <div id="review-synthesis"></div>         <!-- synthesis 결과 -->
  <button id="apply-fix-btn">Apply Fix</button>
  <button id="skip-review-btn">Skip & Continue</button>
</div>
```

**비평 결과 패널 (동일 구조):**
```html
<div id="debate-results-panel">
  <h4>Debate Results</h4>
  <span class="debate-convergence-badge"></span>
  <div id="debate-rounds-list"></div>
  <div id="debate-synthesis"></div>
  <button id="revise-plan-btn">Revise Plan</button>
  <button id="accept-plan-btn">Accept as-is</button>
</div>
```

**상태 배지 색상:**
- `Reviewing`: 보라 (#7c3aed)
- `Debating`: 주황 (#d97706)
- `WaitingFor*Decision`: 파랑 (#2563eb) "Awaiting Decision"
- `Synthesizing`: 청록 (#0891b2)

**수렴 정보 표시:**
- 수렴도 점수 (예: "Convergence: 0.82")
- `converged`: 초록 배지
- `stalled`: 빨강 배지

---

## Phase 6: 설정

`package.json` + `src/config/settings.ts`

**2개 추가:**
- `"tokamak.agentStrategy"`: `{ "type": "string", "enum": ["review", "red-team"], "default": "review" }`
- `"tokamak.planStrategy"`: `{ "type": "string", "enum": ["debate", "perspectives"], "default": "debate" }`

**getter/setter:** `getAgentStrategy()`, `setAgentStrategy()`, `getPlanStrategy()`, `setPlanStrategy()`

---

## 상태 머신 다이어그램

**Agent 모드 (코드 리뷰)**
```
Executing → Observing → (cleanSuccess + enabled)
                             ↓
                        Reviewing ←┐
                   (critique/rebuttal 루프)
                             │     │
                    convergence?    │
                   ┌─────┴────┐    │
               converged  continue─┘
                   ↓
              Synthesizing
                   ↓
         WaitingForReviewDecision
              ┌────┴────┐
         Apply Fix    Skip
              ↓          ↓
           Fixing    Executing
```

**Plan 모드 (플랜 비평)**
```
Planning → (enabled)
             ↓
         Debating ←┐
    (challenge/defense 루프)
             │     │
    convergence?   │
   ┌─────┴────┐   │
converged  continue┘
   ↓
Synthesizing
   ↓
WaitingForDebateDecision
   ┌────┴────┐
 Revise   Accept
   ↓         ↓
Planning   Executing
```

---

## 실행 순서

1. `src/agent/types.ts` — 타입 확장 (모든 새 타입)
2. `src/agent/convergence.ts` — 새 파일 (순수 함수)
3. `src/__tests__/convergence.test.ts` — 테스트
4. `src/chat/systemPromptBuilder.ts` — 구조화 프롬프트 (6+2 함수)
5. `src/agent/engine.ts` — 핵심 로직 재작성
6. `src/chat/chatPanel.ts` — 연동
7. `src/chat/webviewContent.ts` — UI
8. `src/config/settings.ts` + `package.json` — 전략 설정
9. `npm run compile` + `npm test`

**수정/추가 파일 (9개)**
- `src/agent/types.ts` (수정)
- `src/agent/convergence.ts` (새 파일)
- `src/__tests__/convergence.test.ts` (새 파일)
- `src/chat/systemPromptBuilder.ts` (수정)
- `src/agent/engine.ts` (수정 — 가장 큼)
- `src/chat/chatPanel.ts` (수정)
- `src/chat/webviewContent.ts` (수정)
- `src/config/settings.ts` (수정)
- `package.json` (수정)

**검증**
1. `npm run compile` — 타입 에러 없음
2. `npm test` — 기존 62개 + convergence 신규 테스트 통과
3. 수동 테스트:
   - 토글 OFF: 기존 동작 100% 유지
   - Review 전략: 멀티 라운드 critique/rebuttal, 수렴 시 조기 종료, synthesis, 사용자 결정
   - Red-Team 전략: challenge/defense, severity 기반 분석
   - Debate 전략: 멀티 라운드, 수렴, synthesis, 사용자 결정
   - Perspectives 전략: Risk/Innovation 렌즈 + cross-review
   - 사용자 "Skip": 수정 없이 다음 step
   - 사용자 "Accept as-is": 플랜 그대로 실행
   - Synthesis fallback: 합성 실패 시 라운드 연결
