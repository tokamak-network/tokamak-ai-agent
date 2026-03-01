# Tokamak Agent 4-Phase Roadmap

## Context

Cline 분석 결과, Tokamak Agent에는 auto-approval, 컨텍스트 압축, MCP, tree-sitter, hooks 등 핵심 기능이 부재.
이 플랜은 12개 기능을 4개 Phase로 나누어 구현한다. 각 Phase 내 기능은 병렬 개발 가능하며, Phase 간 의존성이 있는 경우 명시했다.

현재 상태: 198 tests, 7 providers, 3 modes (ask/plan/agent), multi-model review/debate, 모델별 PromptHints 구현 완료.

---

## Phase 1: Agent Autonomy

### Feature 1: Auto-Approval System

**문제**: Agent 모드에서 매 파일 수정마다 "Apply" 클릭 필요 → 자율 에이전트가 아님.

**새 파일**:
- `src/approval/autoApproval.ts` — `shouldAutoApprove()` 순수 함수 + `classifyOperation()`
- `src/__tests__/autoApproval.test.ts`

**핵심 타입**:
```typescript
export type ToolCategory = 'read_file' | 'write_file' | 'create_file' | 'delete_file'
  | 'terminal_command' | 'search';
export type ApprovalLevel = 'always_allow' | 'ask' | 'deny';

export interface AutoApprovalConfig {
  enabled: boolean;
  tools: Record<ToolCategory, ApprovalLevel>;
  allowedPaths: string[];       // glob — 자동 허용 경로
  protectedPaths: string[];     // glob — 항상 확인 경로
  maxAutoApproveFileSize: number;
  allowedCommands: string[];    // "npm test", "npm run *"
}
```
*기본값: read_file=always_allow, search=always_allow, 나머지=ask*

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/config/settings.ts` | `getAutoApprovalConfig()` 추가 |
| `package.json` | `tokamak.autoApproval.*` 설정 8개 추가 |
| `src/chat/chatPanel.ts:1830` | 파싱 후 auto-approved ops 즉시 실행, 나머지만 pending UI |
| `src/agent/engine.ts:254` | run 액션 전 allowedCommands 체크 |
| `src/chat/webviewContent.ts` | auto-approval 설정 UI + 자동 승인 표시 아이콘 |

**구현 순서**:
1. 타입/인터페이스 정의 → 2. `shouldAutoApprove()` 순수 함수 → 3. 유닛 테스트 (15-20개) → 4. `settings.ts` + `package.json` → 5. `chatPanel.ts` 분기 로직 → 6. `engine.ts` 터미널 체크 → 7. webview UI

---

### Feature 2: Context Window Auto-Compression

**문제**: 대화 이력이 무한 증가 → 모델 컨텍스트 초과 시 크래시/잘림. 현재 pruning 없음.

**새 파일**:
- `src/context/contextCompressor.ts` — `ContextCompressor` 클래스
- `src/utils/tokenEstimator.ts` — 기존 `contextManager.ts`에서 토큰 추정 로직 추출 (공유 유틸)
- `src/__tests__/contextCompressor.test.ts`

**핵심 타입**:
```typescript
export interface CompressionConfig {
  compressionThreshold: number;    // 컨텍스트 윈도우의 75%에서 트리거
  preserveRecentCount: number;     // 최근 N개 메시지 보존
  minMessagesForCompression: number;
  maxSummaryTokens: number;
}

export class ContextCompressor {
  estimateTokens(messages: ChatMessage[]): number;
  needsCompression(messages: ChatMessage[], contextWindowSize: number): boolean;
  compress(messages: ChatMessage[], contextWindowSize: number): Promise<CompressionResult>;
}
```

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/agent/contextManager.ts:39-42` | 토큰 추정 로직을 `tokenEstimator.ts`로 추출 |
| `src/chat/chatPanel.ts:1753` | 스트리밍 전 `needsCompression()` 체크 → 압축 실행 |
| `src/agent/engine.ts` | `streamWithUI()` 에서도 동일 압축 체크 |
| `src/chat/webviewContent.ts:1082` | 기존 토큰 바 옆에 "Context: 45% used" 표시 |

