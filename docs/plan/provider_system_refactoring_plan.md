# Provider 시스템 — 모델별 Provider 분리

## Context

현재 `src/api/client.ts`에 모든 모델 로직이 혼재되어 있음:
- vision 판별: `isVisionCapable()` 안에 모든 모델 패턴 하드코딩
- stream_options 판별: `supportsStreamOptions()` 별도 함수
- minimax tool_calls→XML 변환: `streamChatCompletion()` 안에 인라인
- 이미지 제거: `stripImagesForNonVisionModel()` 별도 함수

문제: 모델 추가마다 if/else 증가, 모델별 특성(토큰한도, thinking블록 등) 관리 불가

목표: Cline처럼 모델별 Provider 클래스 분리. 같은 LiteLLM/OpenAI API 사용하되 코드 구조만 개선.

---

## 파일 구조

```
src/api/
  client.ts                    # 수정 — thin facade (기존 export 유지)
  types.ts                     # 신규 — 공유 타입 추출
  providers/
    index.ts                   # 신규 — barrel re-export
    IProvider.ts               # 신규 — Provider 인터페이스
    BaseProvider.ts            # 신규 — 공통 OpenAI API 호출 로직
    QwenProvider.ts            # 신규 — qwen3-235b, qwen3-80b-next, qwen3-coder-flash
    MinimaxProvider.ts         # 신규 — minimax-m2.5 (tool_calls→XML)
    GlmProvider.ts             # 신규 — glm-4.7, glm-4v
    OpenAIProvider.ts          # 신규 — gpt-4o, gpt-4-turbo, o1, o3
    ClaudeProvider.ts          # 신규 — claude-3+
    GeminiProvider.ts          # 신규 — gemini
    GenericProvider.ts         # 신규 — 알 수 없는 모델 fallback
    ProviderRegistry.ts        # 신규 — model name → provider 매핑
```

---

## Phase 1: 타입 추출 — src/api/types.ts

`client.ts`에서 공유 타입 추출 (순환 의존 방지):

```typescript
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | any[];
}
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}
export interface StreamResult {
    content: AsyncGenerator<string, void, unknown>;
    usage: Promise<TokenUsage | null>;
}
export interface ProviderRequestOptions {
    abortSignal?: AbortSignal;
    temperature?: number;
    maxTokens?: number;
}
```

---

## Phase 2: Provider 인터페이스 — src/api/providers/IProvider.ts

```typescript
export interface ModelCapabilities {
    vision: boolean;           // 이미지 첨부 지원
    streamUsage: boolean;      // stream_options.include_usage 지원
    toolCallsToXml: boolean;   // tool_calls→XML 변환 필요 (minimax)
    thinkingBlocks: boolean;   // <think> 블록 방출 (qwen3, gemini)
    contextWindow: number;     // 최대 컨텍스트 토큰
}

export interface ModelDefaults {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
}

export interface IProvider {
    readonly id: string;
    readonly name: string;
    canHandle(model: string): boolean;
    getCapabilities(model: string): ModelCapabilities;
    getDefaults(model: string): ModelDefaults;
    streamChat(model, messages, options?): StreamResult;
    chat(model, messages, options?): Promise<string>;
    codeComplete(model, prefix, suffix, language): Promise<string>;
    preprocessMessages(model, messages): ChatMessage[];
}
```

---

## Phase 3: BaseProvider — src/api/providers/BaseProvider.ts

`client.ts`에서 공통 로직 이동:
- `getClient()`, `resetClient()` — OpenAI 인스턴스 관리
- `withRetry()` — 재시도 로직
- `stripImages()` — 비-vision 모델 이미지 제거
- `streamChat()` — 기본 스트리밍 (모든 Provider 공통)
- `chat()` — 기본 비스트리밍
- `codeComplete()` — 코드 완성
- `processStream()` — protected, MinimaxProvider가 override

```typescript
export abstract class BaseProvider implements IProvider {
    // 공통 구현: streamChat, chat, codeComplete, preprocessMessages
    // 서브클래스 override: canHandle, getCapabilities, getDefaults
    // MinimaxProvider만 override: processStream (tool_calls→XML)
}
```

---

## Phase 4: 모델별 Provider (7개)

**QwenProvider**
- canHandle: `model.startsWith('qwen')`
- vision: `qwen.*vl` 패턴만 true
- thinkingBlocks: true (qwen3는 `<think>` 방출)
- contextWindow: 235b→131072, 기타→65536

**MinimaxProvider**
- canHandle: `model.startsWith('minimax')`
- toolCallsToXml: true
- `processStream()` override: tool_calls 축적 → XML 변환 (현재 client.ts의 인라인 로직)

**GlmProvider**
- canHandle: `model.startsWith('glm')`
- vision: glm-4v만 true (glm-4.7은 false)

**OpenAIProvider**
- canHandle: `gpt-` 또는 `o1` 또는 `o3`
- streamUsage: true (유일하게 stream_options 지원)
- vision: gpt-4o, gpt-4-turbo, gpt-4-vision

**ClaudeProvider**
- canHandle: `model.startsWith('claude')`
- vision: claude-3+ true
- contextWindow: 200000

**GeminiProvider**
- canHandle: `model.startsWith('gemini')`
- vision: true (멀티모달 기본 지원)
- thinkingBlocks: true (gemini 2.5)
- contextWindow: 1000000

**GenericProvider (fallback)**
- canHandle: 항상 true — 다른 Provider가 안 잡으면 여기로
- vision: 모델명에 vision/visual/vl 포함 시 true

