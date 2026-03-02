# 03. 기능 목록

12개 기능을 4단계(Phase)로 나누어 구현했다. 모두 구현 완료 상태.

---

## 기존 기능 (Phase 0)

이 프로젝트가 원래 가지고 있던 기본 기능들.

### 채팅 (Ask/Plan/Agent 3개 모드)
- **Ask 모드**: 일반 질의응답
- **Plan 모드**: 구현 계획 수립 (코드 작성 없이 단계별 설계)
- **Agent 모드**: 자율 에이전트 (파일 생성/수정/삭제, 터미널 실행)
- 파일: `src/chat/chatPanel.ts`, `src/agent/engine.ts`

### 인라인 자동완성 (Ghost Text)
- 타이핑 중 AI가 코드 제안
- Tab으로 수락, Esc로 무시
- 파일: `src/completion/inlineCompletionProvider.ts`

### 슬래시 커맨드 (/skills)
- `/explain`, `/refactor`, `/fix`, `/test` 등
- `.tokamak/skills/` 폴더에 마크다운으로 커스텀 정의 가능
- 파일: `src/chat/skillsManager.ts`

### @file 멘션
- 채팅에서 `@파일명`으로 파일 내용을 컨텍스트에 주입
- 파일: `src/chat/chatPanel.ts` (searchFiles)

### 우클릭 메뉴
- "Explain Code" / "Refactor Code" / "Send to Chat"
- 파일: `src/codeActions/codeActionProvider.ts`

### 멀티 모델 리뷰/토론
- Agent 모드: 별도 모델이 코드 리뷰 (review / red-team 전략)
- Plan 모드: 별도 모델이 계획 비평 (debate / perspectives 전략)
- 수렴도(convergence) 계산으로 자동 종료
- 파일: `src/agent/engine.ts`, `src/agent/convergence.ts`

### 체크포인트
- Agent 실행 전 워크스페이스 상태 자동 저장
- 실패 시 복원 가능
- 파일: `src/agent/checkpointManager.ts`

### 7개 AI Provider
- Qwen, Minimax, GLM, OpenAI, Claude, Gemini, Generic (fallback)
- 각 모델별 vision 지원, 토큰 제한, 스트리밍 옵션 차이를 추상화
- 파일: `src/api/providers/`

---

## Phase 1: Agent Autonomy (에이전트 자율성)

### F1. Auto-Approval System (자동 승인)

**문제**: Agent가 파일 수정할 때마다 "Apply" 클릭 필요 → 자율 에이전트가 아님

**해결**: 도구/경로/명령별로 자동 승인 규칙 설정

| 파일 | 역할 |
|------|------|
| `src/approval/autoApproval.ts` | `shouldAutoApprove()` 순수 함수 |
| `src/config/settings.ts` | `getAutoApprovalConfig()` |
| `src/__tests__/autoApproval.test.ts` | 22개 테스트 |

**설정 예시** (VS Code Settings):
```json
{
  "tokamak.autoApproval.enabled": true,
  "tokamak.autoApproval.tools.read_file": "always_allow",
  "tokamak.autoApproval.tools.write_file": "ask",
  "tokamak.autoApproval.allowedPaths": ["src/**/*.ts"],
  "tokamak.autoApproval.protectedPaths": [".env", "*.key"],
  "tokamak.autoApproval.allowedCommands": ["npm test", "npm run *"]
}
```

**판단 흐름**:
```
전역 토글 → 도구별 레벨 → 보호 경로 → 허용 경로 → 파일 크기 → 명령 화이트리스트
```

---

### F2. Context Window Auto-Compression (컨텍스트 자동 압축)

**문제**: 대화가 길어지면 모델 컨텍스트 초과 → 잘림 또는 에러

**해결**: 토큰 사용량 75% 초과 시 이전 메시지를 LLM으로 요약