**구현 순서**:
1. `tokenEstimator.ts` 추출 → 2. `ContextCompressor` 클래스 → 3. `needsCompression()` + `estimateTokens()` → 4. `compress()` (요약 프롬프트 → LLM 호출) → 5. 테스트 → 6. `chatPanel`/`engine` 통합 → 7. webview 표시

---

### Feature 3: Terminal Feedback Loop

**문제**: npm test 실패 시 에러 파싱 없이 raw 출력만 전달 → AI가 정확한 수정 불가.

**새 파일**:
- `src/agent/terminalOutputParser.ts` — 에코시스템별 에러 파서
- `src/__tests__/terminalOutputParser.test.ts` (30+ 케이스)

**핵심 타입**:
```typescript
export interface TerminalError {
  type: 'compile' | 'test' | 'lint' | 'runtime' | 'dependency' | 'unknown';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  testName?: string;
  stackTrace?: string;
}

export interface TerminalAnalysis {
  success: boolean;
  errors: TerminalError[];
  suggestedAction?: 'fix_code' | 'install_deps' | 'change_config' | 'skip';
}

// 순수 함수 — 에코시스템별 파서
export function parseTypeScriptErrors(output: string): TerminalError[];
export function parseVitestErrors(output: string): TerminalError[];
export function parseNpmErrors(output: string): TerminalError[];
export function parsePythonErrors(output: string): TerminalError[];
```

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/agent/engine.ts:398-418` | run 결과에 `analyzeTerminalOutput()` 호출, 파싱된 에러를 fix 프롬프트에 포함 |
| `src/agent/engine.ts:540` | `handleFixing()` — 파일 경로/라인 포함한 구조화된 에러 컨텍스트 |
| `src/agent/types.ts` | `PlanStep`에 `terminalErrors?: TerminalError[]` 추가 |
| `src/agent/observer.ts` | `analyzeTerminalResult()` 메서드 추가 |

**구현 순서**:
1. 인터페이스 → 2. TypeScript/Vitest 파서 (regex) → 3. npm/Python/Go 파서 → 4. `analyzeTerminalOutput()` 디스패처 → 5. 테스트 (30+) → 6. `engine.ts` 통합 → 7. test→fix 자동 루프

---

## Phase 2: Code Intelligence

### Feature 4: Tree-sitter AST Integration

**문제**: 파일 전체를 읽지 않으면 코드 구조 파악 불가. 키워드 검색은 정확도 낮음.

**새 파일**:
- `src/ast/types.ts` — CodeDefinition, FileOutline
- `src/ast/treeSitterService.ts` — WASM 파서 싱글톤
- `src/ast/definitionExtractor.ts` — AST → 정의 추출
- `src/__tests__/definitionExtractor.test.ts`

**핵심 타입**:
```typescript
export type DefinitionKind = 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'variable';

export interface CodeDefinition {
  kind: DefinitionKind;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;       // "function foo(bar: string): number"
  parentName?: string;
  exportType?: 'named' | 'default' | 'none';
}

export interface FileOutline {
  filePath: string;
  language: string;
  definitions: CodeDefinition[];
  imports: { module: string; names: string[] }[];
}
```

*npm 의존성: `web-tree-sitter`, `tree-sitter-wasms`*

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/agent/searcher.ts:80` | 정의 이름 매칭 점수 추가 (15pts vs 현재 content 3pts) |
| `src/agent/contextManager.ts:44` | 대형 파일 → FileOutline(시그니처만)으로 대체 |
| `src/agent/dependencyAnalyzer.ts:75` | regex → tree-sitter 기반 import/export 추출 |
| esbuild config | WASM 에셋 번들링 처리 |

