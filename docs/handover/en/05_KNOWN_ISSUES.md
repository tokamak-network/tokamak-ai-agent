# 05. Known Issues & Future Tasks

## Known Limitations

### 1. Bloated `chatPanel.ts`

- **Current Status**: ~2,300 lines. All subsystems converge here.
- **Impact**: Modifications to this file are constantly needed when adding new features.
- **Direction for Improvement**: Separate message handling, streaming, and file operation application into separate classes.

### 2. Tree-sitter WASM File Deployment

- **Current Status**: `web-tree-sitter` package is installed, but language-specific WASM files (e.g., `tree-sitter-typescript.wasm`) may not be included in the bundle.
- **Impact**: Falls back to regex if tree-sitter initialization fails (reduced functionality).
- **Direction for Improvement**: Automate WASM asset copying in esbuild configuration or manually place them in a `parsers/` folder.

### 3. MCP SDK Not Included

- **Current Status**: `@modelcontextprotocol/sdk` is not in package.json dependencies.
- **Impact**: Dynamic import fails → MCP feature disabled.
- **Resolution**: Run `npm install @modelcontextprotocol/sdk` if needed.

### 4. `puppeteer-core` Not Included

- **Current Status**: Present in package.json numerically but is optional.
- **Impact**: Browser automation fails if Chrome/Chromium is not in the system.
- **Resolution**: Specify browser path with `executablePath` setting.

### 5. Test Coverage Constraints

- **Current Status**: Unit tests for modules dependent on `vscode` are not possible.
- **Impact**: Core files like `chatPanel`, `engine`, and `executor` lack auto-testing.
- **Direction for Improvement**: Introduce a vscode API mock library or add an E2E test framework (`@vscode/test-electron`).

### 6. Error Handling

- **Current Status**: Most errors use `catch {}` (ignored) or `catch { /* fallback */ }` patterns.
- **Impact**: Difficult to identify causes when debugging.
- **Direction for Improvement**: Record errors with at least `logger.warn()`.

---

## Technical Debt

### Type Safety

- `action.payload` in `executor.ts` uses `any`.
- puppeteer instance in `browserService.ts` uses `any`.
- entire `treeSitterService.ts` uses `any` (compatibility issues with web-tree-sitter types).

### `webviewContent.ts`

- ~2,500 lines of inline HTML/CSS/JS.
- Direct DOM manipulation without a frontend framework.
- Consider CSS/JS separation or adopting React/Svelte.

### `engine.ts` Complexity

- ~1,400 lines with 13 states and 10+ handler methods.
- Concentrated logic for multi-model Review/Debate in a single file.
- Improve readability by separating Review/Debate into separate classes.

---

## Future Improvement Ideas

### UI/UX Improvements (Top Priority)

Feedback suggests current UI is cumbersome. `webviewContent.ts` being 2,250 lines of inline HTML/CSS/JS makes maintenance difficult.

#### 1. Chat Input UX

| Problem | Current Status | Direction for Improvement |
|---------|----------------|---------------------------|
| Small input box | Fixed at `min-height: 40px`, `max-height: 150px` | Auto-height adjustment + fullscreen input mode (Shift+Enter expansion like Cursor) |
| Difficult to paste long code | small textarea prevents previews | collapsible preview for code pastes |
| Simple mention autocomplete | only detects `@`, no categories | category tabs for `@file:`, `@folder:`, `@symbol:` + fuzzy search |
| Small image attachments | 80x80px thumbnails | click-to-expand preview |

#### 2. Response Display

| Problem | Current Status | Direction for Improvement |
|---------|----------------|---------------------------|
| Insufficient feedback during streaming | "AI is thinking..." text + dot animation only | typing cursor effect + elapsed time + real-time token count |
| No syntax highlighting in code blocks | only `<pre><code>` used | apply highlight.js or Shiki (VS Code theme matching) |
| Cumbersome scrolling for long responses | only auto-scroll present, cannot return to middle | "Go to bottom" floating button + scroll position memory + TOC navigation |
| Poor markdown rendering | only basic parsing | support for tables, checklists, mermaid diagrams |