| 파일 | 역할 |
|------|------|
| `src/context/contextCompressor.ts` | `needsCompression()`, `compressMessages()` |
| `src/utils/tokenEstimator.ts` | 토큰 수 추정 (ASCII 0.25, CJK 1.5 토큰/글자) |
| `src/__tests__/contextCompressor.test.ts` | 15개 테스트 |

**동작**: system 메시지 보존 → 최근 N개 보존 → 중간 메시지 요약 → 압축된 히스토리 반환

---

### F3. Terminal Feedback Loop (터미널 피드백 루프)

**문제**: `npm test` 실패 시 raw 출력만 전달 → AI가 에러 위치를 정확히 모름

**해결**: 에코시스템별 에러 파서로 구조화된 에러 정보 추출

| 파일 | 역할 |
|------|------|
| `src/agent/terminalOutputParser.ts` | 파서 + `analyzeTerminalOutput()` |
| `src/__tests__/terminalOutputParser.test.ts` | 30개 테스트 |

**지원 에코시스템**: TypeScript (tsc), Vitest/Jest, ESLint, npm, Python, Go

**추출 정보**:
```typescript
interface TerminalError {
  type: 'compile' | 'test' | 'lint' | 'runtime' | 'dependency';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  testName?: string;
  stackTrace?: string;
}
```

---

## Phase 2: Code Intelligence (코드 지능)

### F4. Tree-sitter AST Integration

**문제**: 파일 전체를 읽지 않으면 코드 구조 파악 불가

**해결**: Tree-sitter WASM으로 AST 파싱 → 함수/클래스 정의 추출

| 파일 | 역할 |
|------|------|
| `src/ast/treeSitterService.ts` | WASM 파서 싱글톤 (dynamic import) |
| `src/ast/definitionExtractor.ts` | AST → CodeDefinition[] 추출 |
| `src/ast/types.ts` | CodeDefinition, FileOutline 타입 |

**사용처**:
- `searcher.ts` — AST 정의명 매칭 15점 (일반 텍스트 매칭 3점보다 5배 높음)
- `contextManager.ts` — 큰 파일을 FileOutline(시그니처만)으로 요약
- `dependencyAnalyzer.ts` — AST 기반 import/export 추출 (regex보다 정확)

**지원 언어**: TypeScript, JavaScript, Python, Go

> tree-sitter 초기화 실패 시 자동으로 기존 regex 방식으로 fallback

---

### F5. Mention System Enhancement (멘션 시스템 확장)

**문제**: `@file`만 지원. 폴더, 심볼, 에러 목록 멘션 불가

**해결**: `@file`, `@folder`, `@symbol`, `@problems` 4가지 멘션 타입

| 파일 | 역할 |
|------|------|
| `src/mentions/mentionProvider.ts` | `parseQuery()`, `getSuggestions()`, `resolve()` |
| `src/mentions/types.ts` | MentionType, MentionQuery, MentionResult |

**사용 예시**:
```
@file:src/agent/engine.ts    → 해당 파일 내용 주입
@folder:src/api/             → 디렉토리 파일 목록 + 요약
@symbol:AgentEngine          → 해당 심볼 정의 코드
@problems                    → 현재 VS Code 진단(에러/경고) 목록
```

---

### F6. Diagnostic-Based Auto-Fix (진단 기반 자동 수정)

**문제**: 편집 후 새 에러 감지 불가. 절대 진단 수만 봄

**해결**: 편집 전후 진단 스냅샷을 비교 → 새로 생긴 에러만 추출

| 파일 | 역할 |
|------|------|
| `src/agent/diagnosticDiffTracker.ts` | `captureSnapshot()`, `diff()`, `shouldAutoFix()` |

**핑거프린팅**: `file:message:code` (라인 번호 제외 — 편집으로 라인이 이동하므로)

**자동 수정 조건**: 새 에러 10개 미만이면 자동 수정 시도, 10개 이상이면 skip

---

## Phase 3: Extensibility (확장성)