**구현 순서**:
1. npm install → 2. types.ts → 3. treeSitterService (TS/JS 우선) → 4. definitionExtractor → 5. 테스트 → 6. Python/Go 지원 → 7. searcher 통합 → 8. contextManager 통합 → 9. dependencyAnalyzer 교체 → 10. esbuild WASM 설정

---

### Feature 5: Mention System Enhancement

**문제**: 현재 `@file`만 부분 지원. `@folder`, `@symbol`, `@problems` 없음.

**새 파일**:
- `src/mentions/types.ts` — MentionType, MentionResult, MentionQuery
- `src/mentions/mentionProvider.ts` — 통합 멘션 해석 + 자동완성

**핵심 타입**:
```typescript
export type MentionType = 'file' | 'folder' | 'symbol' | 'problems';

export interface MentionResult {
  type: MentionType;
  displayName: string;
  insertText: string;
  resolvedContext: string;  // 프롬프트에 주입될 컨텍스트
  icon: string;
}

export class MentionProvider {
  parseQuery(text: string, cursorPos: number): MentionQuery | null;
  getSuggestions(query: MentionQuery): Promise<MentionResult[]>;
  resolve(mention: MentionResult): Promise<string>;
}
```

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/chat/webviewContent.ts:1832` | `@` 감지 → 타입별 카테고리 자동완성 UI |
| `src/chat/chatPanel.ts:543` | `searchFiles()` → `MentionProvider.getSuggestions()` 위임 |
| `src/chat/chatPanel.ts:1683` | `handleUserMessage()` — 멘션 토큰 → 실제 컨텍스트 치환 |

*의존성: Feature 4 (tree-sitter) → @symbol 검색에 사용*

**구현 순서**:
1. types.ts → 2. `MentionProvider.parseQuery()` → 3. `@file` 강화 (최근 파일 우선 랭킹) → 4. `@folder` → 5. `@symbol` (VS Code symbol provider + tree-sitter) → 6. `@problems` (Observer 활용) → 7. webview 카테고리 UI → 8. chatPanel 통합

---

### Feature 6: Diagnostic-Based Auto-Fix

**문제**: 편집 후 새로 생긴 에러 감지 없음. Observer는 전체 진단만 수집.

**새 파일**:
- `src/agent/diagnosticDiffTracker.ts` — 스냅샷 비교

**핵심 타입**:
```typescript
export interface DiagnosticDiff {
  introduced: DiagnosticInfo[];   // 편집 후 새로 생긴 에러
  resolved: DiagnosticInfo[];     // 수정된 에러
  netChange: number;
}

export class DiagnosticDiffTracker {
  captureSnapshot(): Promise<DiagnosticSnapshot>;
  diff(before: DiagnosticSnapshot, after: DiagnosticSnapshot): DiagnosticDiff;
  shouldAutoFix(diff: DiagnosticDiff): boolean;  // 10개 이상 → skip
  formatDiffForPrompt(diff: DiagnosticDiff): string;
}
```

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/agent/engine.ts:254` | 실행 전 스냅샷 → 실행 후 스냅샷 → diff → introduced 있으면 Fixing |
| `src/agent/engine.ts:455` | `handleObservation()` — 절대 진단 → diff 기반 분석으로 교체 |
| `src/chat/chatPanel.ts:1024` | `applyFileOperations()` — 적용 전후 diff, 새 에러 시 알림 |

*핑거프린팅: `file:message:code` (라인 번호 제외 — 편집으로 시프트됨)*

**구현 순서**:
1. DiagnosticDiffTracker → 2. 핑거프린팅 로직 → 3. `shouldAutoFix` 휴리스틱 → 4. 테스트 → 5. `engine.ts` 전후 스냅샷 통합 → 6. chatPanel 통합

---

## Phase 3: Extensibility

### Feature 7: MCP Client

**문제**: 외부 DB, API, 도구 연동 불가. LiteLLM API에만 의존.

