# Change Log

## [0.1.3] - 2026-03-03

### Added
- **F4: Tree-sitter AST Integration** — WASM-based code parsing for TS/JS/Python/Go, definition extraction, file outline generation
- **F5: Mention System** — @file, @folder, @symbol, @problems mention support with autocomplete
- **F6: Diagnostic Diff Tracker** — Before/after diagnostic snapshot comparison for smart auto-fix
- **F7: MCP Client** — Model Context Protocol support for external tool integration (stdio/sse/http)
- **F8: Rule System** — Project-specific coding rules with YAML frontmatter and conditional activation
- **F9: Hooks System** — Pre/PostToolUse, Pre/PostApproval, Pre/PostMessage event hooks
- **F10: Streaming Diff Parser** — Real-time FILE_OPERATION detection during AI streaming
- **F11: Auto Knowledge Collector** — Automatic project info extraction from package.json, tsconfig, etc.
- **F12: Browser Automation** — Puppeteer-based browser control (navigate, screenshot, click, type, evaluate)
- Handover documentation (docs/handover/)

### Fixed
- F4 integration: Tree-sitter properly wired into searcher (15pt AST score), contextManager (outline), dependencyAnalyzer
- F9 integration: PreApproval/PostApproval hooks added to engine.ts
- F12 integration: Browser stub replaced with real BrowserService in executor.ts
- Infinite review loop fix in agent engine

## [0.1.2] - 2026-02-28

### Added
- **F1: Auto-Approval System** — Configurable auto-approval for file/terminal operations with glob/command matching
- **F2: Context Window Compression** — Automatic conversation compression at 75% context usage
- **F3: Terminal Feedback Loop** — Ecosystem-specific error parsing (TypeScript, Vitest, npm, Python, Go)
- Multi-model review and debate system (review/red-team, debate/perspectives strategies)
- Model-specific Provider classes (Qwen, Minimax, GLM, OpenAI, Claude, Gemini, Generic)
- Provider Registry for automatic model-to-provider matching
- Model-specific PromptHints and prompt optimization
- Convergence calculation for review/debate

### Fixed
- Terminal error parsing accuracy improvements
- Context compression threshold tuning

## [0.1.1] - 2026-02-14

### Added
- Agent state machine (Planning → Executing → Observing → Reflecting → Fixing)
- SEARCH/REPLACE 4-tier matching (exact, line-trimmed, block anchor, full-file)
- Checkpoint save/restore system
- Dependency analyzer for import/export graphs
- Token usage tracking and display

## [0.1.0] - 2026-02-07

### Added
- AI Chat with Ask/Plan/Agent modes
- Inline code completion (Ghost Text)
- File attachment via @mention and drag & drop
- Slash commands (/explain, /refactor, /fix, /test, /docs, /optimize, /security)
- Custom skills support (.tokamak/skills/)
- Agent mode with file operations (create/edit/delete)
- Diff preview for file operations
- Terminal command execution from chat
- Chat history persistence
- Project structure context for AI
- Send selected code to chat
- Code explanation and refactoring via context menu
