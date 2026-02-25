# Tokamak Agent — 개선 작업 요약

> 작성일: 2026-02-25

---

## 개요

tokamak-agent의 코드 수정 오류 원인을 Cline 소스와 비교 분석하여, 치명적 버그부터 구조적 품질 개선까지 3단계(P0 → P1 → P2)에 걸쳐 수정했습니다.

---

## P0 — 치명적 버그 수정 (Critical Fixes)

### 1. `contextManager.ts` — Template Literal 이스케이프 버그 (완전히 망가진 AI 컨텍스트)

**파일**: `src/agent/contextManager.ts`

```typescript
// Before (버그): AI에게 리터럴 문자열 "${file.path}"가 전달됨
contextParts.push(`--- FILE: \${file.path} ---\n\${content}\n`);

// After (수정): 실제 파일 경로와 내용이 전달됨
contextParts.push(`--- FILE: ${file.path} ---\n${content}\n`);
```

**영향**: AI는 항상 `${file.path}`, `${content}` 같은 리터럴 텍스트를 받았으므로 컨텍스트 기반 코드 생성이 완전히 불가능했음. 근본 원인이 되는 버그.

---

### 2. `planner.ts` — Step ID Template Literal 이스케이프 버그 (의존성 추적 완전 불능)

**파일**: `src/agent/planner.ts`

```typescript
// Before (버그): 모든 step ID가 리터럴 "step-${steps.length}"
let id = `step-\${steps.length}`;

// After (수정): "step-0", "step-1", ... 정상 생성
let id = `step-${steps.length}`;
```

**영향**: 모든 플랜 스텝의 ID가 동일한 리터럴 문자열이 되어, `dependsOn` 기반 순서 제어가 전혀 동작하지 않았음.

---

### 3. `client.ts` — 중복 토큰 제거 버그 (스트리밍 출력 손상)

**파일**: `src/api/client.ts`

```typescript
// Before (버그): 동일한 연속 토큰을 모두 드롭
if (content === lastChunk) continue; // "==", "  ", "//" 등 드롭됨

// After (수정): 중복 체크 로직 완전 제거
// yield content; — 그냥 모든 토큰을 전달
```

**영향**: `==`, `//`, 들여쓰기 공백 등 연속으로 등장하는 정상 토큰이 드롭되어 생성된 코드가 문법 오류를 포함했음.

---

### 4. `planner.ts` — replan() 스트림 순회 버그 (replan 완전 불능)

**파일**: `src/agent/planner.ts`

```typescript
// Before (버그): StreamResult 객체를 직접 순회 (비동기 이터러블 아님)
for await (const chunk of stream) { ... }

// After (수정): .content 제너레이터를 순회
for await (const chunk of streamResult.content) { ... }
```

**영향**: `replan()` 호출 시 아무 내용도 수집되지 않아 재계획이 항상 빈 텍스트로 처리됨.

---

### 5. `executor.ts` — SEARCH/REPLACE 단순 문자열 매칭 (핵심 기능 취약)

**파일**: `src/agent/executor.ts`

기존의 단순 `String.includes()` 기반 매칭을 **Cline의 4-tier 매칭 알고리즘**으로 교체.

| Tier | 방법 | 설명 |
|------|------|------|
| 1 | Exact match | 완전 일치 |
| 2 | Line-trimmed match | 각 줄의 앞뒤 공백 무시 |
| 3 | Block anchor match | 첫/마지막 줄을 앵커로 사용 (3줄 이상) |
| 4 | Full-file search | 파일 전체에서 역순 검색 (out-of-order 블록 처리) |

**영향**: LLM이 출력하는 SEARCH 블록의 공백/들여쓰기가 원본과 조금만 달라도 매칭 실패. 4-tier fallback으로 대부분의 변형을 수용.

---

### 6. `engine.ts` — JSON 파싱 실패 (중첩 JSON / 문자열 내 `{}` 처리)

**파일**: `src/agent/engine.ts`

```typescript
// Before (버그): 문자열 내 {}나 중첩 JSON에서 오작동
const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);

// After (수정): 브래킷 깊이 추적으로 정확한 JSON 추출
function extractJsonFromText(text: string): string | null {
    // depth 카운터 + 문자열 내부 {} 무시
}
```

**영향**: AI가 JSON 안에 코드 예시를 포함하면 파싱 실패.

---

### 7. `searcher.ts` — RegExp Injection 취약점

**파일**: `src/agent/searcher.ts`

```typescript
// Before (취약): 사용자 입력이 정규식에 그대로 삽입
new RegExp(`\\b${keyword}\\b`, 'i');

// After (수정): 특수문자 이스케이프 처리
const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
new RegExp(`\\b${escapedKeyword}\\b`, 'i');
```

---

## P1 — 안정성 개선 (Stability Improvements)

### 1. `executor.ts` — AsyncMutex (동시 파일 쓰기 직렬화)

```typescript
class AsyncMutex {
    acquire(): Promise<() => void> { ... }
    private release(): void { ... }
}

// 사용: 뮤텍스 없이는 동시 쓰기 시 파일 손상 가능
const release = await this.writeMutex.acquire();
try { /* 파일 쓰기 */ } finally { release(); }
```

### 2. `executor.ts` — HTML Entity 복원 (Qwen/GLM/MiniMax 모델 대응)