**새 파일**:
- `src/mcp/mcpTypes.ts` — McpServerConfig, McpTool, McpToolResult
- `src/mcp/mcpClient.ts` — SDK 래핑, 연결/도구 목록/호출
- `src/mcp/mcpToolAdapter.ts` — MCP 도구 → 프롬프트 설명 + 응답 파싱
- `src/mcp/mcpConfigManager.ts` — `.tokamak/mcp.json` 읽기 + 파일 감시

**핵심 타입**:
```typescript
export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;  args?: string[];  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
}

export class McpClient {
  connect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(toolName: string, args: Record<string, any>): Promise<McpToolResult>;
  disconnect(): Promise<void>;
}
```

*npm 의존성: `@modelcontextprotocol/sdk`*

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/extension.ts` | McpConfigManager 초기화, `tokamak.configureMcp` 커맨드 |
| `src/prompts/builders/modePromptBuilder.ts` | agent 모드에 "## Available External Tools" 섹션 추가 |
| `src/chat/chatPanel.ts` | 응답에서 MCP 도구 호출 패턴 감지 → 실행 → 결과 주입 |
| `src/agent/engine.ts` | `'mcp_tool'` 액션 타입 추가 |
| `src/agent/types.ts` | AgentAction에 `'mcp_tool'` 추가 |

**구현 순서**:
1. npm install SDK → 2. types → 3. configManager (파일 감시) → 4. mcpClient (stdio 우선) → 5. toolAdapter (프롬프트 포매팅) → 6. 테스트 → 7. modePromptBuilder 통합 → 8. chatPanel 도구 호출 루프 → 9. engine mcp_tool 액션 → 10. 샘플 MCP 서버 테스트

---

### Feature 8: Rule System

**문제**: 에이전트 규칙이 하드코딩. 프로젝트별 코딩 컨벤션 강제 불가.

**새 파일**:
- `src/rules/ruleTypes.ts` — Rule, RuleCondition
- `src/rules/ruleLoader.ts` — YAML frontmatter 파싱
- `src/rules/ruleEvaluator.ts` — 조건 평가 + 활성 규칙 조립
- `src/__tests__/ruleEvaluator.test.ts`

**규칙 파일 형식** (`.tokamak/rules/ts-conventions.md`):
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

*npm 의존성: `yaml`*

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/prompts/builders/modePromptBuilder.ts` | 활성 규칙 → 프롬프트 주입 |
| `src/chat/chatPanel.ts` | RuleLoader 초기화 + `.tokamak/rules/` FileSystemWatcher |
| `src/extension.ts` | `tokamak.initRules` 커맨드 |
| `src/prompts/components/rules.ts` | 하드코딩 규칙 → 커스텀 규칙 없을 때의 기본값으로 유지 |

**구현 순서**:
1. types → 2. npm install yaml → 3. ruleLoader (YAML 파싱) → 4. ruleEvaluator (조건 매칭) → 5. 테스트 → 6. modePromptBuilder 통합 → 7. chatPanel 파일 감시 → 8. `tokamak.initRules` 커맨드

---

### Feature 9: Hooks System

**문제**: 도구 실행 전후 검증/로깅/커스텀 자동화 불가.

**새 파일**:
- `src/hooks/hookTypes.ts` — 이벤트 타입, 설정
- `src/hooks/hookConfigLoader.ts` — `.tokamak/hooks.json` 로더
- `src/hooks/hookRunner.ts` — 프로세스 스폰 + JSON stdin/stdout

