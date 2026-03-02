# 02. 아키텍처

## 전체 구조도

```
┌─────────────────────────────────────────────────────┐
│                   extension.ts                       │
│              (커맨드 등록, 활성화)                     │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │    chat/chatPanel.ts     │  ← 모든 서브시스템의 허브
          │    (~2,300줄)            │
          └──┬───┬───┬───┬───┬──────┘
             │   │   │   │   │
    ┌────────┘   │   │   │   └──────────┐
    ▼            ▼   ▼   ▼              ▼
 agent/       api/  prompts/  mentions/  streaming/
 engine.ts    client.ts       mentionProvider
 executor.ts  providers/
 planner.ts
 observer.ts

    ┌────────────────────────────────────┐
    │        확장 모듈 (Phase 1~4)        │
    ├────────────────────────────────────┤
    │ approval/   — 자동 승인            │
    │ context/    — 컨텍스트 압축         │
    │ ast/        — Tree-sitter AST      │
    │ rules/      — 프로젝트 규칙         │
    │ hooks/      — Pre/Post 훅          │
    │ mcp/        — MCP 클라이언트        │
    │ knowledge/  — 자동 지식 수집        │
    │ browser/    — 브라우저 자동화        │
    └────────────────────────────────────┘
```

## 핫스팟 파일 (가장 많이 수정되는 파일)

| 파일 | 줄 수 | 역할 | 연결되는 모듈 |
|------|-------|------|-------------|
| `chat/chatPanel.ts` | ~2,300 | 채팅 UI 허브 | 거의 전부 |
| `agent/engine.ts` | ~1,400 | 에이전트 상태 머신 | executor, planner, observer, approval, hooks |
| `agent/executor.ts` | ~780 | 파일/터미널 실행 | hooks, browser, contentUtils |
| `chat/webviewContent.ts` | ~2,500 | HTML/CSS/JS UI | 없음 (독립적 HTML 생성) |

---

## Agent 상태 머신

Agent 모드의 핵심은 `engine.ts`의 상태 머신이다.

```
         ┌──────────────────────────────────────────────┐
         │                                              │
         ▼                                              │
   ┌──────────┐    ┌───────────┐    ┌──────────────┐    │
   │   Idle   │───▶│ Planning  │───▶│  Executing   │    │
   └──────────┘    └───────────┘    └──────┬───────┘    │
                        ▲                  │             │
                        │                  ▼             │
                   ┌────┴───┐       ┌──────────────┐    │
                   │ Fixing │◀──────│  Observing   │    │
                   └────────┘       └──────┬───────┘    │
                        │                  │             │
                        │                  ▼             │
                        │           ┌──────────────┐    │
                        └───────────│  Reflecting  │────┘
                                    └──────────────┘
                                           │
                    선택적 ─────────────────┤
                                           ▼
                                    ┌──────────────┐
                                    │  Reviewing   │  (멀티 모델 리뷰)
                                    │  Debating    │  (멀티 모델 토론)
                                    └──────────────┘
```

### 각 상태의 역할

| 상태 | 파일 위치 | 하는 일 |
|------|----------|--------|
| **Planning** | `engine.ts:handlePlanning()` | 사용자 요청을 PlanStep[]으로 분해 |
| **Executing** | `engine.ts:handleExecution()` | PlanStep의 액션을 executor로 실행 |
| **Observing** | `engine.ts:handleObservation()` | 실행 결과 + VS Code 진단 정보 수집 |
| **Reflecting** | `engine.ts:handleReflection()` | AI가 결과를 평가, 다음 행동 결정 |
| **Fixing** | `engine.ts:handleFixing()` | 에러 수정 코드 생성, 재실행 |
| **Reviewing** | `engine.ts:handleReview()` | 별도 모델이 코드 리뷰 (review/red-team 전략) |
| **Debating** | `engine.ts:handleDebate()` | 별도 모델이 계획 비평 (debate/perspectives 전략) |

---

## 모듈별 상세

### 1. `src/chat/` — 채팅 UI 레이어

```
chatPanel.ts        ← 중앙 허브. 메시지 처리, 스트리밍, 파일 오퍼레이션 적용
webviewContent.ts   ← HTML/CSS/JS 생성 (VS Code Webview)
fileOperationParser.ts ← AI 응답에서 FILE_OPERATION 블록 파싱
skillsManager.ts    ← /slash 커맨드 로딩 (.tokamak/skills/*.md)
```

