# 01. Project Overview

## One-Line Summary

**Tokamak AI Agent** is a coding assistant extension for VS Code that enables using internal LiteLLM-based AI models directly.

## Why it was created

- Providing various AI models (Qwen, GLM, Minimax, etc.) internally via LiteLLM.
- Need to use AI **directly within the editor**, like GitHub Copilot or Cursor.
- Goal: Create an autonomous agent that **reads, edits files, and executes terminal commands**, not just simple Q&A.
- Benchmarked the open-source project Cline to implement core features internally.

## Current Status (v0.1.3)

| Item | Value |
|------|-------|
| Source Code | 16,810 lines (TypeScript) |
| Test Code | 3,171 lines, 297 tests |
| Test Files | 14 files |
| Bundle Size | 1.3MB (esbuild) |
| Supported Models | 7 Providers (Qwen, Minimax, GLM, OpenAI, Claude, Gemini, Generic) |
| Features | All 12 Features (4 Phases) implemented |

## Technology Stack

| Domain | Technology |
|--------|------------|
| Language | TypeScript 5.3 (strict mode) |
| Platform | VS Code Extension API 1.85+ |
| AI Comm | OpenAI Node.js SDK (LiteLLM compatible) |
| Bundler | esbuild (CJS format, node platform) |
| Testing | Vitest 2.1.9 |
| AST Parsing | web-tree-sitter (WASM) |
| Config Parsing | yaml package |
| Browser | puppeteer-core (optional) |

## 3 Modes

```
┌────────────────────────────────────────┐
│  💬 Ask     📋 Plan     🤖 Agent       │
│  (Q&A)    (Design)    (Autonomous)    │
└────────────────────────────────────────┘
```

1. **Ask** — General Q&A. Code explanation, error resolution, etc.
2. **Plan** — Establishing implementation plans. No code writing, just step-by-step design.
3. **Agent** — Autonomous agent. Performs file creation/modification/deletion and terminal execution.

## Project History (Major Commits)

```
c4bb224 — Chat feature foundation + SEARCH/REPLACE block implementation
f9552e2 — AI Agent basic operation + added tests
b9c9349 — Multiple model support
603b7cb — Multi-model review system
c74e4b6 — Refactored to Provider pattern
7dabdd8 — Fixed infinite review loop
91288d3~521bc50 — Implemented 12 Features across 4 Phases
e0574ae — Browser Automation fix
```

## Repository Structure

```
tokamak-agent/
├── src/                    # Source code (detailed in 02_ARCHITECTURE.md)
│   ├── extension.ts        # Entry point
│   ├── agent/              # Autonomous agent engine
│   ├── api/                # AI model communication
│   ├── approval/           # Auto-approval system
│   ├── ast/                # Tree-sitter AST analysis
│   ├── browser/            # Browser automation
│   ├── chat/               # Chat UI panel
│   ├── codeActions/        # Right-click menu (Explain/Refactor)
│   ├── completion/         # Inline completion (Ghost Text)
│   ├── config/             # VS Code settings helper
│   ├── context/            # Context window compression
│   ├── hooks/              # Pre/Post hook system
│   ├── knowledge/          # Project knowledge auto-collection
│   ├── mcp/                # Model Context Protocol client
│   ├── mentions/           # @file/@folder mention system
│   ├── prompts/            # System prompt builder
│   ├── rules/              # Project rules system
│   ├── streaming/          # Streaming diff parser
│   ├── utils/              # Common utilities
│   └── __tests__/          # Test files
├── docs/                   # Documentation
├── images/                 # Extension icons
├── out/                    # Build output
├── package.json            # Extension manifest + VS Code config/command definitions
├── tsconfig.json           # TypeScript configuration
└── vitest.config.ts        # Test configuration
```

## API Connection Structure

```
VS Code Extension
    │
    ▼
OpenAI Node.js SDK
    │
    ▼
LiteLLM Proxy Server (Internal)
    │
    ├── Qwen 3 (235B / 80B / Coder Flash)
    ├── Minimax M2.5
    ├── GLM 4.7
    ├── OpenAI GPT-4o (External)
    ├── Claude (External)
    └── Gemini (External)
```

- Access multiple models through LiteLLM with a single API Key.
- Use OpenAI SDK compatible interface (just need to change model name).
- Model-specific Provider classes abstract differences like vision support, token limits, etc.