**핵심 타입**:
```typescript
export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PreApproval' | 'PostApproval'
  | 'PreMessage' | 'PostMessage';

export interface HookConfig {
  event: HookEvent;
  command: string;
  timeout: number;      // 기본 30초
  blocking: boolean;    // true면 non-zero exit → 실행 차단
  toolFilter?: string[];
  enabled: boolean;
}

export class HookRunner {
  runHooks(event: HookEvent, input: HookInput): Promise<{ allowed: boolean; results: HookResult[] }>;
}
```

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/agent/executor.ts:326` | `execute()` 래핑 — PreToolUse/PostToolUse |
| `src/chat/chatPanel.ts` | HookRunner 초기화, PreMessage/PostMessage |
| `src/agent/engine.ts` | PreApproval/PostApproval (Feature 1과 연동) |
| `src/extension.ts` | `.tokamak/hooks.json` 파일 감시 |

**구현 순서**:
1. types → 2. configLoader → 3. hookRunner (child_process, JSON, timeout, concurrent) → 4. 테스트 → 5. `executor.ts` PreToolUse/PostToolUse → 6. `chatPanel` PreMessage/PostMessage → 7. 파일 감시

---

## Phase 4: UX Polish

### Feature 10: Streaming Diff Display

**문제**: AI 응답 완료 후에야 파일 변경 확인 가능. 실시간 diff 없음.

**새 파일**:
- `src/streaming/streamingDiffParser.ts` — 증분 FILE_OPERATION 파싱

**핵심 타입**:
```typescript
export interface PartialOperation {
  state: 'detecting' | 'type' | 'path' | 'content' | 'complete';
  type?: string;
  path?: string;
  contentSoFar: string;
  isComplete: boolean;
}

export class StreamingDiffParser {
  feed(chunk: string): { operation: PartialOperation | null; textContent: string };
  reset(): void;
}
```

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/chat/chatPanel.ts:1762` | 스트리밍 루프에서 `StreamingDiffParser.feed()` → streamOperationChunk 메시지 |
| `src/chat/webviewContent.ts` | 스트리밍 diff 뷰어 (왼쪽 원본/오른쪽 스트리밍, 초록 추가/빨강 삭제) |

**구현 순서**:
1. StreamingDiffParser → 2. 청크 경계 테스트 → 3. chatPanel 통합 → 4. webview diff CSS/JS → 5. 원본 파일 로딩 → 6. 엣지 케이스

---

### Feature 11: Project Knowledge Auto-Collection

**문제**: `.tokamak/knowledge/` 수동 작성 필요. 냉시작 문제.

**새 파일**:
- `src/knowledge/autoCollector.ts` — 표준 파일에서 프로젝트 정보 자동 추출

**핵심 타입**:
```typescript
export interface ProjectFact {
  category: 'framework' | 'language' | 'testing' | 'build' | 'dependencies' | 'structure';
  source: string;
  content: string;
  priority: number;
}

export class AutoCollector {
  collect(workspacePath: string): Promise<ProjectFact[]>;
  formatForPrompt(facts: ProjectFact[], maxTokens: number): string;
  collectFromPackageJson(content: string): ProjectFact[];
  collectFromTsConfig(content: string): ProjectFact[];
  collectFromReadme(content: string): ProjectFact[];  // 첫 500자
}
```

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/chat/chatPanel.ts:868` | `getProjectKnowledge()` — AutoCollector 먼저 → 수동 knowledge 병합 |

**구현 순서**:
1. AutoCollector → 2. package.json 파서 (name, scripts, deps, engines) → 3. tsconfig 파서 → 4. README 파서 → 5. Dockerfile/pyproject/Cargo 파서 → 6. 우선순위 기반 토큰 예산 포매팅 → 7. 테스트 → 8. chatPanel 통합 → 9. 파일 변경 캐시

---

### Feature 12: Browser Automation

**문제**: 웹 앱 테스트/디버깅, 스크린샷 캡처 불가.

**새 파일**:
- `src/browser/browserTypes.ts` — BrowserAction, BrowserResult
- `src/browser/browserService.ts` — Puppeteer 라이프사이클
- `src/browser/browserActions.ts` — 액션 구현

**핵심 타입**:
```typescript
export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'screenshot'; selector?: string }
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; text: string }
  | { type: 'evaluate'; script: string }
  | { type: 'close' };