**chatPanel.ts 흐름:**
```
사용자 메시지
    │
    ▼
멘션 해석 (@file → 파일 내용 주입)
    │
    ▼
프로젝트 지식 수집 (package.json 등)
    │
    ▼
시스템 프롬프트 조립 (모드별 + 규칙 + MCP 도구 목록)
    │
    ▼
컨텍스트 압축 체크 (75% 초과 시 요약)
    │
    ▼
AI 스트리밍 호출 (streamChatCompletion)
    │
    ▼
스트리밍 중: StreamingDiffParser로 파일 오퍼레이션 실시간 감지
    │
    ▼
응답 완료 후: FILE_OPERATION 파싱 → 자동 승인 / 사용자 확인
    │
    ▼
PostMessage 훅 실행
```

### 2. `src/agent/` — 에이전트 엔진

```
engine.ts              ← 상태 머신 (위에서 설명)
executor.ts            ← 실제 실행 (파일 쓰기, 터미널, 브라우저)
planner.ts             ← AI 응답 → PlanStep[] 파싱
observer.ts            ← VS Code 진단 정보 수집
searcher.ts            ← 키워드/AST 기반 파일 검색 (가중치 랭킹)
contextManager.ts      ← 토큰 예산 기반 컨텍스트 조립
dependencyAnalyzer.ts  ← import/export 의존성 그래프
checkpointManager.ts   ← 체크포인트 저장/복원
convergence.ts         ← 리뷰/토론 수렴도 계산
summarizer.ts          ← 파일 요약
terminalOutputParser.ts ← 터미널 에러 파싱 (npm, vitest, tsc 등)
diagnosticDiffTracker.ts ← 편집 전후 진단 비교
types.ts               ← AgentState, AgentAction, PlanStep 등 타입 정의
```

**executor.ts의 액션 타입:**
```typescript
type AgentAction =
  | 'write'       // 파일 쓰기 (SEARCH/REPLACE 또는 전체 덮어쓰기)
  | 'multi_write'  // 다중 파일 atomic 쓰기
  | 'read'        // 파일 읽기
  | 'run'         // 터미널 명령 실행
  | 'search'      // 파일 내용 검색
  | 'delete'      // 파일 삭제
  | 'mcp_tool'    // MCP 외부 도구 호출
  | 'browser'     // 브라우저 자동화
```

**SEARCH/REPLACE 4단계 매칭 (Cline 참고):**
1. Exact match — 정확히 일치
2. Line-trimmed — 앞뒤 공백 무시
3. Block anchor — 첫/끝 줄 앵커로 블록 매칭
4. Full-file search — 전체 파일에서 재검색

### 3. `src/api/` — AI 모델 통신

```
client.ts              ← streamChatCompletion(), isVisionCapable()
types.ts               ← ChatMessage, TokenUsage, StreamResult
providers/
  IProvider.ts         ← 인터페이스 정의
  BaseProvider.ts      ← 공통 로직 (스트리밍, 재시도, 이미지 처리)
  ProviderRegistry.ts  ← 모델명 → Provider 매칭 (싱글톤)
  QwenProvider.ts      ← Qwen 모델 (thinking 모드 지원)
  MinimaxProvider.ts   ← Minimax 모델
  GlmProvider.ts       ← GLM 모델
  OpenAIProvider.ts    ← GPT 모델
  ClaudeProvider.ts    ← Claude 모델 (vision 지원)
  GeminiProvider.ts    ← Gemini 모델 (vision 지원)
  GenericProvider.ts   ← 기본 fallback
```

**Provider 패턴:**
```typescript
// 모델명으로 적절한 Provider를 자동 선택
const registry = getRegistry();
const provider = registry.resolve('qwen3-235b');  // → QwenProvider
const provider = registry.resolve('gpt-4o');      // → OpenAIProvider

// Provider가 모델별 차이를 추상화
provider.getCapabilities(model);  // { vision, streamUsage, thinking, ... }
provider.getDefaults(model);      // { temperature, maxTokens, ... }
provider.streamChat(model, messages);
```

### 4. `src/prompts/` — 프롬프트 빌더

```
index.ts                        ← 공개 API (re-export)
types.ts                        ← PromptContext, ChatMode, PromptHints
builders/
  modePromptBuilder.ts          ← 모드별 시스템 프롬프트 (ask/plan/agent)
  agentSystemPrompt.ts          ← Agent 모드 전용 상세 프롬프트
  reviewPromptBuilder.ts        ← 코드 리뷰 프롬프트
  debatePromptBuilder.ts        ← 계획 토론 프롬프트
components/
  rules.ts                      ← 기본 규칙 (하드코딩)
  fileOperationFormat.ts        ← FILE_OPERATION 형식 설명
  jsonVerdictFormat.ts          ← 리뷰/토론 JSON 응답 형식
  _helpers.ts                   ← 공통 헬퍼
variants/
  resolver.ts                   ← 모델별 프롬프트 힌트 해석
  standard.ts / compact.ts      ← 프롬프트 변형
```

