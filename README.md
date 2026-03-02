# Tokamak AI Agent

A VS Code Extension that brings the company's internal AI models (LiteLLM-based OpenAI-compatible API) directly into your development workflow — featuring an autonomous agent with file operations, multi-model review, and extensible tool system.

**Version:** 0.1.3 | **Tests:** 297 | **Supported Models:** Qwen, GLM, Minimax, OpenAI, Claude, Gemini

---

## Quick Start (Installation)

### 1. Download & Install via VSIX
You can easily install the extension using the pre-built VSIX file without building it from source.

1. Download the `.vsix` file from the [GitHub Releases](https://github.com/tokamak-network/tokamak-ai-agent/releases).
2. In VS Code, open the **Extensions** view (`Cmd+Shift+X`).
3. Click the **More Actions...** (three dots) menu in the top-right corner of the Extensions view.
4. Select **Install from VSIX...**.
5. Select the downloaded `.vsix` file.

### 2. Build from Source (For Developers)

```bash
# Install dependencies
npm install

# Run tests (297 tests)
npm test

# Bundle for packaging
npm run bundle

# Package as VSIX
npm run package

# Or debug in VS Code: press F5
```

---

## API Configuration

Open Settings (`Cmd+,` on Mac / `Ctrl+,` on Windows) and search for `tokamak`.

### Basic Settings

| Setting | Description | Required |
|------|------|:----:|
| `tokamak.apiKey` | AI Service API Key | ✅ |
| `tokamak.models` | List of available models | - |
| `tokamak.selectedModel` | Currently selected model | - |
| `tokamak.enableInlineCompletion` | Enable/Disable Ghost Text auto-completion | - |
| `tokamak.completionDebounceMs` | Auto-completion delay (default 300ms) | - |

### Agent & Automation Settings

| Setting | Description | Default |
|------|------|:----:|
| `tokamak.enableCheckpoints` | Enable checkpoint save/restore | `false` |
| `tokamak.enableMultiModelReview` | Enable multi-model code review | `false` |
| `tokamak.enableBrowser` | Enable browser automation | `false` |
| `tokamak.autoApproval.enabled` | Enable auto-approval for agent actions | `false` |
| `tokamak.autoApproval.tools.*` | Per-tool approval level (always_allow / ask / deny) | varies |
| `tokamak.autoApproval.allowedPaths` | Glob patterns for auto-approved paths | `[]` |
| `tokamak.autoApproval.protectedPaths` | Glob patterns for always-confirm paths | `[]` |
| `tokamak.autoApproval.allowedCommands` | Allowed terminal command patterns | `[]` |

**Example settings.json:**
```json
{
  "tokamak.apiKey": "your-api-key",
  "tokamak.models": [
    "qwen3-235b",
    "qwen3-80b-next",
    "minimax-m2.5",
    "glm-4.7",
    "gpt-4o",
    "claude-sonnet-4-20250514",
    "gemini-2.0-flash"
  ],
  "tokamak.selectedModel": "qwen3-235b",
  "tokamak.enableMultiModelReview": true,
  "tokamak.autoApproval.enabled": true,
  "tokamak.autoApproval.tools.read_file": "always_allow",
  "tokamak.autoApproval.tools.write_file": "ask",
  "tokamak.autoApproval.allowedCommands": ["npm test", "npm run *"]
}
```

---

## Core Features

### 1. AI Chat (3 Modes)

**Open Chat:** `Cmd+Shift+I` (Mac) / `Ctrl+Shift+I` (Windows)

```
┌─────────────────────────────────────┐
│ [💬 Ask] [📋 Plan] [🤖 Agent]       │
└─────────────────────────────────────┘
```

#### 💬 Ask Mode (Default)
Classic Q&A interaction. Best for simple questions and explanations.

#### 📋 Plan Mode
Architectural planning — provides structured implementation steps **without writing code**.

#### 🤖 Agent Mode
Autonomous AI agent that can:
- **Create, edit, delete files** with diff preview
- **Run terminal commands** and parse errors automatically
- **Search codebase** with AST-aware ranking
- **Use external tools** via MCP protocol
- **Control browsers** via Puppeteer
- **Self-fix** based on diagnostic feedback

**Agent Workflow:**
```
Planning → Executing → Observing → Reflecting → Fixing (if needed)
                                                   ↓
                                            Reviewing (optional multi-model review)
```

---

### 2. File Attachment (@mention)

Type `@` in the input field to reference project files, folders, symbols, or diagnostics.

| Mention Type | Example | Description |
|------|------|------|
| `@file` | `@chatPanel.ts` | Attach file contents |
| `@folder` | `@src/agent/` | Attach folder structure |
| `@symbol` | `@AgentEngine` | Attach symbol definition (requires Tree-sitter) |
| `@problems` | `@problems` | Attach current VS Code diagnostics |

```
┌─────────────────────────────────────┐
│  📄 extension.ts        src/        │  ← Suggestions
│  📁 agent/              src/        │
│  🔷 AgentEngine         engine.ts   │
│  ⚠️ problems           3 errors     │
└─────────────────────────────────────┘
```

---

### 3. Slash Commands (Skills)

Type `/` in the input field to access quick actions.

| Command | Description |
|------|------|
| `/explain` | Explain code |
| `/refactor` | Suggest refactoring |
| `/fix` | Find and fix bugs |
| `/test` | Generate unit tests |
| `/docs` | Add documentation |
| `/optimize` | Optimize performance |
| `/security` | Security audit |

#### Custom Skills

Create project-specific skills in `.tokamak/skills/`:

```
Cmd+Shift+P → "Tokamak: Initialize Skills Folder"
```

```markdown
<!-- .tokamak/skills/review.md -->
---
description: Senior developer code review
---

Review this code for:
1. Code quality and best practices
2. Potential bugs or edge cases
3. Security issues
```

---

### 4. Auto-Approval System

Configure which agent actions are automatically approved vs. require confirmation.

| Tool | Default | Description |
|------|------|------|
| `read_file` | always_allow | Reading files |
| `search` | always_allow | Searching codebase |
| `write_file` | ask | Writing/editing files |
| `create_file` | ask | Creating new files |
| `delete_file` | ask | Deleting files |
| `terminal_command` | ask | Running terminal commands |

- **Path-based rules:** Auto-approve `src/test/**` but protect `src/config/**`
- **Command patterns:** Auto-approve `npm test` but require confirmation for `rm *`

---

### 5. Context Window Compression

Automatic conversation compression when context usage exceeds 75%.

- Preserves recent messages intact
- Summarizes older conversation history via LLM
- Displays context usage indicator in UI
- Prevents context overflow crashes

---

### 6. Terminal Feedback Loop

When terminal commands fail, the agent automatically parses errors and attempts fixes.

**Supported ecosystems:**
- TypeScript (`tsc` errors with file/line/column)
- Vitest (test failures with stack traces)
- npm (dependency errors)
- Python (tracebacks)
- Go (compile errors)

---

### 7. Tree-sitter AST Integration

WASM-based code parsing for intelligent code understanding.

- **Languages:** TypeScript, JavaScript, Python, Go
- **Used for:** Symbol search (`@symbol`), smart file outline, dependency analysis
- **Graceful degradation:** Falls back to regex if Tree-sitter unavailable

---

### 8. Multi-Model Review & Debate

Optional code quality verification using a separate AI model.

| Strategy | Description |
|------|------|
| `review` | Second model reviews code changes for bugs/quality |
| `red-team` | Second model adversarially critiques the implementation |
| `debate` | Second model debates the plan approach |
| `perspectives` | Second model provides alternative viewpoints |

Enable in settings: `tokamak.enableMultiModelReview: true`

---

### 9. Project Rules System

Define project-specific coding rules in `.tokamak/rules/`:

```yaml
# .tokamak/rules/ts-conventions.md
---
description: TypeScript conventions
condition:
  languages: [typescript, typescriptreact]
  modes: [agent]
priority: 10
---
- Use strict TypeScript. No `any`.
- Prefer `interface` over `type` for object shapes.
- All functions must have explicit return types.
```

Rules are conditionally activated based on language, mode, and file path.

---

### 10. Hooks System

Execute custom scripts before/after agent actions via `.tokamak/hooks.json`:

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "command": "node ./scripts/validate.js",
      "toolFilter": ["write_file"],
      "blocking": true,
      "timeout": 30000
    }
  ]
}
```

**Events:** `PreToolUse`, `PostToolUse`, `PreApproval`, `PostApproval`, `PreMessage`, `PostMessage`

---

### 11. MCP (Model Context Protocol) Support

Connect external tools and services via the MCP protocol.

Configure in `.tokamak/mcp.json`:

```json
{
  "servers": [
    {
      "name": "database",
      "transport": "stdio",
      "command": "node",
      "args": ["./mcp-servers/db-server.js"],
      "enabled": true
    }
  ]
}
```

MCP tools appear in the agent's available actions and can be called during autonomous execution.

---

### 12. Browser Automation

Puppeteer-based browser control for web app testing and debugging.

**Actions:** navigate, screenshot, click, type, evaluate JavaScript, close

Enable in settings: `tokamak.enableBrowser: true`

Requires `puppeteer-core` to be installed in the project.

---

### 13. Inline Completion (Ghost Text)

Real-time code suggestions as you type, similar to GitHub Copilot.

- Press `Tab` to accept, `Esc` to dismiss
- Disable: `tokamak.enableInlineCompletion: false`

---

### 14. Streaming Diff Display

See file changes in real-time as the AI generates them, before the response is complete.

---

### 15. Auto Knowledge Collection

Automatically extracts project context from standard files (`package.json`, `tsconfig.json`, `README.md`, etc.) — no manual `.tokamak/knowledge/` setup needed for basic project info.

---

## Commands

| Command | Shortcut | Description |
|--------|--------|------|
| Tokamak: Open Chat | `Cmd+Shift+I` | Open the AI chat panel |
| Tokamak: Send to Chat | - | Send selected code to chat |
| Tokamak: Explain Code | - | Get an explanation of the selection |
| Tokamak: Refactor Code | - | Refactor the selected code |
| Tokamak: Clear Chat History | - | Delete previous messages |
| Tokamak: Initialize Skills Folder | - | Create the custom skills directory |
| Tokamak: Initialize Knowledge Folder | - | Create the knowledge directory |
| Tokamak: Initialize Rules | - | Create the rules directory |
| Tokamak: Configure MCP | - | Open MCP server configuration |

---

## Project Configuration

```
.tokamak/
├── skills/         — Slash commands (/explain, /fix, custom)
│   ├── explain.md
│   ├── refactor.md
│   └── ...
├── knowledge/      — Project knowledge (auto-injected into AI context)
│   └── conventions.md
├── rules/          — Coding rules (conditionally activated)
│   └── ts-conventions.md
├── mcp.json        — MCP server configuration
└── hooks.json      — Pre/Post hook configuration
```

---

## Troubleshooting

### API Connection Error
- Check if the LiteLLM server is running.
- Verify the model name in settings.
- Check your network/VPN status.

### Chat Panel Not Opening
- Use `Cmd+Shift+P` → "Tokamak: Open Chat" manually.
- Check if the extension is enabled in the Extensions view.

---

## Tech Stack

| Category | Technology |
|------|------|
| Language | TypeScript (strict, Node16 modules) |
| Build | esbuild (bundle) + tsc (type check) |
| Test | Vitest (297 tests) |
| API | OpenAI Node.js SDK (LiteLLM compatible) |
| AST | web-tree-sitter (WASM) |
| Config | YAML (rules), JSON (MCP, hooks) |
| Browser | puppeteer-core (optional) |
| Packaging | vsce |