#### 3. Pending File Operations Panel

| Problem | Current Status | Direction for Improvement |
|---------|----------------|---------------------------|
| No diff preview | "Preview" button → move to VS Code diff editor | inline diff view (green for additions, red for deletions) displayed within webview |
| Global apply/reject only | two buttons: Apply All / Reject All | per-file checkboxes + selective application |
| Difficult to grasp changes | file path + type (CREATE/EDIT/DELETE) only | show lines changed (`+15 -3`), file size, affected tests |
| Fixed at bottom of chat | overlaps with chat scroll | separate side panel or tab + drag resize |

#### 4. Mode/Settings Area

| Problem | Current Status | Direction for Improvement |
|---------|----------------|---------------------------|
| Complex header | Model selection, mode tabs, review strategy, and checkboxes all in one place | default: show model/mode only, advanced settings in gear icon → dropdown panel |
| No feedback on mode switching | only tab color changes | tooltips for mode explanation + onboarding overlay for first-time use |
| Invisible Agent status | `agent-status-badge` hidden inside Plan panel | always show status badge in header (Planning → Executing → Observing...) |

#### 5. Session History

| Problem | Current Status | Direction for Improvement |
|---------|----------------|---------------------------|
| Pushed by side panel | `position: fixed; left: -300px` slide-in | independent panel by clicking icon, like VS Code Activity Bar |
| Weak search functionality | only session title search | full-text search within conversations + date filters |
| No session management | only deletion possible | rename, favorites, export (markdown) |

#### 6. Overall Design

| Problem | Current Status | Direction for Improvement |
|---------|----------------|---------------------------|
| No frontend framework | ~2,500 lines of inline HTML/CSS/JS, direct DOM manipulation | Adopt React/Svelte/Lit → component separation, state management |
| Inline CSS | all inside `<style>` tags | separate CSS files or CSS-in-JS |
| No responsive support | fixed width, breaks in narrow sidebars | layout adjustment per panel width |
| Poor accessibility | no aria attributes, no keyboard navigation support | aria-label, role, tabindex, keyboard shortcuts |
| Dark/Light theme inconsistencies | uses VS Code CSS variables but some colors are hardcoded (`color: white`, `color: black`) | replace all colors with CSS variables |

#### UI Improvement Roadmap (Recommended Order)

```
Level 1: Syntax highlighting in code blocks (add highlight.js, biggest impact)
   ↓
Level 2: Inline diff view (verify file changes immediately)
   ↓
Level 3: Input UX improvement (auto-height, fullscreen mode)
   ↓
Level 4: Header cleanup (separate advanced settings, Agent status badge)
   ↓
Level 5: Frontend framework adoption (full rebuild)
```

> **Note**: Benchmark against competitors like Cline, Continue, and Cursor. Specifically, Cline's diff view and Cursor's input UX are excellent references.

---

### Short-term (1~2 weeks)

| Item | Description | Related Files |
|------|-------------|---------------|
| Syntax highlighting in code blocks | add highlight.js or Shiki library | `webviewContent.ts` |
| Streaming feedback improvement | real-time elapsed time + token count | `webviewContent.ts` |
| Add E2E tests | integration tests with @vscode/test-electron | new files |
| Automate WASM bundling | copy tree-sitter WASM via esbuild plugin | package.json scripts |
| Install MCP SDK | fully enable MCP feature | package.json |
| Strengthen error logging | add logger to empty catch blocks | entire project |

### Mid-term (1~2 months)

| Item | Description |
|------|-------------|
| Inline diff view | show file changes within the webview in Pending Operations |
| Complete input UX overhaul | auto-height, fullscreen input, code paste preview |
| Header/settings area cleanup | separate advanced settings, always show Agent status badge |
| `chatPanel` refactoring | separate message handling, streaming, and file operations into classes |
| Multi-workspace support | currently only uses `workspaceFolders[0]` |
| Multilingual UI | currently mixed Korean/English → apply i18n |