```typescript
function unescapeHtmlEntities(content, filePath) {
    if (/\.(html?|xml|svg)$/i.test(filePath)) return content;
    return content
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&') // ...
}
```

비-Claude 모델들이 코드에 HTML entity를 출력하는 문제 수정. HTML/XML 파일은 제외.

### 3. `engine.ts` — streamWithUI() 헬퍼 (스트리밍 UI 통합)

```typescript
private async streamWithUI(messages: ChatMessage[]): Promise<string> {
    if (this.context.onStreamStart) this.context.onStreamStart();
    let aiResponse = '';
    for await (const chunk of streamChatCompletion(messages).content) {
        aiResponse += chunk;
        if (this.context.onStreamChunk) this.context.onStreamChunk(chunk);
    }
    if (this.context.onStreamEnd) this.context.onStreamEnd();
    return aiResponse;
}
```

Planning/Executing/Reflecting/Fixing 4개 단계 모두 동일한 헬퍼 사용. WebView에 실시간 스트리밍 표시.

### 4. `engine.ts` — consecutiveMistakeCount (연속 실패 추적)

Cline의 패턴을 적용. 3회 이상 연속 실패 시 AI에게 "다른 방법을 시도하라"는 경고 메시지 강도를 높임.

### 5. `types.ts` — 스트리밍 콜백 인터페이스 추가

```typescript
export interface AgentContext {
    onStreamStart?: () => void;
    onStreamChunk?: (chunk: string) => void;
    onStreamEnd?: () => void;
}
```

### 6. `chatPanel.ts` — 에이전트 스트리밍 콜백 연결

```typescript
onStreamStart: () => this.panel.webview.postMessage({ command: 'startStreaming' }),
onStreamChunk: (chunk) => this.panel.webview.postMessage({ command: 'streamChunk', content: chunk }),
onStreamEnd: () => this.panel.webview.postMessage({ command: 'endStreaming' }),
```

---

## P2 — 코드 품질 개선 (Code Quality)

### 1. `src/utils/contentUtils.ts` (신규 파일)

executor.ts와 chatPanel.ts에서 완전히 동일하게 중복되어 있던 4개 함수를 공유 모듈로 추출:

| 함수 | 역할 |
|------|------|
| `removeAutoExecutionCode(content, filePath)` | `run()`, `main()`, `if __name__` 등 자동 실행 코드 제거 |
| `removeTrailingBackticks(content)` | AI 응답 끝의 백틱(```) 제거 |
| `removeControlCharacterArtifacts(content)` | `<ctrl46>` 등 제어문자 표기 제거 |
| `unescapeHtmlEntities(content, filePath)` | HTML entity → 원래 문자 복원 |

### 2. `src/utils/logger.ts` (신규 파일)

VS Code Output Channel 기반 구조화된 싱글턴 로거:

```typescript
// 초기화 (extension.ts에서 1회)
logger.init(context);

// 사용
logger.info('[AgentEngine]', 'Planning started');
logger.warn('[Executor]', 'Suspicious deletion', { lines: 50 });
logger.error('[CheckpointManager]', 'Failed to save', error);
```

- 타임스탬프: `2026-02-25 14:30:00.123`
- 레벨: DEBUG / INFO / WARN / ERROR
- Output Channel `Tokamak Agent`에 영구 기록
- console.log 미러링 유지 (개발 중 디버깅용)

### 3. 구조적 변경

| 파일 | 변경 내용 |
|------|-----------|
| `extension.ts` | `logger.init(context)` 추가 |
| `executor.ts` | contentUtils import, 중복 private 메서드 4개 제거 |
| `chatPanel.ts` | contentUtils import, 중복 private 메서드 3개 제거 |
| `engine.ts` | logger import, console.* → logger.* (14개) |
| `contextManager.ts` | logger import, console.* → logger.* |
| `searcher.ts` | logger import, console.* → logger.* |
| `checkpointManager.ts` | logger import, console.* → logger.* (6개) |
| `dependencyAnalyzer.ts` | logger import, console.* → logger.* |
| `summarizer.ts` | logger import, console.* → logger.* |

---

## 변경 파일 목록

```
src/
├── agent/
│   ├── contextManager.ts   ✏️ template literal 버그, logger
│   ├── engine.ts           ✏️ JSON 파싱, streamWithUI, consecutiveMistakeCount, logger
│   ├── executor.ts         ✏️ 4-tier SEARCH/REPLACE, AsyncMutex, unescapeHtmlEntities, logger
│   ├── planner.ts          ✏️ template literal 버그, replan 스트림 순회 버그
│   ├── searcher.ts         ✏️ RegExp injection 수정, logger
│   ├── checkpointManager.ts ✏️ logger
│   ├── dependencyAnalyzer.ts ✏️ logger
│   ├── summarizer.ts       ✏️ logger
│   └── types.ts            ✏️ 스트리밍 콜백 타입 추가
├── api/
│   └── client.ts           ✏️ 중복 토큰 제거 버그 수정
├── chat/
│   └── chatPanel.ts        ✏️ 스트리밍 콜백 연결, contentUtils, logger
├── utils/
│   ├── contentUtils.ts     🆕 신규 생성
│   └── logger.ts           🆕 신규 생성
└── extension.ts            ✏️ logger 초기화
```

---

## 컴파일 결과

```
npx tsc --noEmit → 오류 0개
```
