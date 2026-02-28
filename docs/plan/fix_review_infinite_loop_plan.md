# Fix: 리뷰 무한 루프 & Convergence 임계값 조정

## Context

"Apply Fix" 클릭 시 리뷰가 끝없이 반복되는 버그. 두 가지 원인:

1. **Apply Fix → 새 리뷰 루프**: "Apply Fix" → fixPrompt 주입 → AI가 새 FILE_OPERATION 생성 → "Apply Changes" → `startReviewForOperations()` 호출 → 또 리뷰 시작 → 무한 반복
2. **Convergence 임계값 과도**: converged 조건(agreement ≥ 0.6 AND stability ≥ 0.7)이 너무 엄격하고, stalled 조건(rounds ≥ 4)은 maxReviewIterations=3일 때 도달 불가

---

## 수정 1: Apply Fix → 리뷰 재시작 방지

파일: `src/chat/chatPanel.ts`

**문제 흐름**:
"Apply Fix" 클릭 (line 314)
  → `resolveReviewDecision('skip')` + `handleUserMessage(fixPrompt)`
  → AI가 수정 FILE_OPERATION 생성
  → 사용자 "Apply Changes" 클릭 (line 1247)
  → `startReviewForOperations()` — 새 리뷰 시작 ← 무한 루프 원인

**수정**:
- `skipNextReview: boolean` 필드 추가 (line ~39, 기존 private 필드 옆)
- `reviewAction` 핸들러 (line 314): 'apply_fix'일 때 `this.skipNextReview = true`
- "Apply Changes" 핸들러 (line 1247): `skipNextReview`가 true이면 `startReviewForOperations()` 건너뛰고 플래그 리셋

---

## 수정 2: Convergence 임계값 완화

파일: `src/agent/convergence.ts` (line 92-97)

**현재 (너무 엄격)**:
- converged: agreementRatio >= 0.6 AND avgStability >= 0.7
- stalled: rounds >= 4 AND avgStability < 0.3

**수정**:
- converged: agreementRatio >= 0.55 AND avgStability >= 0.5 (완화)
- converged 추가: OR avgStability >= 0.8 (같은 말 반복 = 진전 없음 → 종료)
- stalled: rounds >= 3 (maxReviewIterations=3과 정합, 기존 4에서 하향)

---

## 수정 3: maxIterations 초과 시 convergence 기록

파일: `src/agent/engine.ts` (line 661-664)

maxIter 초과 시 `reviewSession.convergence`가 null인 채로 `Synthesizing` 전환됨. convergence 정보를 계산하고 'stalled'로 기록한 뒤 전환.

---

## 수정 4: 테스트 업데이트

파일: `src/__tests__/convergence.test.ts`

- line 114-116: converged 임계값 assert → 새 값(0.55/0.5)으로 업데이트
- line 119-129: stalled 테스트 → rounds 3개로 변경
- 추가: stability ≥ 0.8 시 converged 테스트

---

## 수정 파일 요약 (4개)

| 파일 | 변경 내용 |
|---|---|
| `src/chat/chatPanel.ts` | skipNextReview 플래그 추가, 2곳 수정 |
| `src/agent/convergence.ts` | 임계값 3곳 변경 |
| `src/agent/engine.ts` | maxIter 초과 시 convergence 기록 (4줄 추가) |
| `src/__tests__/convergence.test.ts` | 테스트 케이스 업데이트 + 추가 |

## 검증

1. `npm run compile` — 타입 에러 없음
2. `npm test` — 기존 + 수정된 convergence 테스트 통과
3. 수동 검증: F5 → agent 모드 → "Apply Fix" 클릭 → 리뷰 재시작되지 않음 확인
