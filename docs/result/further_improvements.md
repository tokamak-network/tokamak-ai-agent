# Tokamak Agent — 추가 개선 가능 항목

> 작성일: 2026-02-25
> 현재 상태: P0/P1/P2 적용 완료 후 남은 개선 포인트

우선순위 기준: 🔴 높음 / 🟡 보통 / 🟢 낮음

---

## 🔴 P3 — 안정성 (권장)

### 1. API 재시도 로직 없음 (client.ts)

현재 `streamChatCompletion()`은 네트워크 오류 발생 시 바로 예외를 던짐. 일시적 오류(429 Rate Limit, 502 Bad Gateway 등)에 취약.

**권장 수정**: Exponential backoff + 최대 3회 재시도

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try { return await fn(); }
        catch (e) {
            if (i === maxRetries - 1) throw e;
            await delay(Math.pow(2, i) * 1000); // 1s, 2s, 4s
        }
    }
}
```

---

### 2. AbortController 연결 미완성 (client.ts / chatPanel.ts)

`streamChatCompletion(messages, abortSignal)`에 AbortSignal 파라미터가 있지만, chatPanel.ts에서 중단 버튼을 눌러도 실제로 HTTP 요청이 취소되지 않음. `for await` 루프를 `break`하는 것은 스트림 소비를 중단할 뿐, 진행 중인 HTTP 커넥션을 끊지 않음.

**권장 수정**:
- `chatPanel.ts`에서 AbortController를 생성하여 `streamChatCompletion`에 전달
- 중단 버튼 클릭 시 `controller.abort()` 호출

---

### 3. 토큰 예산 강제 없음 (engine.ts)

`AgentContext.tokenBudget` 필드가 정의되어 있지만 실제로 체크되지 않음. AI 컨텍스트가 모델 최대 토큰을 초과하면 API 오류가 발생하고 에이전트가 중단됨.

**권장 수정**: `contextManager.assembleContext()`에서 예산 초과 시 파일을 강제로 요약/생략하도록 상한선 강제 적용.

---

### 4. `stream_options: { include_usage: true }` 모든 모델 미지원 (client.ts)

일부 OpenAI-compatible 엔드포인트(Qwen, GLM 등)에서 `stream_options`를 지원하지 않아 오류 발생 가능.

**권장 수정**: 모델 이름 기반으로 조건부 적용

```typescript
const streamOptions = settings.selectedModel.startsWith('gpt-')
    ? { stream_options: { include_usage: true } }
    : {};
```

---

## 🟡 P4 — 기능 완성도

### 5. System Prompt 없음 (engine.ts)

Planning/Executing/Reflecting/Fixing 모든 단계에서 `role: 'user'`만 사용. AI에게 역할, 코드 작성 스타일, 도구 사용 규칙을 시스템 레벨에서 지정하는 System Prompt가 없음.

**권장 수정**: 각 단계 첫 메시지에 System Prompt 추가

```typescript
const messages: ChatMessage[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'user', content: prompt }
];
```

---

### 6. 대화 히스토리 미활용 (engine.ts)

`AgentContext.history`가 있지만 에이전트 각 단계의 `streamWithUI()` 호출 시 히스토리가 포함되지 않음. 매 단계마다 AI가 이전 대화 맥락을 잃어버림.

**권장 수정**: `streamWithUI(messages)`에 `this.context.history`를 prepend

---

### 7. planner.ts — JSON 브래킷 감지 취약

```typescript
// 현재: 단순 줄 끝 감지 — 중괄호 중첩 미처리
if (line.trim().endsWith('}') || line.trim().endsWith('}```')) {
    capturingAction = false;
}
```

multi_write 같은 중첩 JSON이 중간에 `}`로 끝나는 줄이 있으면 조기 종료됨.

**권장 수정**: `extractJsonFromText()` (engine.ts에 이미 있음)를 planner.ts로 가져와 재사용

---

### 8. 체크포인트 — 워크스페이스 분리 없음 (checkpointManager.ts)

현재 `context.globalStorageUri`를 사용하므로 여러 워크스페이스에서 체크포인트가 섞임.

**권장 수정**: `context.storageUri` (워크스페이스별) 사용 또는 워크스페이스 이름을 디렉토리 경로에 포함.

---

## 🟢 P5 — 품질 / 관찰성

### 9. SessionManager 분리 (chatPanel.ts)

`chatPanel.ts`는 현재 4,200+ 줄로, UI 렌더링과 세션 관리 로직이 혼재. 다음 로직을 `SessionManager`로 분리하면 유지보수성 향상:

- `saveChatHistory()` / `restoreChatHistory()`
- `exportSession()`
- `ChatSession` 인터페이스 및 세션 CRUD

---

### 10. 의존성 분석기 미활용 (dependencyAnalyzer.ts)

`DependencyAnalyzer`가 `engine.ts`에 import는 되어 있지만 실제로 호출되지 않음. 코드 수정 시 영향을 받는 파일들을 자동으로 컨텍스트에 포함하는 데 활용 가능.

---

### 11. logger.ts — 로그 레벨 설정 UI 없음

현재 `logger.setMinLevel('DEBUG')`를 코드에서 직접 호출해야 함.

**권장 수정**: VS Code 설정(`tokamak.logLevel`)으로 노출하여 사용자가 Output Channel 출력 상세도를 조정할 수 있게 함.

---

### 12. observer.ts — 진단 지연 처리

`getDiagnostics()`가 `vscode.languages.getDiagnostics()`를 즉시 호출하는데, 파일 저장 후 TypeScript/ESLint 등 언어 서버가 진단을 업데이트하기까지 수백ms가 필요. 현재는 빈 진단을 받을 가능성이 있음.

**권장 수정**: 파일 저장 후 500–1000ms 대기 또는 `onDidChangeDiagnostics` 이벤트 감지.

---

## 우선순위 요약

| 번호 | 항목 | 우선순위 | 공수 |
|------|------|----------|------|
| 1 | API 재시도 로직 | 🔴 높음 | 소 |
| 2 | AbortController 완성 | 🔴 높음 | 소 |
| 3 | 토큰 예산 강제 | 🔴 높음 | 중 |
| 4 | stream_options 조건부 적용 | 🔴 높음 | 소 |
| 5 | System Prompt 추가 | 🟡 보통 | 소 |
| 6 | 대화 히스토리 활용 | 🟡 보통 | 중 |
| 7 | planner.ts JSON 감지 개선 | 🟡 보통 | 소 |
| 8 | 체크포인트 워크스페이스 분리 | 🟡 보통 | 소 |
| 9 | SessionManager 분리 | 🟢 낮음 | 대 |
| 10 | 의존성 분석기 활용 | 🟢 낮음 | 중 |
| 11 | 로그 레벨 설정 UI | 🟢 낮음 | 소 |
| 12 | observer 진단 지연 처리 | 🟢 낮음 | 소 |