### F7. MCP Client (Model Context Protocol)

**문제**: AI가 외부 도구(DB, API 등)를 사용할 수 없음

**해결**: MCP 프로토콜로 외부 도구 서버와 통신

| 파일 | 역할 |
|------|------|
| `src/mcp/mcpClient.ts` | `connect()`, `listTools()`, `callTool()` |
| `src/mcp/mcpConfigManager.ts` | `.tokamak/mcp.json` 로딩 + 파일 감시 |
| `src/mcp/mcpToolAdapter.ts` | MCP 도구 → 프롬프트 설명 포매팅 |
| `src/mcp/mcpTypes.ts` | McpServerConfig, McpTool, McpToolResult |

**설정 파일** (`.tokamak/mcp.json`):
```json
{
  "servers": [
    {
      "name": "my-server",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@my/mcp-server"],
      "enabled": true
    }
  ]
}
```

**커맨드**: `Cmd+Shift+P` → "Tokamak: Configure MCP Servers"

---

### F8. Rule System (규칙 시스템)

**문제**: AI에게 프로젝트별 코딩 컨벤션을 강제할 수 없음

**해결**: `.tokamak/rules/*.md` 파일로 조건부 규칙 정의

| 파일 | 역할 |
|------|------|
| `src/rules/ruleLoader.ts` | YAML frontmatter 파싱 + 파일 감시 |
| `src/rules/ruleEvaluator.ts` | `getActiveRules()`, `matchesCondition()` |
| `src/rules/ruleTypes.ts` | Rule, RuleCondition 타입 |
| `src/__tests__/ruleEvaluator.test.ts` | 10개 테스트 |

**규칙 파일 예시** (`.tokamak/rules/ts-conventions.md`):
```markdown
---
description: TypeScript conventions
condition:
  languages: [typescript, typescriptreact]
  modes: [agent]
priority: 10
---
- Use strict TypeScript. No `any`.
- Prefer `interface` over `type` for object shapes.
```

**조건 매칭**: `languages` (현재 파일), `modes` (현재 모드), `filePatterns` (glob)

**커맨드**: `Cmd+Shift+P` → "Tokamak: Initialize Rules Folder"

---

### F9. Hooks System (훅 시스템)

**문제**: 도구 실행 전후에 커스텀 검증/로깅/자동화 불가

**해결**: Pre/Post 훅으로 셸 명령 실행, blocking 옵션으로 실행 차단 가능

| 파일 | 역할 |
|------|------|
| `src/hooks/hookRunner.ts` | child_process spawn + JSON stdin/stdout |
| `src/hooks/hookConfigLoader.ts` | `.tokamak/hooks.json` 로딩 + 파일 감시 |
| `src/hooks/hookTypes.ts` | HookEvent, HookConfig, HookInput, HookResult |

**훅 이벤트**: `PreToolUse`, `PostToolUse`, `PreApproval`, `PostApproval`, `PreMessage`, `PostMessage`

**실행 위치**:
- `executor.ts` — PreToolUse / PostToolUse (모든 도구 실행 전후)
- `engine.ts` — PreApproval / PostApproval (에이전트 액션 실행 전후)
- `chatPanel.ts` — PreMessage / PostMessage (사용자 메시지 전후)

**설정 파일** (`.tokamak/hooks.json`):
```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "command": "echo $HOOK_INPUT | jq .",
      "timeout": 5000,
      "blocking": true,
      "toolFilter": ["write", "delete"],
      "enabled": true
    }
  ]
}
```

---

## Phase 4: UX Polish (UX 개선)

### F10. Streaming Diff Display (스트리밍 diff 표시)

**문제**: AI 응답 완료 후에야 파일 변경 확인 가능

**해결**: 스트리밍 중 `<<<FILE_OPERATION>>>` 마커를 증분 파싱

