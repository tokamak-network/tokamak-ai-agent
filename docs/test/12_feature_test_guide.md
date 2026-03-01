# 12개 Feature 테스트 가이드

## 사전 준비

```bash
# 1. 익스텐션 빌드                     
npm run bundle

# 2. VS Code에서 디버그 실행
# F5 키 또는 Run > Start Debugging
# Extension Development Host 창이 뜨면 테스트 시작
```

---

## Phase 1: Agent Autonomy

### F1. Auto-Approval System

**설정 방법:**
1. VS Code Settings (Cmd+,) 열기
2. `tokamak` 검색
3. 다음 설정들이 보이는지 확인:
   - `tokamak.autoApproval.enabled` — 체크박스
   - `tokamak.autoApproval.tools.read_file` — always_allow / ask / deny
   - `tokamak.autoApproval.tools.write_file`
   - `tokamak.autoApproval.tools.terminal_command`
   - `tokamak.autoApproval.allowedPaths` — glob 패턴 배열
   - `tokamak.autoApproval.protectedPaths`
   - `tokamak.autoApproval.allowedCommands`

**테스트 시나리오:**
1. `tokamak.autoApproval.enabled = true`로 설정
2. `write_file = always_allow`로 변경
3. Agent 모드에서 "src/test.ts 파일을 만들어줘" 요청
4. **기대 결과:** Apply 확인 없이 바로 파일이 생성됨
5. `protectedPaths`에 ".env" 추가
6. Agent에게 ".env 파일 수정해줘" 요청
7. **기대 결과:** 자동 승인 안 되고 확인 필요

---

### F2. Context Window Auto-Compression

**테스트 시나리오:**
1. Chat을 열고 (Cmd+Shift+I)
2. 긴 대화를 여러 번 주고받음 (10~15회 이상)
3. Output 패널 (Tokamak AI Agent) 확인

**확인 포인트:**
- 로그에 `[ContextCompressor]` 또는 compression 관련 메시지가 나타나는지
- 대화가 길어져도 에러 없이 계속 작동하는지
- 토큰 예산 초과 시 이전 메시지들이 요약되는지

*참고: 컨텍스트 윈도우의 75%를 넘어야 트리거되므로, 짧은 대화에서는 동작 안 함*

---

### F3. Terminal Feedback Loop

**테스트 시나리오:**
1. Agent 모드로 전환
2. "npm test를 실행하고 실패하면 고쳐줘" 요청
3. 의도적으로 깨진 테스트 파일을 만들어두고 테스트

**확인 포인트:**
- Output 로그에 `Terminal errors detected` 메시지
- `Parsed Errors` 섹션이 에이전트 컨텍스트에 포함되는지
- 에러 파일 경로, 라인 번호가 파싱되는지
- TypeScript 컴파일 에러, Vitest 테스트 에러, npm 에러 각각 테스트 가능

**수동 확인 (단위 테스트):**
```bash
npm test -- --reporter=verbose src/__tests__/terminalOutputParser.test.ts
```

---

## Phase 2: Code Intelligence

### F4. Tree-sitter AST Integration

**사전 준비:** `web-tree-sitter` 설치 확인
```bash
ls node_modules/web-tree-sitter/
```

**테스트 시나리오:**
1. Agent 모드에서 "Searcher 클래스의 구조를 알려줘" 같은 심볼 기반 질문
2. Output 로그 확인

**확인 포인트:**
- 로그에 `AST definition:` 이 포함된 검색 결과가 나오는지
- 큰 파일을 컨텍스트에 포함할 때 `(AST Outline, Score: ...)` 형태로 나오는지
- tree-sitter 초기화 실패 시에도 에러 없이 기존 regex 방식으로 fallback되는지

*참고: tree-sitter WASM 파일(tree-sitter-typescript.wasm 등)이 없으면 graceful degradation으로 기존 방식이 동작합니다. WASM 파일 배치는 별도 설정이 필요합니다.*

---

### F5. Mention System Enhancement

