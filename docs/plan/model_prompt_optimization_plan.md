# 모델별 프롬프트 최적화

## Context

이전 리팩토링에서 `src/prompts/` 모듈 구조를 만들었지만, 실제로 모든 모델이 동일한 프롬프트를 받고 있다.
Cline은 모델별 12개 variant(gemini-3, glm, trinity, xs 등)를 유지하며, 각각 `overrides.ts`로 프롬프트를 커스터마이즈한다.
우리 프로젝트는 7개 provider로 규모가 작으므로, `PromptHints` 구조체 기반으로 가볍게 구현한다.

Cline의 모델별 최적화 사례 (참고):
- Gemini 3: 병렬 tool calling 지원, 네이티브 도구 포맷, 8개 섹션 커스텀
- GLM: "도구는 assistant 메시지에서만 호출, reasoning 블록 안에서 실행 안됨" + 탐색 우선 접근
- Trinity: 반복 루프 방지, 명시적 follow-up 질문 파라미터
- XS (compact): 소형 모델용 축약 프롬프트

---

## 핵심 설계: PromptHints

`types.ts` 추가
```typescript
export type ContextTier = 'small' | 'medium' | 'large';

export interface PromptHints {
    variant: PromptVariant;
    thinkingBlocks: boolean;       // Qwen, Gemini
    contextTier: ContextTier;      // small(≤65K), medium(66K-200K), large(>200K)
}
```

`PromptHints | PromptVariant` union으로 모든 컴포넌트가 하위 호환 유지.

---

## 모델별 구체적 최적화

### Qwen (thinkingBlocks: true, contextTier: small/medium)

agent system prompt에 추가:
> 6. **Structured thinking**: You can use `<think>...</think>` blocks to reason through complex problems before providing your response.

review/debate JSON verdict에 추가:
> Before outputting the JSON verdict, reason through your analysis step by step inside a `<think>` block. Then output ONLY the JSON.

contextTier: small (Qwen non-235b, 65K):
- 예시 생략, 규칙 축소 (Cline XS 방식)
- FILE_OPERATION 설명 간소화

### Gemini (thinkingBlocks: true, contextTier: large)

Qwen과 동일한 thinking block 지시 + 대형 컨텍스트 활용:

agent 모드에서 추가 예시 (edit/replace):
```typescript
Example (edit):
I'll update the return value.

<<<FILE_OPERATION>>>
TYPE: edit
PATH: src/utils/helper.ts
DESCRIPTION: Change return value
SEARCH:
\`\`\`typescript
  return 'hello';
\`\`\`
REPLACE:
\`\`\`typescript
  return 'world';
\`\`\`
<<<END_OPERATION>>>
```

agent system prompt에 추가:
> 6. **Structured thinking**: (thinking block 지시 — Qwen과 동일)
> 7. **Exploration first**: Begin by reading relevant files to understand the codebase before making changes. Use TYPE: read operations.

### Minimax (contextTier: small, 65K)
- 예시 생략, 규칙 축소
- FILE_OPERATION 포맷 간소화 (현재 compact와 동일 수준)
- JSON 출력 형식에 더 명확한 지시: "Respond with ONLY the JSON, no additional text."

### Claude (contextTier: medium, 200K) / OpenAI (128K) / GLM (131K)
- 현재 standard 프롬프트 유지 (기본값)
- 별도 커스터마이즈 없음

### Generic (contextTier: small, 65K)
- small tier 축약 적용 (Minimax와 동일)

---

## 파일 변경 목록

### 새 파일 (1개)
- `src/prompts/components/_helpers.ts` — `normalizeHints(input: PromptHints | PromptVariant): PromptHints`

### 수정 파일

| 파일 | 변경 |
|---|---|
| `src/prompts/types.ts` | ContextTier, PromptHints 추가, PromptContext.hints? 추가 |
| `src/prompts/variants/resolver.ts` | resolveHints(model) 함수 추가 |
| `src/prompts/index.ts` | 새 타입/함수 export |
| `src/prompts/components/jsonVerdictFormat.ts` | 5개 함수: thinking preamble 추가 |
| `src/prompts/components/rules.ts` | 4개 함수: contextTier 분기 (small→축약, large→상세) |
| `src/prompts/components/fileOperationFormat.ts` | 2개 함수: contextTier 분기 |
| `src/prompts/builders/agentSystemPrompt.ts` | thinking rule + exploration-first (large) |
| `src/prompts/builders/modePromptBuilder.ts` | ctx.hints 활용 |
| `src/prompts/builders/reviewPromptBuilder.ts` | 3개 함수: hints 전달 |
| `src/prompts/builders/debatePromptBuilder.ts` | 3개 함수: hints 전달 |
| `src/chat/chatPanel.ts` | resolveVariant → resolveHints |
| `src/agent/engine.ts` | getHintsForModel() + 모든 호출부 hints 전달 |
| `src/__tests__/promptBuilders.test.ts` | hints 기반 테스트 추가 |

---

## 구현 순서

**Step 1: 타입 + 헬퍼**
1. `types.ts` — ContextTier, PromptHints, PromptContext.hints?
2. `components/_helpers.ts` — normalizeHints()
3. `variants/resolver.ts` — resolveHints()
4. `index.ts` — export 추가
5. `npm run compile`

**Step 2: 컴포넌트 업데이트**
1. `jsonVerdictFormat.ts` — 5개 함수에 thinking preamble
2. `rules.ts` — contextTier 분기 (small→축약, large→상세 + exploration-first)
3. `fileOperationFormat.ts` — contextTier 분기
4. `npm run compile`

**Step 3: 빌더 업데이트**
1. `agentSystemPrompt.ts` — thinking rule, exploration-first
2. `reviewPromptBuilder.ts` + `debatePromptBuilder.ts` — hints 전달
3. `modePromptBuilder.ts` — ctx.hints 활용
4. `npm run compile`

**Step 4: Consumer 전환**
1. `chatPanel.ts` — resolveHints + PromptContext에 hints 전달
2. `engine.ts` — getHintsForModel() + 모든 호출부에 hints
3. `npm run compile`

**Step 5: 테스트**
1. resolveHints 테스트: Qwen→thinking+medium, Gemini→thinking+large, Minimax→small
2. thinking preamble 포함/미포함 검증
3. contextTier 별 프롬프트 길이 비교
4. 하위 호환: 'standard' 문자열 전달 시 동일 동작
5. `npm test`

---

## 검증
1. `npm run compile` — 타입 에러 없음
2. `npm test` — 기존 178개 + 새 테스트 전체 통과
3. 수동: Qwen → agent 모드 → `<think>` 지시 포함 확인
4. 수동: Gemini → agent 모드 → 추가 예시 포함 확인
5. 수동: multi-model review → 각 모델별 hints 적용 확인