```

*npm 의존성: `puppeteer-core`*

**수정 파일**:
| 파일 | 변경 |
|---|---|
| `src/agent/types.ts` | AgentAction에 `'browser'` 추가 |
| `src/agent/executor.ts:329` | case 'browser' → `BrowserService.execute()` |
| `src/config/settings.ts` | enableBrowser 설정 |
| `src/prompts/components/rules.ts` | 브라우저 액션 문서 추가 (조건부) |

---

## 의존성 그래프

**Phase 1** (병렬 가능):
- F1 Auto-Approval ─────── standalone
- F2 Context Compression ── standalone
- F3 Terminal Feedback ──── standalone

**Phase 2** (F4 먼저):
- F4 Tree-sitter ────────── standalone
- F5 Mentions ───────────── soft dep on F4 (@symbol)
- F6 Diagnostic Diff ────── standalone

**Phase 3** (F1 먼저):
- F7 MCP ────────────────── depends on F1 (approval for MCP tools)
- F8 Rules ──────────────── standalone
- F9 Hooks ──────────────── depends on F1 (hooks at approval points)

**Phase 4** (병렬 가능):
- F10 Streaming Diff ────── standalone
- F11 Auto Knowledge ────── standalone
- F12 Browser ───────────── depends on F1 (approval for browser actions)

---

## 새 파일 요약

| 파일 | Feature |
|---|---|
| `src/approval/autoApproval.ts` | F1 |
| `src/context/contextCompressor.ts` | F2 |
| `src/utils/tokenEstimator.ts` | F2 |
| `src/agent/terminalOutputParser.ts` | F3 |
| `src/ast/types.ts` | F4 |
| `src/ast/treeSitterService.ts` | F4 |
| `src/ast/definitionExtractor.ts` | F4 |
| `src/mentions/types.ts` | F5 |
| `src/mentions/mentionProvider.ts` | F5 |
| `src/agent/diagnosticDiffTracker.ts` | F6 |
| `src/mcp/mcpTypes.ts` | F7 |
| `src/mcp/mcpClient.ts` | F7 |
| `src/mcp/mcpToolAdapter.ts` | F7 |
| `src/mcp/mcpConfigManager.ts` | F7 |
| `src/rules/ruleTypes.ts` | F8 |
| `src/rules/ruleLoader.ts` | F8 |
| `src/rules/ruleEvaluator.ts` | F8 |
| `src/hooks/hookTypes.ts` | F9 |
| `src/hooks/hookConfigLoader.ts` | F9 |
| `src/hooks/hookRunner.ts` | F9 |
| `src/streaming/streamingDiffParser.ts` | F10 |
| `src/knowledge/autoCollector.ts` | F11 |
| `src/browser/browserTypes.ts` | F12 |
| `src/browser/browserService.ts` | F12 |
| `src/browser/browserActions.ts` | F12 |

---

## npm 의존성 요약

| 패키지 | Feature | 용도 |
|---|---|---|
| `web-tree-sitter` | F4 | WASM tree-sitter 런타임 |
| `tree-sitter-wasms` | F4 | 사전 빌드 문법 파일 |
| `@modelcontextprotocol/sdk` | F7 | MCP 클라이언트 SDK |
| `yaml` | F8 | YAML frontmatter 파싱 |
| `puppeteer-core` | F12 | 헤드리스 브라우저 |

---

## 핫스팟 파일 (가장 많이 수정되는 파일)

| 파일 | 수정하는 Feature |
|---|---|
| `src/chat/chatPanel.ts` | F1, F2, F5, F6, F7, F8, F9, F10, F11 (9개) |
| `src/agent/engine.ts` | F1, F2, F3, F6, F7, F9 (6개) |
| `src/agent/executor.ts` | F1, F3, F9, F12 (4개) |
| `src/config/settings.ts` | F1, F12 (2개) |
| `src/prompts/builders/modePromptBuilder.ts` | F7, F8 (2개) |

---

## 검증
각 Feature 완료 시:
1. `npm run compile` — 타입 에러 없음
2. `npm test` — 기존 + 새 테스트 전체 통과
3. 수동 테스트 — 해당 기능 시나리오 확인
4. 회귀 테스트 — 기존 ask/plan/agent 모드 정상 동작 확인
