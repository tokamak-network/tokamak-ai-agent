# P3 수정 사항 + Vision 모델 호환성 수정

> 작성일: 2026-02-25

---

## 버그 수정: Vision 미지원 모델에서 스크린샷 첨부 시 오류

### 원인

`qwen3-235b`, `minimax-m2.5`, `glm-4.7` 모델들은 vision(이미지 입력) API를 지원하지 않음.
스크린샷을 붙여넣으면 `image_url` 타입의 content part가 생성되어 API로 전송되고, 모델이 이를 거부하여 오류 발생.

추가로 `stream_options: { include_usage: true }` 옵션도 비-OpenAI 엔드포인트에서 400 오류를 발생시킬 수 있었음.

### 수정 내용 — `src/api/client.ts`

#### 1. `isVisionCapable(model)` — 모델 vision 지원 여부 판별

```typescript
export function isVisionCapable(model: string): boolean {
    const m = model.toLowerCase();
    return (
        m.startsWith('gpt-4o') ||
        m === 'gpt-4-turbo' ||
        /^claude-3/.test(m) ||
        /qwen.*vl/i.test(m) ||
        /glm-4v/i.test(m) ||   // glm-4.7은 미지원, glm-4v만 지원
        /\bvision\b|\bvisual\b|\bvl\b/.test(m)
    );
}
```

| 모델 | Vision 지원 |
|------|-------------|
| `qwen3-235b` | ❌ 미지원 |
| `minimax-m2.5` | ❌ 미지원 |
| `glm-4.7` | ❌ 미지원 (숫자만, V 없음) |
| `glm-4v` | ✅ 지원 |
| `qwen-vl-max` | ✅ 지원 |
| `gpt-4o` | ✅ 지원 |

#### 2. `stripImagesForNonVisionModel(messages)` — 이미지 자동 제거

vision 미지원 모델에게 메시지를 보낼 때 `image_url` 파트를 제거하고 안내 텍스트로 대체:

```
[2개의 이미지가 첨부되었지만 현재 모델(qwen3-235b)은 vision을 지원하지 않습니다. 이미지는 전송되지 않았습니다.]
```

#### 3. `supportsStreamOptions(model)` — stream_options 조건부 적용

```typescript
function supportsStreamOptions(model: string): boolean {
    return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
}

// streamChatCompletion 내부에서:
const extraOptions = supportsStreamOptions(settings.selectedModel)
    ? { stream_options: { include_usage: true } }
    : {};
```

### 수정 내용 — `src/chat/chatPanel.ts`

이미지 첨부 시 UI에 vision 지원 여부를 표시:

```
// Vision 지원 모델
🖼️ 2개 이미지 첨부됨

// Vision 미지원 모델
⚠️ 2개 이미지 첨부됨 — qwen3-235b 모델은 vision을 지원하지 않습니다. 이미지는 전송되지 않습니다.
```

---

## P3-1: API 재시도 로직 (Exponential Backoff)

**파일**: `src/api/client.ts`

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T>
```

| 재시도 조건 | 재시도 안 함 |
|------------|-------------|
| HTTP 429 (Rate Limit) | AbortError (사용자 취소) |
| HTTP 500/502/503/504 | 401 (인증 오류) |
| ECONNRESET, ETIMEDOUT | 400 (Bad Request) |

대기 시간: 1초 → 2초 → 4초 (Exponential backoff)

`chatCompletion`, `streamChatCompletion`, `codeCompletion` 세 함수 모두 적용.

---

## P3-3: 토큰 예산 강제 적용

**파일**: `src/agent/contextManager.ts`, `src/agent/engine.ts`

`assembleContext()` 시그니처 변경:

```typescript
// Before: 하드코딩된 12000 토큰 상한
public async assembleContext(files: FileMetadata[]): Promise<string>

// After: AgentContext.tokenBudget을 런타임에 적용
public async assembleContext(files: FileMetadata[], tokenBudget?: number): Promise<string>
```

engine.ts에서 호출 시:

```typescript
await this.contextManager.assembleContext(relevantFiles, this.context.tokenBudget)
```

예산 초과 시 로그:
```
[WARN] [ContextManager] Token budget exhausted (11800/12000), skipping: src/chat/chatPanel.ts
[INFO] [ContextManager] Context assembled: ~11800 tokens (budget: 12000)
```

---

## P3-4: Agent System Prompt 추가

**파일**: `src/agent/engine.ts`

에이전트가 AI에게 보내는 모든 요청에 System Prompt 자동 prepend:

```
You are an expert AI coding agent integrated into a VS Code extension...

## Core Rules
1. SEARCH/REPLACE format: 기존 파일 수정 시 항상 SEARCH/REPLACE 형식 사용
2. Minimal changes: 필요한 부분만 수정
3. Correctness first: import, 타입 정확성 확인
4. JSON output: 액션은 순수 JSON만 출력
5. Language: 사용자 언어로 응답
```

`streamWithUI()` 내부에서 자동 적용:

```typescript
private static readonly SYSTEM_PROMPT = `...`;

private async streamWithUI(messages: ChatMessage[]): Promise<string> {
    const systemMessage = { role: 'system', content: AgentEngine.SYSTEM_PROMPT };
    const fullMessages = [systemMessage, ...messages];
    // ...
}
```

---

## 변경된 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `src/api/client.ts` | isVisionCapable, stripImagesForNonVisionModel, supportsStreamOptions, withRetry |
| `src/chat/chatPanel.ts` | isVisionCapable import, 이미지 첨부 경고 UI |
| `src/agent/contextManager.ts` | tokenBudget 파라미터 추가, 로그 개선 |
| `src/agent/engine.ts` | SYSTEM_PROMPT 상수, streamWithUI에 system 메시지 prepend, tokenBudget 전달 |

컴파일 결과: `npx tsc --noEmit` → 오류 0개
