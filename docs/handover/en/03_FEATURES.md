# 03. Feature List

Implemented 12 features across 4 phases. All are currently in the "complete" status.

---

## Pre-existing Features (Phase 0)

Basic features that the project originally had.

### Chat (Ask/Plan/Agent modes)
- **Ask mode**: General Q&A
- **Plan mode**: Developing implementation plans (step-by-step design without writing code)
- **Agent mode**: Autonomous agent (file creation/modification/deletion, terminal execution)
- Files: `src/chat/chatPanel.ts`, `src/agent/engine.ts`

### Inline Completion (Ghost Text)
- AI suggests code while typing
- Tab to accept, Esc to ignore
- Files: `src/completion/inlineCompletionProvider.ts`

### Slash Commands (/skills)
- `/explain`, `/refactor`, `/fix`, `/test`, etc.
- Customizable definitions in markdown within the `.tokamak/skills/` folder
- Files: `src/chat/skillsManager.ts`

### @file mention
- Inject file content into context with `@filename` in chat
- Files: `src/chat/chatPanel.ts` (searchFiles)

### Right-click (Context Menu)
- "Explain Code" / "Refactor Code" / "Send to Chat"
- Files: `src/codeActions/codeActionProvider.ts`

### Multi-model Review/Debate
- Agent mode: coding review by separate model (review / red-team strategies)
- Plan mode: planning critique by separate model (debate / perspectives strategies)
- Auto-termination controlled by convergence calculation
- Files: `src/agent/engine.ts`, `src/agent/convergence.ts`

### Checkpoints
- Auto-save workspace state before running Agent
- Restorable on failure
- Files: `src/agent/checkpointManager.ts`

### 7 AI Providers
- Qwen, Minimax, GLM, OpenAI, Claude, Gemini, Generic (fallback)
- Abstracts model differences like vision support, token limits, and streaming options
- Files: `src/api/providers/`

---

## Phase 1: Agent Autonomy

### F1. Auto-Approval System

**Problem**: Clicking "Apply" for every file modification by Agent prevents it from being a fully autonomous agent.

**Solution**: Set auto-approval rules by tool/path/command.

| File | Role |
|------|------|
| `src/approval/autoApproval.ts` | `shouldAutoApprove()` pure function |
| `src/config/settings.ts` | `getAutoApprovalConfig()` |
| `src/__tests__/autoApproval.test.ts` | 22 tests |

**Configuration example** (VS Code Settings):
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

**Evaluation Flow**:
```
Global toggle → Tool level → Protected paths → Allowed paths → File size → Command whitelist
```

---

### F2. Context Window Auto-Compression

**Problem**: Conversations grow and exceed model context, leading to truncation or errors.

**Solution**: Summarize earlier messages via LLM when token usage exceeds 75%.

| File | Role |
|------|------|
| `src/context/contextCompressor.ts` | `needsCompression()`, `compressMessages()` |
| `src/utils/tokenEstimator.ts` | Token estimation (ASCII 0.25, CJK 1.5 tokens/char) |
| `src/__tests__/contextCompressor.test.ts` | 15 tests |

**Operation**: Preserve system message → preserve last N messages → summarize intermediate messages → return compressed history.

---

### F3. Terminal Feedback Loop

**Problem**: Sending raw output only when `npm test` fails doesn't let AI know exactly where errors are.

**Solution**: Extract structured error info with ecosystem-specific error parsers.

| File | Role |
|------|------|
| `src/agent/terminalOutputParser.ts` | Parser + `analyzeTerminalOutput()` |
| `src/__tests__/terminalOutputParser.test.ts` | 30 tests |

**Supported ecosystems**: TypeScript (tsc), Vitest/Jest, ESLint, npm, Python, Go

**Extracted info**:
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

## Phase 2: Code Intelligence

### F4. Tree-sitter AST Integration

**Problem**: Impossible to understand code structure without reading whole files.

**Solution**: Parse AST with Tree-sitter WASM → extract function/class definitions.

| File | Role |
|------|------|
| `src/ast/treeSitterService.ts` | WASM parser singleton (dynamic import) |
| `src/ast/definitionExtractor.ts` | AST → CodeDefinition[] extraction |
| `src/ast/types.ts` | CodeDefinition, FileOutline types |

