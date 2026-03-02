# 04. 개발 환경 & 빌드 가이드

## 사전 요구사항

- **Node.js** 18+ (20 LTS 권장)
- **VS Code** 1.85+
- **npm** 9+

## 초기 세팅

```bash
# 1. 리포 클론
git clone https://github.com/tokamak-network/tokamak-ai-agent.git
cd tokamak-ai-agent

# 2. 의존성 설치
npm install

# 3. 빌드 확인
npm run compile     # TypeScript → out/

# 4. 테스트 확인
npm test            # 297 tests 모두 통과해야 정상
```

## npm 스크립트

| 명령 | 용도 | 비고 |
|------|------|------|
| `npm run compile` | TypeScript 컴파일 | `out/` 디렉토리에 JS 생성 |
| `npm run watch` | Watch 모드 컴파일 | 파일 변경 시 자동 재컴파일 |
| `npm test` | 전체 테스트 실행 | Vitest, 297 tests |
| `npm run bundle` | esbuild 번들 | `out/extension.js` 1.3MB |
| `npm run package` | VSIX 패키징 | `tokamak-agent-x.x.x.vsix` 생성 |
| `npm run lint` | ESLint 검사 | `src/**/*.ts` 대상 |

## 디버깅 (Extension Development Host)

### 방법 1: F5 키

1. VS Code에서 프로젝트 열기
2. `F5` 누르면 Extension Development Host 창이 뜸
3. 새 창에서 `Cmd+Shift+I`로 채팅 열기
4. 원래 창의 Debug Console에서 로그 확인

### 방법 2: 번들 후 설치

```bash
# VSIX 파일 생성
npm run package

# VS Code에 직접 설치
code --install-extension tokamak-agent-0.1.3.vsix
```

### 로그 확인

- **Output 패널** → "Tokamak AI Agent" 채널 선택
- `logger.info('[태그]', '메시지')` 형식으로 로그가 출력됨

## 테스트

### 전체 실행

```bash
npm test
```

### 특정 파일만

```bash
npm test -- src/__tests__/autoApproval.test.ts
```

### 상세 출력

```bash
npm test -- --reporter=verbose
```

### 커버리지

```bash
npx vitest run --coverage
```

### 테스트 작성 규칙

1. **순수 함수만 테스트** — `vscode` API를 import하는 모듈은 단위 테스트 불가
2. 파일 위치: `src/__tests__/파일명.test.ts`
3. `import { describe, it, expect } from 'vitest'` 사용
4. VS Code 통합 테스트는 Extension Development Host에서 수동으로 확인

**테스트 가능한 모듈** (vscode 의존 없음):
```
autoApproval.ts, contextCompressor.ts, tokenEstimator.ts,
terminalOutputParser.ts, contentUtils.ts, streamingDiffParser.ts,
autoCollector.ts, ruleEvaluator.ts, fileOperationParser.ts,
convergence.ts, planner.ts
```

**테스트 불가능한 모듈** (vscode 의존):
```
chatPanel.ts, engine.ts, executor.ts, observer.ts, searcher.ts,
contextManager.ts, mentionProvider.ts, ruleLoader.ts, mcpClient.ts,
browserService.ts, hookConfigLoader.ts
```

## TypeScript 설정

### tsconfig.json 핵심

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

### 주의사항

- **import 경로에 `.js` 확장자 필수**: Node16 모듈 해석 방식
  ```typescript
  // 올바른 예
  import { Executor } from './executor.js';

  // 틀린 예 (컴파일 에러)
  import { Executor } from './executor';
  ```

- **vscode는 외부 모듈**: esbuild에서 `--external:vscode` 처리

## 번들링 (esbuild)

```bash
npm run bundle
# = rm -rf out && esbuild ./src/extension.ts --bundle --outfile=out/extension.js --external:vscode --format=cjs --platform=node
```

- 모든 소스 + node_modules를 하나의 JS 파일로 번들
- `vscode`만 external 처리 (VS Code 런타임에서 제공)
- CJS format (VS Code 호환)
- 결과: `out/extension.js` (약 1.3MB)

## 배포

### VSIX 패키지 생성

```bash
npm run package
# → tokamak-agent-0.1.3.vsix
```

### 설치

```bash
# CLI로 설치
code --install-extension tokamak-agent-0.1.3.vsix

# 또는 VS Code UI
# Extensions 뷰 → ⋯ → Install from VSIX...
```

### 버전 올리기

1. `package.json`의 `version` 수정
2. `CHANGELOG.md` 업데이트
3. `npm run package`로 새 VSIX 생성

## 프로젝트 설정 테스트 (사용자 입장)

1. VS Code Settings (`Cmd+,`) → `tokamak` 검색
2. `tokamak.apiKey`에 LiteLLM API 키 입력
3. `Cmd+Shift+I`로 채팅 열기
4. 모델 선택 후 메시지 전송

## 의존성 관리

### Production

| 패키지 | 용도 | 비고 |
|--------|------|------|
| `openai` ^4.24.0 | LiteLLM API 통신 | 핵심 의존성 |
| `web-tree-sitter` ^0.26.6 | AST 파싱 | WASM 기반 |
| `yaml` ^2.8.2 | YAML 파싱 | 규칙/설정 파일 |

### Optional (런타임에 dynamic import)

| 패키지 | 용도 | 비고 |
|--------|------|------|
| `puppeteer-core` | 브라우저 자동화 | 미설치 시 graceful degradation |
| `@modelcontextprotocol/sdk` | MCP 통신 | 미설치 시 MCP 기능 비활성화 |

### Dev

| 패키지 | 용도 |
|--------|------|
| `typescript` ^5.3.0 | 컴파일러 |
| `vitest` ^2.1.9 | 테스트 프레임워크 |
| `esbuild` ^0.27.3 | 번들러 |
| `@types/vscode` ^1.85.0 | VS Code API 타입 |
| `@vscode/vsce` ^2.22.0 | VSIX 패키징 |
| `eslint` + typescript-eslint | 린트 |

## 디렉토리별 파일 수

```
src/agent/          — 13 files (엔진, 실행기, 플래너, 옵저버, 검색기 ...)
src/api/            — 10 files (클라이언트, 7개 Provider, 타입, 레지스트리)
src/chat/           —  5 files (패널, 웹뷰, 파서, 스킬, 뷰프로바이더)
src/prompts/        — 10 files (빌더, 컴포넌트, 변형, 타입)
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
