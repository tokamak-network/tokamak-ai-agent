# Tokamak AI Agent - Handover Documentation

> Last Update: 2026-03-02 | v0.1.3

## Document List

| # | Document | Content |
|---|----------|---------|
| 01 | [Project Overview](./01_PROJECT_OVERVIEW.md) | What this project is, why it was made, current status |
| 02 | [Architecture](./02_ARCHITECTURE.md) | Code structure, module relationships, core design patterns |
| 03 | [Feature List](./03_FEATURES.md) | Detailed explanation of 12 features (Phase 1~4) |
| 04 | [Dev Environment & Build](./04_DEV_GUIDE.md) | Local settings, build, test, debugging, deployment |
| 05 | [Known Issues & Future Tasks](./05_KNOWN_ISSUES.md) | Remaining work, technical debt, UI improvement, **Gamification Vision** |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Verify tests (297 tests)
npm test

# 3. Build
npm run bundle

# 4. Run debug in VS Code
# F5 key
```

## Top 5 Core Files (Read these first)

1. **`src/extension.ts`** — Extension entry point, command registration
2. **`src/chat/chatPanel.ts`** — Chat UI hub (integrates all subsystems, ~2,300 lines)
3. **`src/agent/engine.ts`** — Autonomous agent state machine (~1,400 lines)
4. **`src/agent/executor.ts`** — File/terminal executor (~780 lines)
5. **`src/api/providers/BaseProvider.ts`** — Base class for AI model communication