**Usage**:
- `searcher.ts` — 15 points for AST definition name match (5x higher than default 3 points)
- `contextManager.ts` — Summarize large files with FileOutline (signatures only)
- `dependencyAnalyzer.ts` — AST-based import/export extraction (more accurate than regex)

**Supported languages**: TypeScript, JavaScript, Python, Go

> Automatically falls back to legacy regex if tree-sitter initialization fails.

---

### F5. Mention System Enhancement

**Problem**: Only `@file` was supported. Impossible to mention folders, symbols, error lists.

**Solution**: 4 mention types: `@file`, `@folder`, `@symbol`, `@problems`.

| File | Role |
|------|------|
| `src/mentions/mentionProvider.ts` | `parseQuery()`, `getSuggestions()`, `resolve()` |
| `src/mentions/types.ts` | MentionType, MentionQuery, MentionResult |

**Usage Examples**:
```
@file:src/agent/engine.ts    → Injects file content
@folder:src/api/             → File list + summary of directory
@symbol:AgentEngine          → Source code of specified symbol definition
@problems                    → List of current VS Code diagnostics (errors/warnings)
```

---

### F6. Diagnostic-Based Auto-Fix

**Problem**: No detection of new errors after editing. Only checks absolute diagnostic counts.

**Solution**: Compare diagnostic snapshots before/after editing to extract newly introduced errors.

| File | Role |
|------|------|
| `src/agent/diagnosticDiffTracker.ts` | `captureSnapshot()`, `diff()`, `shouldAutoFix()` |

**Fingerprinting**: `file:message:code` (ignoring line number — lines shift during editing).

**Auto-fix condition**: Attempts auto-fix if new errors < 10, skip more than that.

---

## Phase 3: Extensibility

### F7. MCP Client (Model Context Protocol)

**Problem**: AI cannot use external tools (DB, API, etc.). Dependent only on LiteLLM API.

**Solution**: Communicate with external tool servers using MCP protocol.

| File | Role |
|------|------|
| `src/mcp/mcpClient.ts` | `connect()`, `listTools()`, `callTool()` |
| `src/mcp/mcpConfigManager.ts` | `.tokamak/mcp.json` loading + file watching |
| `src/mcp/mcpToolAdapter.ts` | MCP tools → prompt description formatting |
| `src/mcp/mcpTypes.ts` | McpServerConfig, McpTool, McpToolResult |

**Configuration file** (`.tokamak/mcp.json`):
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

**Command**: `Cmd+Shift+P` → "Tokamak: Configure MCP Servers"

---

### F8. Rule System

**Problem**: Impossible to enforce project-specific coding conventions for AI.

**Solution**: Define conditional rules with `.tokamak/rules/*.md` files.

| File | Role |
|------|------|
| `src/rules/ruleLoader.ts` | YAML frontmatter parsing + file watching |
| `src/rules/ruleEvaluator.ts` | `getActiveRules()`, `matchesCondition()` |
| `src/rules/ruleTypes.ts` | Rule, RuleCondition types |
| `src/__tests__/ruleEvaluator.test.ts` | 10 tests |

**Rule file example** (`.tokamak/rules/ts-conventions.md`):
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

**Condition matching**: `languages` (current file), `modes` (current mode), `filePatterns` (glob).

**Command**: `Cmd+Shift+P` → "Tokamak: Initialize Rules Folder"

---

### F9. Hooks System

**Problem**: Impossible to perform custom validation/logging/automation before/after tool execution.

**Solution**: Execute shell commands as Pre/Post hooks. Blocking option available to halt execution.

| File | Role |
|------|------|
| `src/hooks/hookRunner.ts` | child_process spawn + JSON stdin/stdout |
| `src/hooks/hookConfigLoader.ts` | `.tokamak/hooks.json` loading + file watching |
| `src/hooks/hookTypes.ts` | HookEvent, HookConfig, HookInput, HookResult |

**Hook events**: `PreToolUse`, `PostToolUse`, `PreApproval`, `PostApproval`, `PreMessage`, `PostMessage`