### Long-term

| Item | Description |
|------|-------------|
| FE framework adoption | complete rebuild with React/Svelte/Lit → component separation, state management, testability |
| Accessibility (A11Y) | aria attributes, keyboard navigation, screen reader support |
| VS Code Marketplace release | public distribution |
| Remote SSH support | verify operation in remote development environments |
| Agent Memory | retain learnings across sessions |
| Multi-Agent | role delegation among AI (coder, reviewer, tester) |
| Gamification system | see "Future Vision" section below |

---

## Future Vision: Gamification + Token Economy System

Original vision from the architect, not yet implemented. This is important for successors to understand long-term goals.

### Core Idea

Combining a **ChatDev-style virtual development office** with a **token economy system** to make AI coding feel like a game.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   🏢 Virtual Development Office (Pixel Art / Top-down)   │
│                                                          │
│   ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│   │Designing│  │  Coding  │  │ Testing  │  │Documenting│ │
│   │  💡     │  │  ⌨️     │  │  🧪     │  │  📝     │  │
│   │ (Qwen)  │  │(Minimax) │  │  (GLM)   │  │(Gemini)  │  │
│   └─────────┘  └──────────┘  └──────────┘  └─────────┘  │
│                                                          │
│   Each slot = AI Agent (model) = Role                    │
│   Collaboration with animated characters walking around  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

