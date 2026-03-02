# Tokamak AI Agent

사내 AI 모델(LiteLLM 기반 OpenAI 호환 API)을 VS Code에서 바로 사용할 수 있는 코딩 어시스턴트 익스텐션입니다. 자율 에이전트, 멀티 모델 리뷰, 확장 가능한 도구 시스템을 지원합니다.

**버전:** 0.1.3 | **테스트:** 297개 | **지원 모델:** Qwen, GLM, Minimax, OpenAI, Claude, Gemini

---

## 빠른 시작 (설치 방법)

### 1. VSIX 파일을 통한 설치

1. [GitHub Releases](https://github.com/tokamak-network/tokamak-ai-agent/releases) 페이지에서 최신 `.vsix` 파일을 다운로드합니다.
2. VS Code에서 **확장 프로그램** 보기(`Cmd+Shift+X`)를 엽니다.
3. 상단 우측의 **기타 작업...** (점 세 개) 메뉴를 클릭합니다.
4. **VSIX에서 설치...**를 선택합니다.
5. 다운로드한 `.vsix` 파일을 선택합니다.

### 2. 소스 코드 빌드 (개발자용)

```bash
# 의존성 설치
npm install

# 테스트 실행 (297개)
npm test

# 번들 빌드
npm run bundle

# VSIX 패키징
npm run package

# 또는 VS Code에서 F5로 디버그 실행
```

---

## API 설정

`Cmd+,` (Mac) / `Ctrl+,` (Windows)로 설정을 열고 `tokamak`을 검색합니다.

### 기본 설정

| 설정 | 설명 | 필수 |
|------|------|:----:|
| `tokamak.apiKey` | AI 서비스 API Key | ✅ |
| `tokamak.models` | 사용 가능한 모델 목록 | - |
| `tokamak.selectedModel` | 현재 선택된 모델 | - |
| `tokamak.enableInlineCompletion` | Ghost Text 자동완성 활성화 | - |
| `tokamak.completionDebounceMs` | 자동완성 딜레이 (기본 300ms) | - |

### 에이전트 & 자동화 설정

| 설정 | 설명 | 기본값 |
|------|------|:----:|
| `tokamak.enableCheckpoints` | 체크포인트 저장/복원 | `false` |
| `tokamak.enableMultiModelReview` | 멀티 모델 코드 리뷰 | `false` |
| `tokamak.enableBrowser` | 브라우저 자동화 | `false` |
| `tokamak.autoApproval.enabled` | 에이전트 액션 자동 승인 | `false` |
| `tokamak.autoApproval.tools.*` | 도구별 승인 수준 (always_allow / ask / deny) | 도구별 상이 |
| `tokamak.autoApproval.allowedPaths` | 자동 승인 경로 (glob 패턴) | `[]` |
| `tokamak.autoApproval.protectedPaths` | 항상 확인 경로 (glob 패턴) | `[]` |
| `tokamak.autoApproval.allowedCommands` | 허용된 터미널 명령 패턴 | `[]` |

**settings.json 예시:**
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

## 핵심 기능

### 1. AI 채팅 (3가지 모드)

**채팅 열기:** `Cmd+Shift+I` (Mac) / `Ctrl+Shift+I` (Windows)

```
┌─────────────────────────────────────┐
│ [💬 Ask] [📋 Plan] [🤖 Agent]       │
└─────────────────────────────────────┘
```

#### 💬 Ask 모드 (기본)
코드에 대해 질문하고 답변을 받는 모드입니다.

- "이 함수가 뭘 하는 거야?"
- "이 에러 어떻게 해결해?"
- "React에서 상태 관리 어떻게 해?"

#### 📋 Plan 모드
구현 전에 작업 계획을 세우는 모드입니다. **코드를 직접 작성하지 않습니다.**

- "사용자 인증 기능을 추가하려고 해. 어떻게 구현할까?"
- "이 코드를 마이크로서비스로 분리하고 싶어"

#### 🤖 Agent 모드
AI가 자율적으로 작업을 수행하는 모드입니다:
- **파일 생성/수정/삭제** — diff 미리보기 제공
- **터미널 명령 실행** — 에러 자동 파싱 및 수정
- **코드베이스 검색** — AST 기반 스마트 랭킹
- **외부 도구 사용** — MCP 프로토콜 연동
- **브라우저 제어** — Puppeteer 기반 자동화
- **자동 수정** — 진단 피드백 기반 셀프 픽스

**에이전트 워크플로우:**
```
Planning → Executing → Observing → Reflecting → Fixing (필요 시)
                                                   ↓
                                            Reviewing (선택적 멀티 모델 리뷰)
```

**사용 흐름:**
1. Agent 모드 선택
2. 요청 입력 (예: "유틸리티 함수 만들어줘")
3. AI가 계획 수립 → 실행 → 결과 관찰 → 반성 → (필요 시) 수정
4. **Pending File Operations** 패널에서 변경 목록 확인

```
┌─────────────────────────────────────┐
│ ⚡ Pending File Operations          │
├─────────────────────────────────────┤
│ [CREATE] src/utils/helper.ts [Preview]│
│ [EDIT]   src/index.ts        [Preview]│
│ [DELETE] src/old-file.ts     [Preview]│
├─────────────────────────────────────┤
│ [✓ Apply Changes]  [✗ Reject]       │
└─────────────────────────────────────┘
```

5. **Preview** 클릭 → Diff 뷰어에서 변경 내용 확인
6. **Apply Changes** 클릭 → 파일에 실제 적용
7. **Reject** 클릭 → 취소

---

### 2. 파일 첨부 (@멘션)

입력창에 `@`를 입력하면 프로젝트의 파일, 폴더, 심볼, 진단 정보를 참조할 수 있습니다.

| 멘션 타입 | 예시 | 설명 |
|------|------|------|
| `@file` | `@chatPanel.ts` | 파일 내용 첨부 |
| `@folder` | `@src/agent/` | 폴더 구조 첨부 |
| `@symbol` | `@AgentEngine` | 심볼 정의 첨부 (Tree-sitter 필요) |
| `@problems` | `@problems` | 현재 VS Code 진단 정보 첨부 |

```
┌─────────────────────────────────────┐
│  📄 extension.ts        src/        │  ← 자동완성
│  📁 agent/              src/        │
│  🔷 AgentEngine         engine.ts   │
│  ⚠️ problems           3 errors     │
└─────────────────────────────────────┘
```

파일을 첨부하지 않으면 **현재 열린 파일**과 **선택한 코드**가 자동으로 AI에게 전달됩니다.

---

### 3. 슬래시 명령어 (Skills)

입력창에서 `/`를 입력하면 사용 가능한 명령어 목록이 표시됩니다.

| 명령어 | 설명 |
|------|------|
| `/explain` | 코드 설명 |
| `/refactor` | 리팩토링 제안 |
| `/fix` | 버그 찾기 및 수정 |
| `/test` | 유닛 테스트 생성 |
| `/docs` | 문서화 |
| `/optimize` | 성능 최적화 |
| `/security` | 보안 감사 |

#### 커스텀 스킬 만들기

프로젝트에 맞는 커스텀 스킬을 만들 수 있습니다:

```
Cmd+Shift+P → "Tokamak: Initialize Skills Folder"
```

```markdown
<!-- .tokamak/skills/review.md -->
---
description: 시니어 개발자 관점 코드 리뷰
---

이 코드를 시니어 개발자 관점에서 리뷰해주세요:
1. 코드 품질 및 베스트 프랙티스
2. 잠재적 버그나 엣지 케이스
3. 보안 이슈
```

팀원들과 Git으로 공유할 수 있고, 코드 수정 없이 스킬을 추가/수정할 수 있습니다.

---

### 4. 자동 승인 시스템

에이전트 액션의 자동 승인/수동 확인을 도구별로 설정합니다.

| 도구 | 기본값 | 설명 |
|------|------|------|
| `read_file` | always_allow | 파일 읽기 |
| `search` | always_allow | 코드 검색 |
| `write_file` | ask | 파일 쓰기/편집 |
| `create_file` | ask | 파일 생성 |
| `delete_file` | ask | 파일 삭제 |
| `terminal_command` | ask | 터미널 명령 실행 |

- **경로 기반 규칙:** `src/test/**`는 자동 승인, `src/config/**`는 항상 확인
- **명령 패턴:** `npm test`는 자동 승인, `rm *`은 확인 필요

---

### 5. 컨텍스트 윈도우 자동 압축

컨텍스트 사용량이 75%를 초과하면 자동으로 대화 이력을 압축합니다.

- 최근 메시지는 원본 유지
- 오래된 대화는 LLM을 통해 요약
- UI에 컨텍스트 사용률 표시
- 컨텍스트 오버플로우 크래시 방지

---

### 6. 터미널 피드백 루프

터미널 명령 실패 시 에러를 자동 파싱하여 수정을 시도합니다.

**지원 에코시스템:**
- TypeScript (`tsc` 에러 — 파일/라인/컬럼 포함)
- Vitest (테스트 실패 — 스택 트레이스 포함)
- npm (의존성 에러)
- Python (트레이스백)
- Go (컴파일 에러)

---

### 7. Tree-sitter AST 통합

WASM 기반 코드 파싱으로 코드 구조를 정확하게 이해합니다.

- **지원 언어:** TypeScript, JavaScript, Python, Go
- **활용:** 심볼 검색(`@symbol`), 스마트 파일 아웃라인, 의존성 분석
- **Graceful degradation:** Tree-sitter 사용 불가 시 정규식으로 폴백

---

### 8. 멀티 모델 리뷰 & 토론

별도 AI 모델을 사용한 코드 품질 검증 (선택적).

| 전략 | 설명 |
|------|------|
| `review` | 다른 모델이 코드 변경을 리뷰 |
| `red-team` | 다른 모델이 구현을 적대적으로 비평 |
| `debate` | 다른 모델이 계획 방식을 토론 |
| `perspectives` | 다른 모델이 대안적 관점 제공 |

설정에서 활성화: `tokamak.enableMultiModelReview: true`

---

### 9. 프로젝트 규칙 시스템

`.tokamak/rules/`에 프로젝트별 코딩 규칙을 정의합니다:

```yaml
# .tokamak/rules/ts-conventions.md
---
description: TypeScript 코딩 컨벤션
condition:
  languages: [typescript, typescriptreact]
  modes: [agent]
priority: 10
---
- strict TypeScript 사용. `any` 금지.
- 객체 형태는 `type`보다 `interface` 선호.
- 모든 함수에 명시적 반환 타입 작성.
```

언어, 모드, 파일 경로에 따라 규칙이 조건부로 활성화됩니다.

---

### 10. 훅 시스템

`.tokamak/hooks.json`으로 에이전트 액션 전후에 커스텀 스크립트를 실행합니다:

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

**이벤트:** `PreToolUse`, `PostToolUse`, `PreApproval`, `PostApproval`, `PreMessage`, `PostMessage`

---

### 11. MCP (Model Context Protocol) 지원

MCP 프로토콜을 통해 외부 도구와 서비스를 연결합니다.

`.tokamak/mcp.json`에서 설정:

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

MCP 도구는 에이전트의 사용 가능한 액션에 자동으로 추가됩니다.

---

### 12. 브라우저 자동화

Puppeteer 기반 브라우저 제어로 웹 앱 테스트 및 디버깅을 지원합니다.

**액션:** navigate, screenshot, click, type, evaluate (JavaScript 실행), close

설정에서 활성화: `tokamak.enableBrowser: true`

프로젝트에 `puppeteer-core`가 설치되어 있어야 합니다.

---

### 13. 코드 자동완성 (Ghost Text)

Copilot처럼 코드 작성 중 회색 미리보기로 자동완성을 제안합니다.

- `Tab`을 눌러 제안 수락
- `Esc`로 제안 무시
- 비활성화: `tokamak.enableInlineCompletion: false`

---

### 14. 스트리밍 Diff 표시

AI가 응답을 생성하는 도중에 파일 변경 사항을 실시간으로 확인할 수 있습니다.

---

### 15. 자동 지식 수집

표준 파일(`package.json`, `tsconfig.json`, `README.md` 등)에서 프로젝트 정보를 자동 추출합니다. 기본적인 프로젝트 정보는 `.tokamak/knowledge/` 수동 설정 없이도 사용 가능합니다.

---

### 16. 코드 설명 / 리팩토링

코드를 선택한 후 우클릭 메뉴에서 사용할 수 있습니다.

#### Explain Code (코드 설명)
1. 코드 선택 → 우클릭 → **Tokamak: Explain Code**

#### Refactor Code (코드 리팩토링)
1. 코드 선택 → 우클릭 → **Tokamak: Refactor Code**
2. 리팩토링 유형 선택 (가독성, 성능, 에러 처리, 함수 추출, 타입 추가, 직접 입력)

---

## 명령어 목록

| 명령어 | 단축키 | 설명 |
|--------|--------|------|
| Tokamak: Open Chat | `Cmd+Shift+I` | AI 채팅 열기 |
| Tokamak: Send to Chat | - | 선택한 코드를 채팅으로 전송 |
| Tokamak: Explain Code | - | 선택한 코드 설명 |
| Tokamak: Refactor Code | - | 선택한 코드 리팩토링 |
| Tokamak: Clear Chat History | - | 채팅 기록 삭제 |
| Tokamak: Initialize Skills Folder | - | 커스텀 스킬 폴더 생성 |
| Tokamak: Initialize Knowledge Folder | - | 지식 폴더 생성 |
| Tokamak: Initialize Rules | - | 규칙 폴더 생성 |
| Tokamak: Configure MCP | - | MCP 서버 설정 |

---

## 프로젝트 설정 구조

```
.tokamak/
├── skills/         — 슬래시 명령어 (/explain, /fix, 커스텀)
│   ├── explain.md
│   ├── refactor.md
│   └── ...
├── knowledge/      — 프로젝트 지식 (AI 컨텍스트에 자동 주입)
│   └── conventions.md
├── rules/          — 코딩 규칙 (조건부 활성화)
│   └── ts-conventions.md
├── mcp.json        — MCP 서버 설정
└── hooks.json      — Pre/Post 훅 설정
```

---

## 문제 해결

### API 연결 오류
- LiteLLM 서버 상태 확인
- 모델명이 올바른지 확인
- 네트워크/VPN 연결 확인

### 채팅이 열리지 않음
- `Cmd+Shift+P` → "Tokamak: Open Chat" 실행
- Extension이 활성화되었는지 확인

### 자동완성이 작동하지 않음
- `tokamak.enableInlineCompletion`이 `true`인지 확인
- API Key가 설정되었는지 확인

---

## 기술 스택

| 항목 | 기술 |
|------|------|
| 언어 | TypeScript (strict, Node16 모듈) |
| 빌드 | esbuild (번들) + tsc (타입 체크) |
| 테스트 | Vitest (297개 테스트) |
| API | OpenAI Node.js SDK (LiteLLM 호환) |
| AST | web-tree-sitter (WASM) |
| 설정 | YAML (규칙), JSON (MCP, 훅) |
| 브라우저 | puppeteer-core (선택적) |
| 패키징 | vsce |