**Execution points**:
- `executor.ts` — PreToolUse / PostToolUse (around all tool executions)
- `engine.ts` — PreApproval / PostApproval (around agent action executions)
- `chatPanel.ts` — PreMessage / PostMessage (around user messages)

**Configuration file** (`.tokamak/hooks.json`):
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

## Phase 4: UX Polish

### F10. Streaming Diff Display

**Problem**: Impossible to verify file changes until AI response is complete.

**Solution**: Incrementally parse `<<<FILE_OPERATION>>>` markers during streaming.

| File | Role |
|------|------|
| `src/streaming/streamingDiffParser.ts` | `feed(chunk)` → operation detection |
| `src/__tests__/streamingDiffParser.test.ts` | 10 tests |

**State machine**: `detecting` → `type` → `path` → `description` → `content` → `complete`.

**Hold-back buffer**: 19 bytes (handles markers split across chunk boundaries).

---

### F11. Project Knowledge Auto-Collection

**Problem**: Needs manual creation of `.tokamak/knowledge/` files. "Cold start" issue.

**Solution**: Automatically extract from `package.json`, `tsconfig.json`, `README.md`, etc.

| File | Role |
|------|------|
| `src/knowledge/autoCollector.ts` | `collect()`, `formatForPrompt()` |
| `src/__tests__/autoCollector.test.ts` | 12 tests |

**Targets**: package.json (name, scripts, dependencies), tsconfig, README (first 500 chars), Dockerfile, pyproject.toml, Cargo.toml.

**Operation**: Auto-collect on first message → merge with manual knowledge files → inject into prompt.

---

### F12. Browser Automation

**Problem**: Impossible to test/debug web apps or capture screenshots.

**Solution**: Control headless browser with puppeteer-core.

| File | Role |
|------|------|
| `src/browser/browserService.ts` | `launch()`, `execute()`, `close()` |
| `src/browser/browserActions.ts` | `parseBrowserAction()`, `formatBrowserResult()`, `getBrowserActionDocs()` |
| `src/browser/browserTypes.ts` | BrowserAction, BrowserResult, BrowserConfig |

**Actions supported**: `navigate`, `screenshot`, `click`, `type`, `evaluate`, `close`.

**Setup**: Requires `tokamak.enableBrowser: true` + `npm install puppeteer-core`.

> puppeteer-core is optional. Falls back to graceful degradation (returning error messages) if not installed.

---

## Dependency Graph

```
Phase 1 (can be implemented standalone):
  F1 Auto-Approval ──── standalone
  F2 Context Compression ── standalone
  F3 Terminal Feedback ──── standalone

Phase 2 (F4 first):
  F4 Tree-sitter ──── standalone
  F5 Mentions ─────── @symbol depends on F4 (soft)
  F6 Diagnostic Diff ── standalone

Phase 3 (using F1):
  F7 MCP ──────────── uses F1 approval (during MCP tool execution)
  F8 Rules ────────── standalone
  F9 Hooks ────────── runs at F1 approval points

Phase 4 (can be implemented standalone):
  F10 Streaming Diff ── standalone
  F11 Auto Knowledge ── standalone
  F12 Browser ───────── uses F1 approval (during browser actions)
```

## Test Mapping

| Feature | Test file | Test count |
|---------|-----------|------------|
| F1 | `autoApproval.test.ts` | 22 |
| F2 | `contextCompressor.test.ts` | 15 |
| F3 | `terminalOutputParser.test.ts` | 30 |
| F8 | `ruleEvaluator.test.ts` | 10 |
| F10 | `streamingDiffParser.test.ts` | 10 |
| F11 | `autoCollector.test.ts` | 12 |
| legacy | `engine-review.test.ts` | 12 |
| legacy | `promptBuilders.test.ts` | 44 |
| legacy | `fileOperationParser.test.ts` | 15 |
| legacy | `contentUtils.test.ts` | 34 |
| legacy | `convergence.test.ts` | 23 |
| legacy | `planner.test.ts` | 13 |
| legacy | `providerCapabilities.test.ts` | 41 |
| legacy | `providerRegistry.test.ts` | 16 |
| **Total** | **14 files** | **297** |