> Reference Image: ChatDev (https://github.com/OpenBMB/ChatDev) virtual office visualization

### 1. Token Economy System

Managing AI token usage as currency, with team/personal budget concepts.

```
┌─────────────────────────────────────────┐
│  💰 Token Economy                        │
│                                         │
│  Team Budget: 1,000,000 tokens / month  │
│  ├── Design Team: 200,000 (Used: 45,320) │
│  ├── Dev Team:     500,000 (Used: 312,100) │
│  ├── QA Team:      200,000 (Used: 88,750)  │
│  └── Docs Team:    100,000 (Used: 12,400)  │
│                                         │
│  Price per model:                        │
│  ├── qwen3-235b:  1x (Baseline)         │
│  ├── gpt-4o:      5x (Expensive)        │
│  └── qwen3-flash: 0.3x (Cheap)          │
└─────────────────────────────────────────┘
```

**What's needed:**

| Component | Description | Notes |
|-----------|-------------|-------|
| `src/token/tokenTracker.ts` | recording token usage per session/user | partially implemented in `token-usage-bar` |
| `src/token/tokenBudget.ts` | team/individual budget settings, balance checks | warning/blocking on budget overrun |
| `src/token/tokenStorage.ts` | persistent storage of usage (SQLite or JSON) | can use VS Code globalState |
| API Server | team token aggregation, dashboard | integrate with LiteLLM server |

### 2. Gamification UI (ChatDev style)

Transitioning the current chat UI into a **virtual development office**.

**Core Elements:**

| Element | Description |
|---------|-------------|
| **Virtual Office Map** | 2D top-down office map. AI characters in Designing, Coding, Testing, Documenting zones. |
| **AI Characters** | visualize models as characters. e.g., Qwen = blue-haired dev, GLM = green tester. |
| **Role Assignment** | Lead (user) assigns roles: Designer, Coder, Tester, Documenter, Reviewer. |
| **Workflow Visualization** | animation of characters working at desks and walking to other zones to hand over work. |
| **Speech Bubbles** | AI responses displayed as speech bubbles above respective characters. |
| **Progress Bars** | work progress displayed above each character. |

**Workflow Example:**

```
1. User: "Make a login page"
   → Team Lead (user) character writes requirement on whiteboard

2. Designing Zone:
   → Designer (Qwen-235b) character works on design
   → bubble: "Designing UI component structure..."
   → animation: walks to Coding zone with documents when done

3. Coding Zone:
   → Coder (Minimax) character writes code
   → animation: typing on monitor
   → hand over to Testing zone when done

4. Testing Zone:
   → Tester (GLM) character runs tests
   → ⚠️ warning icon if bugs found → walks back to Coding zone
   → ✅ delivery to Documenting zone if passed

5. Documenting Zone:
   → Documenter (Gemini) character writes documentation

6. Complete:
   → all characters gather for celebration animation 🎉
   → results displayed: tokens used, duration, file count, etc.
```

**Technology Stack Review:**

| Option | Pros | Cons |
|--------|------|------|
| **Canvas 2D** (vanilla) | full control, no dependencies | time-consuming development |
| **PixiJS** | 2D rendering optimized, sprite/animation support | increases bundle size (~300KB) |
| **Phaser** | game framework, tilemap/character systems built-in | bloated, large bundle size (~1MB) |
| **CSS + HTML** | simple, VS Code theme compatibility | limited character animations |

> Recommended: **PixiJS** — simple sprite movements + animations are sufficient.

**Required Assets:**
- Character spritesheets (walking, sitting, typing)
- Office tilemaps (desks, chairs, computers, whiteboard)
- UI Icons (bubbles, progress bars, token display)
- BGM / SFX (optional)

### 3. Team Model Assignment System

Assign roles to models and configure teams.

```
┌─────────────────────────────────────────┐
│  🏗️ Team Configuration                  │
│                                         │
│  Role          Model        Cost/Token  │
│  ───────────── ──────────── ─────────── │
│  👨‍🎨 Designer    qwen3-235b    1.0x     │
│  👨‍💻 Coder       minimax-m2.5  0.8x     │
│  🧪 Tester      glm-4.7       0.7x     │
│  📝 Documenter  qwen3-flash   0.3x     │
│  🔍 Reviewer    qwen3-80b     0.6x     │
│                                         │
│  Total Budget: 500K tokens              │
│  [Save Team] [Load Preset]             │
└─────────────────────────────────────────┘
```

**Connection points with current code:**

| Current | Future Extension |
|---------|------------------|
| `ProviderRegistry` (model selection) | automatic model routing by role |
| `AgentEngine` (single model) | executing stages with different models per role |
| Multi-model Review (`reviewerModel`) | generalizing into Tester/Reviewer roles |
| `tokenEstimator.ts` | cost calculation based on model unit price |
| `chatPanel.ts` webview | replacing with virtual office UI |

### Implementation Roadmap (Recommended)

```
Phase A: Token Tracking Foundation (2~3 days)
  - create tokenTracker.ts (per-session recording)
  - show cumulative usage on current token-usage-bar
  - store in VS Code globalState

Phase B: Team Model Assignment (1 week)
  - define Role type
  - team configuration UI (webview)
  - AgentEngine uses different models per stage

Phase C: Token Economy (1~2 weeks)
  - set unit prices per model
  - team/personal budget system
  - budget overrun warnings / automated cheap model recommendations
  - dashboard (usage charts)

Phase D: Gamification UI (2~4 weeks)
  - integrate PixiJS or Canvas 2D
  - character sprites + office tilemaps
  - placement per role zones
  - workflow animations
  - display AI responses via speech bubbles
```

---

## Frequently Occurring Issues

### "API Key not set"
→ Check `tokamak.apiKey` in VS Code Settings

### "Model not found"
→ Check if model is in `tokamak.models` and supported by LiteLLM server

### "Chat doesn't open"
→ Try `Cmd+Shift+P` → "Tokamak: Open Chat". Ensure extension is active.

### "Files not changing in Agent mode"
→ Ensure AI response includes `<<<FILE_OPERATION>>>` markers. Check if system prompt is correct.

### "Error after bundling"
→ If `npm run compile` works but `npm run bundle` fails, check esbuild external module settings.

---

## Contacts & Resources

- **Repository**: https://github.com/tokamak-network/tokamak-ai-agent
- **Existing Documents**: `docs/` folder (architecture, roadmap, test guides, etc.)
- **VS Code Extension API**: https://code.visualstudio.com/api
- **OpenAI SDK**: https://github.com/openai/openai-node
- **Benchmark (Cline)**: https://github.com/cline/cline