**테스트 시나리오:**
1. Chat 입력창에 `@` 입력
2. 파일명 자동완성이 나타나는지 확인
3. `@file:src/extension.ts` 형태로 멘션 후 "이 파일 설명해줘" 요청

**확인 포인트:**
- `@file:`, `@folder:`, `@symbol:`, `@problems` 타입 지원
- 멘션된 파일 내용이 프롬프트에 자동 주입되는지
- `@problems` 입력 시 현재 VS Code 진단(에러/경고) 정보가 포함되는지

---

### F6. Diagnostic-Based Auto-Fix

**테스트 시나리오:**
1. Agent 모드에서 코드를 수정하게 함
2. 수정 결과로 새 TypeScript 에러가 발생하는 경우

**확인 포인트:**
- Output 로그에 `[DiagnosticDiffTracker]` 관련 메시지
- 수정 전후 진단 비교 (introduced / resolved)
- 새로 도입된 에러가 10개 미만이면 자동 수정 시도하는지
- 10개 이상이면 skip하는지

---

## Phase 3: Extensibility

### F7. MCP Client

**설정 방법:**
1. Cmd+Shift+P > Tokamak: Configure MCP Servers
2. `.tokamak/mcp.json` 파일이 생성되는지 확인

**생성되는 기본 설정:**
```json
{
  "servers": [
    {
      "name": "example-server",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": {},
      "enabled": false
    }
  ]
}
```

**테스트 시나리오 (실제 MCP 서버가 있는 경우):**
1. `enabled: true`로 변경하고 실제 MCP 서버 정보 입력
2. Chat에서 MCP 도구를 사용하는 요청
3. 확인: MCP 도구 목록이 시스템 프롬프트에 "Available External Tools" 섹션으로 포함

**최소 확인:**
- 커맨드 실행 시 `.tokamak/mcp.json` 생성 여부
- `enabled: false`인 서버는 연결 시도 안 하는지
- 파일 수정 시 자동 재로드되는지 (FileSystemWatcher)

---

### F8. Rule System

**설정 방법:**
1. Cmd+Shift+P > Tokamak: Initialize Rules Folder
2. `.tokamak/rules/ts-conventions.md` 파일이 생성되는지 확인

**생성되는 예시 파일:**
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
- Use named exports, not default exports.
- File naming: camelCase for utilities, PascalCase for classes.
```

**테스트 시나리오:**
1. Rules 폴더 초기화
2. TypeScript 파일을 대상으로 Agent 모드에서 코드 작성 요청
3. AI 응답이 규칙을 따르는지 확인

**확인 포인트:**
- 규칙 파일 수정 시 자동 재로드 (파일 저장 후 바로 적용)
- `condition.languages`가 현재 파일 언어와 매칭되는지
- `condition.modes`가 현재 모드(ask/plan/agent)와 매칭되는지
- 새 규칙 파일 추가/삭제 즉시 반영

**단위 테스트:**
```bash
npm test -- --reporter=verbose src/__tests__/ruleEvaluator.test.ts
```

---

### F9. Hooks System

**설정 방법:**
프로젝트 루트에 `.tokamak/hooks.json` 생성:

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "command": "echo 'Tool about to be used' >> /tmp/tokamak-hooks.log",
      "timeout": 5000,
      "blocking": false,
      "enabled": true
    },
    {
      "event": "PostToolUse",
      "command": "echo 'Tool used successfully' >> /tmp/tokamak-hooks.log",
      "timeout": 5000,
      "blocking": false,
      "enabled": true
    },
    {
      "event": "PreMessage",
      "command": "echo 'Message incoming' >> /tmp/tokamak-hooks.log",
      "timeout": 5000,
      "blocking": false,
      "enabled": true
    }
  ]
}
```

**테스트 시나리오:**
1. 위 파일 생성 후 Chat에서 Agent 모드로 파일 수정 요청
2. `/tmp/tokamak-hooks.log` 확인

```bash
tail -f /tmp/tokamak-hooks.log
```