**PromptContext (시스템 프롬프트에 주입되는 컨텍스트):**
```typescript
interface PromptContext {
  mode: ChatMode;
  variant: PromptVariant;
  contextTier: ContextTier;
  hints: PromptHints;
  activeRules?: string;        // F8: 프로젝트 규칙
  mcpToolsSection?: string;    // F7: MCP 도구 목록
  browserActionDocs?: string;  // F12: 브라우저 액션 설명
}
```

### 5. 확장 모듈 (Phase 1~4)

각 모듈은 **독립적**으로 설계되어 있고, chatPanel.ts 또는 engine.ts에서 import하여 사용.

| 모듈 | 파일 | 순수 함수? | VS Code 의존? |
|------|------|-----------|-------------|
| `approval/` | autoApproval.ts | Yes | No |
| `context/` | contextCompressor.ts | Yes | No |
| `ast/` | treeSitterService.ts, definitionExtractor.ts, types.ts | Partial | No |
| `mentions/` | mentionProvider.ts, types.ts | No | Yes |
| `rules/` | ruleLoader.ts, ruleEvaluator.ts, ruleTypes.ts | Partial | Yes (로더만) |
| `hooks/` | hookRunner.ts, hookConfigLoader.ts, hookTypes.ts | Partial | Yes (로더만) |
| `mcp/` | mcpClient.ts, mcpConfigManager.ts, mcpToolAdapter.ts, mcpTypes.ts | Partial | Yes (매니저만) |
| `knowledge/` | autoCollector.ts | Yes | No |
| `streaming/` | streamingDiffParser.ts | Yes | No |
| `browser/` | browserService.ts, browserActions.ts, browserTypes.ts | Partial | No |

> **순수 함수 = 테스트 가능**: VS Code 의존이 없는 모듈은 vitest에서 직접 테스트 가능.
> VS Code 의존 모듈은 mock이 필요하므로 통합 테스트는 Extension Development Host에서.

---

## 데이터 흐름

### Ask 모드

```
사용자 입력 → chatPanel.handleUserMessage()
    → buildModePrompt('ask', context)
    → streamChatCompletion(messages)
    → 스트리밍 응답 표시
```

### Agent 모드

```
사용자 입력 → chatPanel.handleUserMessage()
    → new AgentEngine(context)
    → engine.run()
        → handlePlanning()    : AI → PlanStep[]
        → handleExecution()   : PlanStep → executor.execute(action)
        → handleObservation() : diagnosticDiffTracker.diff()
        → handleReflection()  : AI → 다음 행동 결정
        → handleFixing()      : 에러 시 수정 코드 생성
        → (선택) handleReview() : 별도 모델 리뷰
    → 결과를 chatPanel에 콜백
    → FILE_OPERATION → pendingOperations
    → 사용자 Apply / Reject
```

### 파일 수정 흐름

```
AI 응답: "<<<FILE_OPERATION>>> ... <<<END_OPERATION>>>"
    │
    ▼
fileOperationParser.parseFileOperations(response)
    → FileOperation[] (type, path, content)
    │
    ▼
auto-approval 체크 (shouldAutoApprove)
    ├── 자동 승인 → executor.execute()
    └── 수동 → UI에 Pending Operations 표시
                  │
                  ├── Apply → executor.writeFile() / deleteFile()
                  └── Reject → 무시
```

---

## 설정 파일 구조

### VS Code Settings (`package.json`에 정의)

```
tokamak.apiKey                          — API 키
tokamak.models                          — 모델 목록
tokamak.selectedModel                   — 현재 선택된 모델
tokamak.enableInlineCompletion          — Ghost Text 활성화
tokamak.enableCheckpoints               — 체크포인트 활성화
tokamak.enableMultiModelReview          — 멀티 모델 리뷰
tokamak.enableBrowser                   — 브라우저 자동화
tokamak.autoApproval.enabled            — 자동 승인 활성화
tokamak.autoApproval.tools.*            — 도구별 승인 수준
tokamak.autoApproval.allowedPaths       — 자동 허용 경로 glob
tokamak.autoApproval.protectedPaths     — 보호 경로 glob
tokamak.autoApproval.allowedCommands    — 허용 명령 패턴
```

### 프로젝트별 설정 (`.tokamak/` 폴더)

```
.tokamak/
├── skills/         — 슬래시 커맨드 (/explain, /fix 등)
│   ├── explain.md
│   ├── refactor.md
│   └── ...
├── knowledge/      — 프로젝트 지식 (AI 컨텍스트에 자동 주입)
│   └── conventions.md
├── rules/          — 코딩 규칙 (조건부 활성화)
│   └── ts-conventions.md
├── mcp.json        — MCP 서버 설정
└── hooks.json      — Pre/Post 훅 설정
```