---

## Phase 5: ProviderRegistry — src/api/providers/ProviderRegistry.ts

```typescript
export class ProviderRegistry {
    private providers: IProvider[] = [];
    private cache = new Map<string, IProvider>();

    constructor() {
        // 순서 중요: 구체적인 것 먼저, GenericProvider 마지막
        this.register(new QwenProvider());
        this.register(new MinimaxProvider());
        this.register(new GlmProvider());
        this.register(new OpenAIProvider());
        this.register(new ClaudeProvider());
        this.register(new GeminiProvider());
        this.register(new GenericProvider());
    }

    resolve(model: string): IProvider {
        // 캐시 확인 → providers 순회 → canHandle() 매칭 → 캐시 저장
    }
}

export function getRegistry(): ProviderRegistry;  // 싱글턴
export function resetRegistry(): void;             // 테스트용
```

---

## Phase 6: client.ts → thin facade

기존 export 100% 유지 (`ChatMessage`, `TokenUsage`, `StreamResult`, `streamChatCompletion`, `chatCompletion`, `codeCompletion`, `isVisionCapable`, `getClient`, `resetClient`)

```typescript
// 타입은 types.ts에서 re-export
export type { ChatMessage, TokenUsage, StreamResult } from './types.js';
export { getClient, resetClient } from './providers/BaseProvider.js';

export function isVisionCapable(model: string): boolean {
    return getRegistry().resolve(model).getCapabilities(model).vision;
}

export function streamChatCompletion(messages, abortSignal?, overrideModel?): StreamResult {
    const model = overrideModel || getSettings().selectedModel;
    return getRegistry().resolve(model).streamChat(model, messages, { abortSignal });
}

export async function chatCompletion(messages): Promise<string> { /* 동일 패턴 */ }
export async function codeCompletion(prefix, suffix, language): Promise<string> { /* 동일 패턴 */ }
```

**기존 caller 영향: 없음**

| 파일 | import | 변경 |
|---|---|---|
| `chatPanel.ts` | streamChatCompletion, ChatMessage, isVisionCapable | 없음 |
| `chatViewProvider.ts` | streamChatCompletion, ChatMessage | 없음 |
| `engine.ts` | streamChatCompletion, ChatMessage | 없음 |
| `summarizer.ts` | streamChatCompletion | 없음 |
| `engine-review.test.ts` | `vi.mock('../api/client.js')` | 없음 |

---

## Phase 7: 테스트

`src/__tests__/providerRegistry.test.ts`
- resolve('qwen3-235b') → QwenProvider
- resolve('minimax-m2.5') → MinimaxProvider
- resolve('glm-4.7') → GlmProvider
- resolve('gpt-4o') → OpenAIProvider
- resolve('claude-3.5-sonnet') → ClaudeProvider
- resolve('gemini-2.5-pro') → GeminiProvider
- resolve('unknown-xyz') → GenericProvider
- 캐시 동작 검증

`src/__tests__/providerCapabilities.test.ts`
- QwenProvider: vision=false (qwen3-235b), vision=true (qwen-vl-plus), thinkingBlocks=true
- MinimaxProvider: toolCallsToXml=true, vision=false
- GlmProvider: vision=false (glm-4.7), vision=true (glm-4v)
- OpenAIProvider: streamUsage=true, vision=true (gpt-4o)
- GenericProvider: canHandle=always true

`src/__tests__/isVisionCapable.test.ts` (회귀 테스트)
- 기존 `isVisionCapable` 함수가 Provider 기반으로 변경 후에도 동일 결과

---

## 실행 순서

1. `src/api/types.ts` — 타입 추출
2. `src/api/providers/IProvider.ts` — 인터페이스
3. `src/api/providers/BaseProvider.ts` — 공통 로직 (`client.ts`에서 이동)
4. 7개 Provider 파일 (Qwen, Minimax, Glm, OpenAI, Claude, Gemini, Generic)
5. `src/api/providers/ProviderRegistry.ts` — 레지스트리
6. `src/api/providers/index.ts` — barrel export
7. `src/api/client.ts` — facade로 교체
8. 테스트 파일 3개
9. `npm run compile` + `npm test`

**수정/추가 파일 (13개)**
- `src/api/types.ts` (신규)
- `src/api/providers/IProvider.ts` (신규)
- `src/api/providers/BaseProvider.ts` (신규)
- `src/api/providers/QwenProvider.ts` (신규)
- `src/api/providers/MinimaxProvider.ts` (신규)
- `src/api/providers/GlmProvider.ts` (신규)
- `src/api/providers/OpenAIProvider.ts` (신규)
- `src/api/providers/ClaudeProvider.ts` (신규)
- `src/api/providers/GeminiProvider.ts` (신규)
- `src/api/providers/GenericProvider.ts` (신규)
- `src/api/providers/ProviderRegistry.ts` (신규)
- `src/api/providers/index.ts` (신규)
- `src/api/client.ts` (수정 — facade로 교체)
- `src/__tests__/providerRegistry.test.ts` (신규)
- `src/__tests__/providerCapabilities.test.ts` (신규)

**검증**
1. `npm run compile` — 타입 에러 없음
2. `npm test` — 기존 95개 + 신규 테스트 통과
3. 기존 caller 코드 변경 없음 확인
4. F5 실행 → 채팅/에이전트 모드 정상 동작 (기능적 변화 없음)