**Blocking hook 테스트:**
```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "command": "exit 1",
      "timeout": 5000,
      "blocking": true,
      "toolFilter": ["delete"],
      "enabled": true
    }
  ]
}
```
- 기대 결과: delete 액션만 블로킹, 다른 액션은 통과
- 로그에 `Operation blocked by PreToolUse hook` 메시지

---

## Phase 4: UX Polish

### F10. Streaming Diff Display

**테스트 시나리오:**
1. Agent 모드에서 파일 생성/수정 요청
2. AI 응답이 스트리밍되는 동안 관찰

**확인 포인트:**
- `<<<FILE_OPERATION>>>` 마커가 스트리밍 중 감지되는지
- 파일 타입, 경로가 실시간으로 파싱되는지
- 텍스트 응답과 파일 오퍼레이션이 분리되어 표시되는지

**단위 테스트:**
```bash
npm test -- --reporter=verbose src/__tests__/streamingDiffParser.test.ts
```

---

### F11. Project Knowledge Auto-Collection

**테스트 시나리오:**
1. package.json, tsconfig.json, README.md가 있는 프로젝트에서 Chat 열기
2. 첫 메시지 전송

**확인 포인트:**
- AI가 프로젝트 기술 스택을 자동으로 알고 있는지 (예: "이 프로젝트는 TypeScript + Vitest를 사용합니다")
- `.tokamak/knowledge/` 수동 파일이 있으면 자동 수집 결과와 합쳐지는지

**단위 테스트:**
```bash
npm test -- --reporter=verbose src/__tests__/autoCollector.test.ts
```

---

### F12. Browser Automation

**사전 준비:**
1. Settings에서 `tokamak.enableBrowser = true`
2. `puppeteer-core` 설치 필요:
```bash
npm install puppeteer-core
```
3. Chrome/Chromium 브라우저가 시스템에 설치되어 있어야 함

**테스트 시나리오:**
1. Agent 모드에서 "https://example.com 에 접속해서 페이지 타이틀을 알려줘"
2. AI가 browser action(navigate + evaluate)을 사용하는지 확인

**확인 포인트:**
- `enableBrowser = false`일 때: `Browser automation is disabled` 메시지
- `puppeteer-core` 미설치 시: `Failed to launch browser` 에러 메시지 (crash 없음)
- 정상 작동 시: navigate → screenshot → click 등 체이닝

*참고: puppeteer-core는 optional dependency이므로 미설치 시 graceful degradation*

---

## 전체 단위 테스트 실행

```bash
# 전체 297개 테스트
npm test

# 상세 출력
npm test -- --reporter=verbose

# 특정 Feature만
npm test -- --reporter=verbose src/__tests__/autoApproval.test.ts       # F1
npm test -- --reporter=verbose src/__tests__/contextCompressor.test.ts  # F2
npm test -- --reporter=verbose src/__tests__/terminalOutputParser.test.ts # F3
npm test -- --reporter=verbose src/__tests__/ruleEvaluator.test.ts      # F8
npm test -- --reporter=verbose src/__tests__/streamingDiffParser.test.ts # F10
npm test -- --reporter=verbose src/__tests__/autoCollector.test.ts      # F11
```

---

## 빠른 Smoke Test 체크리스트

| # | 확인 항목 | 방법 |
|---|---|---|
| 1 | 빌드 성공 | `npm run bundle` — 에러 없음 |
| 2 | 테스트 통과 | `npm test` — 297 passed |
| 3 | 익스텐션 활성화 | F5 → "Tokamak AI Agent is now active!" |
| 4 | Settings 표시 | Cmd+, → `tokamak` 검색 → auto-approval 설정들 |
| 5 | MCP 커맨드 | Cmd+Shift+P → "Tokamak: Configure MCP" → 파일 생성 |
| 6 | Rules 커맨드 | Cmd+Shift+P → "Tokamak: Initialize Rules" → 파일 생성 |
| 7 | Chat 열림 | Cmd+Shift+I → 채팅 패널 열림 |
| 8 | Agent 모드 | 모드를 Agent로 변경 → 파일 생성 요청 → 정상 동작 |
