# 02. Architecture

## Overall Structure

```
┌─────────────────────────────────────────────────────┐
│                   extension.ts                       │
│           (Command Registration, Activation)         │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │    chat/chatPanel.ts     │  ← Hub for all subsystems
          │    (~2,300 lines)        │
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
     │        Extension Modules (Phase 1~4)       │
     ├────────────────────────────────────┤
     │ approval/   — Auto-approval        │
     │ context/    — Context compression   │
     │ ast/        — Tree-sitter AST      │
     │ rules/      — Project rules         │
     │ hooks/      — Pre/Post hooks       │
     │ mcp/        — MCP client            │
     │ knowledge/  — Auto knowledge collection  │
     │ browser/    — Browser automation    │
     └────────────────────────────────────┘
```

## Hotspot Files (Most frequently modified files)

| File | Line Count | Role | Connected Module |
|------|------------|------|------------------|
| `chat/chatPanel.ts` | ~2,300 | Chat UI Hub | Almost everything |
| `agent/engine.ts` | ~1,400 | Agent State Machine | executor, planner, observer, approval, hooks |
| `agent/executor.ts` | ~780 | File/terminal execution | hooks, browser, contentUtils |
| `chat/webviewContent.ts` | ~2,500 | HTML/CSS/JS UI | None (Independent HTML generation) |

---

## Agent State Machine

The core of Agent mode is the state machine in `engine.ts`.

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
                     Optional ──────────────┤
                                            ▼
                                     ┌──────────────┐
                                     │  Reviewing   │  (Multi-model Review)
                                     │  Debating    │  (Multi-model Debate)
                                     └──────────────┘