| 파일 | 역할 |
|------|------|
| `src/streaming/streamingDiffParser.ts` | `feed(chunk)` → operation 감지 |
| `src/__tests__/streamingDiffParser.test.ts` | 10개 테스트 |

**상태 머신**: `detecting` → `type` → `path` → `description` → `content` → `complete`

**Hold-back buffer**: 19바이트 (마커가 청크 경계에 걸리는 경우 처리)

---

### F11. Project Knowledge Auto-Collection (프로젝트 지식 자동 수집)

**문제**: `.tokamak/knowledge/` 파일을 수동으로 작성해야 함

**해결**: `package.json`, `tsconfig.json`, `README.md` 등에서 자동 추출

| 파일 | 역할 |
|------|------|
| `src/knowledge/autoCollector.ts` | `collect()`, `formatForPrompt()` |
| `src/__tests__/autoCollector.test.ts` | 12개 테스트 |

**수집 대상**: package.json (이름, 스크립트, 의존성), tsconfig, README (첫 500자), Dockerfile, pyproject.toml, Cargo.toml

**동작**: 첫 메시지 전송 시 자동 수집 → 수동 knowledge 파일과 병합 → 프롬프트에 주입

---

### F12. Browser Automation (브라우저 자동화)

**문제**: 웹 앱 테스트/디버깅, 스크린샷 캡처 불가

**해결**: puppeteer-core로 헤드리스 브라우저 제어

| 파일 | 역할 |
|------|------|
| `src/browser/browserService.ts` | `launch()`, `execute()`, `close()` |
| `src/browser/browserActions.ts` | `parseBrowserAction()`, `formatBrowserResult()`, `getBrowserActionDocs()` |
| `src/browser/browserTypes.ts` | BrowserAction, BrowserResult, BrowserConfig |

**지원 액션**: `navigate`, `screenshot`, `click`, `type`, `evaluate`, `close`

**설정**: `tokamak.enableBrowser: true` + `npm install puppeteer-core` 필요

> puppeteer-core는 optional. 미설치 시 graceful degradation (에러 메시지만 반환)

---

## 의존성 그래프

```
Phase 1 (독립 구현 가능):
  F1 Auto-Approval ──── standalone
  F2 Context Compression ── standalone
  F3 Terminal Feedback ──── standalone

Phase 2 (F4 먼저):
  F4 Tree-sitter ──── standalone
  F5 Mentions ─────── @symbol이 F4에 의존 (soft)
  F6 Diagnostic Diff ── standalone

Phase 3 (F1 활용):
  F7 MCP ──────────── F1의 approval 활용 (MCP 도구 실행 시)
  F8 Rules ────────── standalone
  F9 Hooks ────────── F1의 approval 포인트에서 실행

Phase 4 (독립 구현 가능):
  F10 Streaming Diff ── standalone
  F11 Auto Knowledge ── standalone
  F12 Browser ───────── F1의 approval 활용 (브라우저 액션 시)
```

## 테스트 매핑

| Feature | 테스트 파일 | 테스트 수 |
|---------|-----------|----------|
| F1 | `autoApproval.test.ts` | 22 |
| F2 | `contextCompressor.test.ts` | 15 |
| F3 | `terminalOutputParser.test.ts` | 30 |
| F8 | `ruleEvaluator.test.ts` | 10 |
| F10 | `streamingDiffParser.test.ts` | 10 |
| F11 | `autoCollector.test.ts` | 12 |
| 기존 | `engine-review.test.ts` | 12 |
| 기존 | `promptBuilders.test.ts` | 44 |
| 기존 | `fileOperationParser.test.ts` | 15 |
| 기존 | `contentUtils.test.ts` | 34 |
| 기존 | `convergence.test.ts` | 23 |
| 기존 | `planner.test.ts` | 13 |
| 기존 | `providerCapabilities.test.ts` | 41 |
| 기존 | `providerRegistry.test.ts` | 16 |
| **합계** | **14 파일** | **297** |
