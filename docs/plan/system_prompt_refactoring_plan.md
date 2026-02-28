# 시스템 프롬프트 모듈화 리팩토링

## Context

현재 `src/chat/systemPromptBuilder.ts` 하나에 9개 함수, 390줄의 프롬프트가 모놀리식으로 들어있다.
모든 모델에 동일한 프롬프트를 보내며, FILE_OPERATION 포맷과 JSON verdict 포맷이 여러 함수에 중복된다.
Cline 스타일의 모듈식 아키텍처로 리팩토링하되, 프로젝트 규모에 맞게 간결하게 유지한다.

---

## 최종 구조

```
src/prompts/                            # NEW (기존 systemPromptBuilder.ts 대체)
├── types.ts                            # PromptVariant, PromptContext, ChatMode 등
├── components/                         # 재사용 가능한 프롬프트 조각
│   ├── fileOperationFormat.ts          # FILE_OPERATION 블록 (ask: read-only, agent: full)
│   ├── jsonVerdictFormat.ts            # review/debate JSON 포맷 (중복 제거)
│   └── rules.ts                        # 일반 규칙, agent 규칙, plan 출력 형식
├── variants/                           # 모델별 프롬프트 변형
│   ├── resolver.ts                     # resolveVariant(model) — ProviderRegistry 활용
│   ├── standard.ts                     # 기본 variant (export: overrides 객체)
│   └── compact.ts                      # 소형 모델 variant (짧은 프롬프트)
├── builders/                           # 프롬프트 조립 함수 (public API)
│   ├── modePromptBuilder.ts            # buildModePrompt() — ask/plan/agent
│   ├── reviewPromptBuilder.ts          # buildReviewCritique/Rebuttal/Synthesis()
│   ├── debatePromptBuilder.ts          # buildDebateChallenge/Defense/Synthesis()
│   └── agentSystemPrompt.ts            # buildAgentEngineSystemPrompt() — engine.ts SYSTEM_PROMPT 추출
└── index.ts                            # barrel export
```

총 12개 파일 — 기존 1파일(390줄)을 역할별로 분리

---

## 핵심 타입 (src/prompts/types.ts)

```typescript
export type PromptVariant = 'standard' | 'compact';
export type ChatMode = 'ask' | 'plan' | 'agent';
export type ReviewStrategy = 'review' | 'red-team';
export type DebateStrategy = 'debate' | 'perspectives';

export interface PromptContext {
    workspaceInfo: string;
    projectStructure: string;
    projectKnowledge: string;
    variant: PromptVariant;
}
```

---

## Variant 해석 (src/prompts/variants/resolver.ts)

```typescript
import { getRegistry } from '../../api/providers/ProviderRegistry.js';

const COMPACT_THRESHOLD = 32768; // contextWindow 기준

export function resolveVariant(model: string): PromptVariant {
    const provider = getRegistry().resolve(model);
    const caps = provider.getCapabilities(model);
    return caps.contextWindow < COMPACT_THRESHOLD ? 'compact' : 'standard';
}
```
기존 ProviderRegistry를 그대로 활용 — 모델 감지 로직 중복 없음.

---

## 컴포넌트 설계

**`components/fileOperationFormat.ts`**
- `getFileOpReadFormat(variant)` — ask/plan 모드용 (TYPE: read만)
- `getFileOpFullFormat(variant)` — agent 모드용 (create/edit/replace/delete/read/write_full/prepend/append)
- compact variant: 예시 축소, 한국어 설명 생략

**`components/jsonVerdictFormat.ts`**
- `getReviewVerdictFormat(variant)` — `{ verdict: PASS|NEEDS_FIX, summary, issues[] }`
- `getDebateVerdictFormat(variant)` — `{ verdict: APPROVE|CHALLENGE, concerns[], suggestions[] }`
- `getExtendedReviewVerdictFormat(variant)` — pointsOfAgreement, missingConsiderations 등 포함
- 현재 5개 함수에 중복된 JSON 포맷을 하나로 통합

**`components/rules.ts`**
- `getGeneralRules(variant)` — 공통 규칙 (파일 읽기, 간결함)
- `getAgentRules(variant)` — agent 전용 (ONE block per file 등)
- `getPlanOutputFormat(variant)` — plan 모드 출력 형식

---

## Builder 함수 (Public API)

**`builders/modePromptBuilder.ts`**
```typescript
export function buildModePrompt(mode: ChatMode, ctx: PromptContext): string
```
기존 `getSystemPromptForMode()` 대체. 컴포넌트를 조합하여 mode별 시스템 프롬프트 생성.

**`builders/reviewPromptBuilder.ts`**
```typescript
export function buildReviewCritiquePrompt(strategy: ReviewStrategy, variant?: PromptVariant): string
export function buildReviewRebuttalPrompt(strategy: ReviewStrategy, variant?: PromptVariant): string
export function buildReviewSynthesisPrompt(variant?: PromptVariant): string
```
기존 `getReviewCritiquePrompt()` 등 3개 함수 대체. JSON verdict는 컴포넌트에서 가져옴.