```

### Role of Each State

| State | File Location | Activity |
|-------|---------------|----------|
| **Planning** | `engine.ts:handlePlanning()` | Decomposing user request into `PlanStep[]` |
| **Executing** | `engine.ts:handleExecution()` | Executing PlanStep actions via `executor` |
| **Observing** | `engine.ts:handleObservation()` | Collecting execution results + VS Code diagnostics |
| **Reflecting** | `engine.ts:handleReflection()` | AI evaluates results, decides next action |
| **Fixing** | `engine.ts:handleFixing()` | Generating error fix code, re-executing |
| **Reviewing** | `engine.ts:handleReview()` | Independent model performs code review (review/red-team strategy) |
| **Debating** | `engine.ts:handleDebate()` | Independent model critiques project planning (debate/perspectives strategy) |

---

## Module Details

### 1. `src/chat/` — Chat UI Layer

```
chatPanel.ts        ← central hub. processing messages, streaming, applying file operations
webviewContent.ts   ← HTML/CSS/JS generation (VS Code Webview)
fileOperationParser.ts ← parsing FILE_OPERATION blocks from AI responses
skillsManager.ts    ← loading /slash commands (.tokamak/skills/*.md)
```

**chatPanel.ts Flow:**
```
User Message
    │
    ▼
Mention Interpretation (@file → injecting file content)
    │
    ▼
Project Knowledge Collection (package.json, etc.)
    │
    ▼
System Prompt Assembly (per mode + rules + MCP tools list)
    │
    ▼
Context Compression Check (summarizing if > 75%)
    │
    ▼
AI Streaming Call (streamChatCompletion)
    │
    ▼
While Streaming: Real-time detection of file operations via StreamingDiffParser
    │
    ▼
After Response Complete: Parse FILE_OPERATION → auto-approve / user confirmation
    │
    ▼
PostMessage Hooks execution
```

### 2. `src/agent/` — Agent Engine

```
engine.ts              ← State machine (explained above)
executor.ts            ← Actual execution (file writing, terminal, browser)
planner.ts             ← parsing AI Response → PlanStep[]
observer.ts            ← collecting VS Code diagnostic information
searcher.ts            ← keyword/AST-based file search (weighted ranking)
contextManager.ts      ← assembling context based on token budget
dependencyAnalyzer.ts  ← import/export dependency graph
checkpointManager.ts   ← saving/restoring checkpoints
convergence.ts         ← computing review/debate convergence
summarizer.ts          ← file summarization
terminalOutputParser.ts ← parsing terminal errors (npm, vitest, tsc, etc.)
diagnosticDiffTracker.ts ← comparing diagnostics before/after edit
types.ts               ← defining types (AgentState, AgentAction, PlanStep, etc.)
```

**executor.ts Action types:**
```typescript
type AgentAction =
  | 'write'        // File writing (SEARCH/REPLACE or full overwrite)
  | 'multi_write'  // Atomic multi-file writing
  | 'read'         // File reading
  | 'run'          // Terminal command execution
  | 'search'       // Searching file content
  | 'delete'       // File deletion
  | 'mcp_tool'     // External MCP tool call
  | 'browser'      // Browser automation
```

**4-Level SEARCH/REPLACE matching (following Cline):**
1. Exact match — exact string match
2. Line-trimmed — ignore leading/trailing whitespace
3. Block anchor — block match using first/last line as anchors
4. Full-file search — re-search in entire file

### 3. `src/api/` — AI Model Communication

```
client.ts              ← streamChatCompletion(), isVisionCapable()
types.ts               ← ChatMessage, TokenUsage, StreamResult
providers/
  IProvider.ts         ← interface definition
  BaseProvider.ts      ← common logic (streaming, retry, image handling)
  ProviderRegistry.ts  ← Model name → Provider mapping (singleton)
  QwenProvider.ts      ← Qwen model (thinking mode support)
  MinimaxProvider.ts   ← Minimax model
  GlmProvider.ts       ← GLM model
  OpenAIProvider.ts    ← GPT model
  ClaudeProvider.ts    ← Claude model (vision support)
  GeminiProvider.ts    ← Gemini model (vision support)
  GenericProvider.ts   ← default fallback
```

**Provider Pattern:**
```typescript
// Auto-selecting appropriate Provider by model name
const registry = getRegistry();
const provider = registry.resolve('qwen3-235b'); // → QwenProvider
const provider = registry.resolve('gpt-4o');     // → OpenAIProvider

// Provider abstracts differences between models
provider.getCapabilities(model); // { vision, streamUsage, thinking, ... }
provider.getDefaults(model);     // { temperature, maxTokens, ... }
provider.streamChat(model, messages);
```

### 4. `src/prompts/` — Prompt Builder

```
index.ts                        ← public API (re-export)
types.ts                        ← PromptContext, ChatMode, PromptHints
builders/
  modePromptBuilder.ts          ← mode-specific system prompt (ask/plan/agent)
  agentSystemPrompt.ts          ← detailed prompt for Agent mode only
  reviewPromptBuilder.ts        ← code review prompt
  debatePromptBuilder.ts        ← plan critique prompt
components/
  rules.ts                      ← default rules (hardcoded)
  fileOperationFormat.ts        ← FILE_OPERATION format explanation
  jsonVerdictFormat.ts          ← JSON response format for Review/Debate
  _helpers.ts                   ← shared helpers
variants/
  resolver.ts                   ← interpreting prompt hints per model
  standard.ts / compact.ts      ← prompt variants
```

**PromptContext (context injected into system prompts):**
```typescript
interface PromptContext {
  mode: ChatMode;
  variant: PromptVariant;
  contextTier: ContextTier;
  hints: PromptHints;
  activeRules?: string;        // F8: project rules
  mcpToolsSection?: string;    // F7: MCP tool list
  browserActionDocs?: string;  // F12: browser action explanation
}
```

### 5. Extension Modules (Phase 1~4)

Each module is designed **independently** and is imported/used in `chatPanel.ts` or `engine.ts`.

| Module | File | Pure Function? | VS Code Dependency? |
|--------|------|----------------|---------------------|
| `approval/` | autoApproval.ts | Yes | No |
| `context/` | contextCompressor.ts | Yes | No |
| `ast/` | treeSitterService.ts, definitionExtractor.ts, types.ts | Partial | No |
| `mentions/` | mentionProvider.ts, types.ts | No | Yes |
| `rules/` | ruleLoader.ts, ruleEvaluator.ts, ruleTypes.ts | Partial | Yes (Loader only) |
| `hooks/` | hookRunner.ts, hookConfigLoader.ts, hookTypes.ts | Partial | Yes (Loader only) |
| `mcp/` | mcpClient.ts, mcpConfigManager.ts, mcpToolAdapter.ts, mcpTypes.ts | Partial | Yes (Manager only) |
| `knowledge/` | autoCollector.ts | Yes | No |
| `streaming/` | streamingDiffParser.ts | Yes | No |
| `browser/` | browserService.ts, browserActions.ts, browserTypes.ts | Partial | No |

> **Pure functions = testable**: modules without VS Code dependencies can be tested directly with Vitest.
> Modules dependent on VS Code require mocks; therefore, integration tests take place in the Extension Development Host.

---

## Data Flow

### Ask Mode

```
User Input → chatPanel.handleUserMessage()
    → buildModePrompt('ask', context)
    → streamChatCompletion(messages)
    → Display streaming response
```

### Agent Mode

```
User Input → chatPanel.handleUserMessage()
    → new AgentEngine(context)
    → engine.run()
        → handlePlanning()    : AI → PlanStep[]
        → handleExecution()   : PlanStep → executor.execute(action)
        → handleObservation() : diagnosticDiffTracker.diff()
        → handleReflection()  : AI → decide next action
        → handleFixing()      : fixing errors + generating code
        → (Optional) handleReview() : review by independent model
    → Callback result to chatPanel
    → FILE_OPERATION → pendingOperations
    → User Apply / Reject
```

### File Modification Flow

```
AI Response: "<<<FILE_OPERATION>>> ... <<<END_OPERATION>>>"
    │
    ▼
fileOperationParser.parseFileOperations(response)
    → FileOperation[] (type, path, content)
    │
    ▼
Auto-approval check (shouldAutoApprove)
    ├── Auto-approve → executor.execute()
    └── Manual → Display Pending Operations in UI
                  │
                  ├── Apply → executor.writeFile() / deleteFile()
                  └── Reject → ignore
```

---

## Configuration File Structure

### VS Code Settings (defined in `package.json`)

```
tokamak.apiKey                          — API Key
tokamak.models                          — Model list
tokamak.selectedModel                   — Currently selected model
tokamak.enableInlineCompletion          — Enable Ghost Text
tokamak.enableCheckpoints               — Enable checkpoints
tokamak.enableMultiModelReview          — Multi-model review
tokamak.enableBrowser                   — Browser automation
tokamak.autoApproval.enabled            — Enable auto-approval
tokamak.autoApproval.tools.*            — Approval level by tool
tokamak.autoApproval.allowedPaths       — Allowed paths glob
tokamak.autoApproval.protectedPaths     — Protected paths glob
tokamak.autoApproval.allowedCommands    — Allowed command patterns
```

### Project-specific Settings (`.tokamak/` folder)

```
.tokamak/
├── skills/         — slash commands (/explain, /fix, etc.)
│   ├── explain.md
│   ├── refactor.md
│   └── ...
├── knowledge/      — project knowledge (auto-injected into AI context)
│   └── conventions.md
├── rules/          — coding rules (conditional activation)
│   └── ts-conventions.md
├── mcp.json        — MCP server configuration
└── hooks.json      — Pre/Post hook configuration
```
