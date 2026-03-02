# 04. Dev Environment & Build Guide

## Prerequisites

- **Node.js** 18+ (20 LTS recommended)
- **VS Code** 1.85+
- **npm** 9+

## Initial Setup

```bash
# 1. Clone repo
git clone https://github.com/tokamak-network/tokamak-ai-agent.git
cd tokamak-ai-agent

# 2. Install dependencies
npm install

# 3. Verify build
npm run compile     # TypeScript → out/

# 4. Verify tests
npm test            # All 297 tests must pass
```

## npm Scripts

| Command | Usage | Notes |
|---------|-------|-------|
| `npm run compile` | TypeScript compilation | Generates JS in `out/` |
| `npm run watch` | Watch mode compilation | Auto-recompiles on file changes |
| `npm test` | Run all tests | Vitest, 297 tests |
| `npm run bundle` | esbuild bundling | `out/extension.js` 1.3MB |
| `npm run package` | VSIX packaging | Generates `tokamak-agent-x.x.x.vsix` |
| `npm run lint` | ESLint check | Against `src/**/*.ts` |

## Debugging (Extension Development Host)

### Method 1: F5 Key

1. Open project in VS Code.
2. Press `F5` to open the Extension Development Host window.
3. Open chat in the new window with `Cmd+Shift+I`.
4. Check logs in the Debug Console of the original window.

### Method 2: Install After Bundling

```bash
# Generate VSIX file
npm run package

# Install directly to VS Code
code --install-extension tokamak-agent-0.1.3.vsix
```

### Checking Logs

- **Output Panel** → Select "Tokamak AI Agent" channel.
- Logs are output in `logger.info('[tag]', 'message')` format.

## Testing

### Run All

```bash
npm test
```

### Run specific file

```bash
npm test -- src/__tests__/autoApproval.test.ts
```

### Verbose output

```bash
npm test -- --reporter=verbose
```

### Coverage

```bash
npx vitest run --coverage
```

### Test writing rules

1. **Test pure functions only** — Modules importing `vscode` API cannot be unit tested.
2. File location: `src/__tests__/filename.test.ts`.
3. Use `import { describe, it, expect } from 'vitest'`.
4. Manually verify VS Code integration tests in the Extension Development Host.

**Testable modules** (no vscode dependency):
```
autoApproval.ts, contextCompressor.ts, tokenEstimator.ts,
terminalOutputParser.ts, contentUtils.ts, streamingDiffParser.ts,
autoCollector.ts, ruleEvaluator.ts, fileOperationParser.ts,
convergence.ts, planner.ts
```

**Non-testable modules** (vscode dependency):
```
chatPanel.ts, engine.ts, executor.ts, observer.ts, searcher.ts,
contextManager.ts, mentionProvider.ts, ruleLoader.ts, mcpClient.ts,
browserService.ts, hookConfigLoader.ts
```

## TypeScript Configuration

### tsconfig.json key points

```json
{
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "target": "ES2022",
    "strict": true,
    "rootDir": "src",
    "outDir": "out"
  }
}
```

### Precautions

- **`.js` extension required in imports**: Node16 module resolution.
  ```typescript
  // Correct
  import { Executor } from './executor.js';

  // Incorrect (compilation error)
  import { Executor } from './executor';
  ```

- **vscode is an external module**: Treat as `--external:vscode` in esbuild.

## Bundling (esbuild)

```bash
npm run bundle
# = rm -rf out && esbuild ./src/extension.ts --bundle --outfile=out/extension.js --external:vscode --format=cjs --platform=node
```

- Bundle all sources + node_modules into a single JS file.
- Treat `vscode` as external (provided at VS Code runtime).
- CJS format (VS Code compatible).
- Result: `out/extension.js` (~1.3MB).

## Deployment

### VSIX Package creation

```bash
npm run package
# → tokamak-agent-0.1.3.vsix
```

### Installation

```bash
# Via CLI
code --install-extension tokamak-agent-0.1.3.vsix

# Via VS Code UI
# Extensions View → ⋯ → Install from VSIX...
```

### Versioning

1. Update `version` in `package.json`.
2. Update `CHANGELOG.md`.
3. Create new VSIX via `npm run package`.

## Project Configuration Test (User perspective)

1. VS Code Settings (`Cmd+,`) → search for `tokamak`.
2. Enter LiteLLM API Key in `tokamak.apiKey`.
3. Open chat via `Cmd+Shift+I`.
4. Select model and send message.

## Dependency Management

### Production

| Package | Usage | Notes |
|---------|-------|-------|
| `openai` ^4.24.0 | LiteLLM API communication | core dependency |
| `web-tree-sitter` ^0.26.6 | AST parsing | WASM-based |
| `yaml` ^2.8.2 | YAML parsing | Rules/Config files |

### Optional (dynamic import at runtime)

| Package | Usage | Notes |
|---------|-------|-------|
| `puppeteer-core` | Browser automation | falls back if not installed |
| `@modelcontextprotocol/sdk` | MCP communication | disabled if not installed |

### Dev

| Package | Usage |
|---------|-------|
| `typescript` ^5.3.0 | Compiler |
| `vitest` ^2.1.9 | Test framework |
| `esbuild` ^0.27.3 | Bundler |
| `@types/vscode` ^1.85.0 | VS Code API types |
| `@vscode/vsce` ^2.22.0 | VSIX packaging |
| `eslint` + typescript-eslint | Lint |

## File Count by Directory

```
src/agent/          — 13 files (Engine, executor, planner, observer, searcher ...)
src/api/            — 10 files (Client, 7 Providers, Types, Registry)
src/chat/           —  5 files (Panel, Webview, Parser, Skills, ViewProvider)
src/prompts/        — 10 files (Builders, Components, Variants, Types)
src/approval/       —  1 file
src/ast/            —  3 files
src/browser/        —  3 files
src/codeActions/    —  1 file
src/completion/     —  1 file
src/config/         —  1 file
src/context/        —  1 file
src/hooks/          —  3 files
src/knowledge/      —  1 file
src/mcp/            —  4 files
src/mentions/       —  2 files
src/rules/          —  3 files
src/streaming/      —  1 file
src/utils/          —  3 files
src/__tests__/      — 14 files
```