**`builders/debatePromptBuilder.ts`**
```typescript
export function buildDebateChallengePrompt(strategy: DebateStrategy, variant?: PromptVariant): string
export function buildDebateDefensePrompt(strategy: DebateStrategy, variant?: PromptVariant): string
export function buildDebateSynthesisPrompt(variant?: PromptVariant): string
```

**`builders/agentSystemPrompt.ts`**
```typescript
export function buildAgentEngineSystemPrompt(variant?: PromptVariant): string
```
기존 `AgentEngine.SYSTEM_PROMPT` 정적 필드(line 1119-1143) 추출.

---

## Consumer 변경

**`src/chat/chatPanel.ts` (1곳)**
```typescript
// Before
import { ChatMode, getSystemPromptForMode } from './systemPromptBuilder.js';
content: getSystemPromptForMode(this.currentMode, workspaceInfo, projectStructure, projectKnowledge)

// After
import { ChatMode, buildModePrompt, resolveVariant, PromptContext } from '../prompts/index.js';
const variant = resolveVariant(getSelectedModel());
const ctx: PromptContext = { workspaceInfo, projectStructure, projectKnowledge, variant };
content: buildModePrompt(this.currentMode, ctx)
```

**`src/agent/engine.ts` (~8곳)**
```typescript
// Before
import { getReviewerSystemPrompt, getCriticSystemPrompt, // ← dead imports 제거
    getReviewCritiquePrompt, getReviewRebuttalPrompt, ... } from '../chat/systemPromptBuilder.js';
private static readonly SYSTEM_PROMPT = `...25줄 하드코딩...`;

// After
import { buildReviewCritiquePrompt, buildReviewRebuttalPrompt,
    buildDebateChallengePrompt, buildDebateDefensePrompt,
    buildReviewSynthesisPrompt, buildDebateSynthesisPrompt,
    buildAgentEngineSystemPrompt, resolveVariant } from '../prompts/index.js';

// SYSTEM_PROMPT 정적 필드 제거 → 메서드로 교체
private getSystemPrompt(): string {
    const model = this.context.reviewerModel || getSelectedModel();
    return buildAgentEngineSystemPrompt(resolveVariant(model));
}

// streamWithUI line 1160:
const systemContent = overrideSystemPrompt ?? this.getSystemPrompt();
```

---

## 구현 순서

### Phase 1: 새 모듈 생성 (consumer 변경 없음)
1. `src/prompts/types.ts` 생성
2. `src/prompts/components/` 3개 파일 — 기존 `systemPromptBuilder.ts`에서 텍스트 추출
3. `src/prompts/variants/resolver.ts` + `standard.ts` + `compact.ts`
4. `src/prompts/builders/` 4개 파일 — 컴포넌트 조합 로직
5. `src/prompts/index.ts` barrel
6. `npm run compile` 확인

### Phase 2: 테스트
1. `src/__tests__/promptBuilders.test.ts` 생성
   - `buildModePrompt('agent', ctx)` → `FILE_OPERATION` 포함 확인
   - `buildReviewCritiquePrompt('red-team')` → `Security Risks` 포함 확인
   - compact variant → standard보다 짧은 출력 확인
   - `resolveVariant('qwen3-235b')` → 'standard' 확인
   - resolveVariant 소형 모델 → 'compact' 확인

### Phase 3: Consumer 전환
1. `chatPanel.ts` import 변경 + 호출 수정 (1곳)
2. `engine.ts` import 변경 + 호출 수정 (~8곳) + `SYSTEM_PROMPT` 정적 필드 제거
3. `npm run compile` + `npm test`

### Phase 4: 정리
1. `src/chat/systemPromptBuilder.ts` 삭제
2. dead import (`getReviewerSystemPrompt`, `getCriticSystemPrompt`) 정리 확인
3. 최종 `npm run compile` + `npm test`

---

## 설계 판단

| 결정 | 이유 |
|---|---|
| {{PLACEHOLDER}} 템플릿 엔진 미사용 | 프롬프트가 조건부 분기(strategy, mode, variant)가 많아 함수 합성이 더 직관적. 규모상 불필요 |
| PromptRegistry 싱글턴 미사용 | Cline은 11개 variant에 필요. 우리는 2개 variant라 plain function으로 충분 |
| async 컴포넌트 미사용 | 모든 프롬프트 데이터가 동기적 문자열. caller가 이미 context를 resolve한 후 전달 |
| variant 파라미터 기본값 'standard' | engine.ts 호출부에서 variant 미전달 시 standard로 동작 → 점진적 마이그레이션 가능 |
| AgentEngine.SYSTEM_PROMPT 추출 | 4번째 시스템 프롬프트인데 1400줄 클래스 안에 숨어있음 → 프롬프트 모듈에 통합 |

---

## 검증

1. `npm run compile` — 타입 에러 없음
2. `npm test` — 기존 테스트 + 새 promptBuilders 테스트 통과
3. 수동: F5 → ask/plan/agent 모드 전환 → 프롬프트 동작 동일 확인
4. 수동: multi-model review → critique/rebuttal/synthesis 프롬프트 정상 확인
