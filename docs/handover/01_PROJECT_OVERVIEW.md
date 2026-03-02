# 01. 프로젝트 개요

## 한 줄 요약

**Tokamak AI Agent**는 사내 LiteLLM 기반 AI 모델을 VS Code에서 바로 사용할 수 있게 해주는 코딩 어시스턴트 익스텐션이다.

## 왜 만들었는가

- 회사 내부에 LiteLLM을 통해 여러 AI 모델(Qwen, GLM, Minimax 등)을 제공하고 있음
- GitHub Copilot이나 Cursor처럼 **에디터 안에서 바로** AI를 쓰고 싶다는 니즈
- 단순 Q&A가 아니라 **파일을 직접 읽고, 수정하고, 터미널 명령을 실행**하는 자율 에이전트가 목표
- 오픈소스 Cline을 벤치마크로 삼아 핵심 기능을 자체 구현

## 현재 상태 (v0.1.2)

| 항목 | 수치 |
|------|------|
| 소스 코드 | 16,810줄 (TypeScript) |
| 테스트 코드 | 3,171줄, 297 tests |
| 테스트 파일 | 14개 |
| 번들 크기 | 1.3MB (esbuild) |
| 지원 모델 | 7개 Provider (Qwen, Minimax, GLM, OpenAI, Claude, Gemini, Generic) |
| 기능 | 12개 Feature (4 Phase) 전부 구현 완료 |

## 기술 스택

| 영역 | 기술 |
|------|------|
| 언어 | TypeScript 5.3 (strict mode) |
| 플랫폼 | VS Code Extension API 1.85+ |
| AI 통신 | OpenAI Node.js SDK (LiteLLM 호환) |
| 번들러 | esbuild (CJS format, node platform) |
| 테스트 | Vitest 2.1.9 |
| AST 파싱 | web-tree-sitter (WASM) |
| 설정 파싱 | yaml 패키지 |
| 브라우저 | puppeteer-core (optional) |

## 3가지 모드

```
┌────────────────────────────────────────┐
│  💬 Ask     📋 Plan     🤖 Agent       │
│  (Q&A)     (설계)      (자율 실행)     │
└────────────────────────────────────────┘
```

1. **Ask** — 일반 질의응답. 코드 설명, 에러 해결 등
2. **Plan** — 구현 계획 수립. 코드는 안 쓰고 단계별 계획만 제시
3. **Agent** — 자율 에이전트. 파일 생성/수정/삭제, 터미널 실행까지 직접 수행

## 프로젝트 연혁 (주요 커밋)

```
c4bb224 — Chat 기능 기초 + SEARCH/REPLACE 블록 구현
f9552e2 — AI Agent 기본 동작 + 테스트 추가
b9c9349 — 다중 모델 지원
603b7cb — 멀티 모델 리뷰 시스템
c74e4b6 — Provider 패턴으로 리팩토링
7dabdd8 — 무한 리뷰 루프 수정
91288d3~521bc50 — 12개 Feature 4Phase 구현
e0574ae — Browser Automation 수정
```

## 리포지토리 구조

```
tokamak-agent/
├── src/                    # 소스 코드 (아래 02_ARCHITECTURE.md에서 상세 설명)
│   ├── extension.ts        # 진입점
│   ├── agent/              # 자율 에이전트 엔진
│   ├── api/                # AI 모델 통신
│   ├── approval/           # 자동 승인 시스템
│   ├── ast/                # Tree-sitter AST 분석
│   ├── browser/            # 브라우저 자동화
│   ├── chat/               # 채팅 UI 패널
│   ├── codeActions/        # 우클릭 메뉴 (Explain/Refactor)
│   ├── completion/         # 인라인 자동완성 (Ghost Text)
│   ├── config/             # VS Code 설정 헬퍼
│   ├── context/            # 컨텍스트 윈도우 압축
│   ├── hooks/              # Pre/Post 훅 시스템
│   ├── knowledge/          # 프로젝트 지식 자동 수집
│   ├── mcp/                # Model Context Protocol 클라이언트
│   ├── mentions/           # @file/@folder 멘션 시스템
│   ├── prompts/            # 시스템 프롬프트 빌더
│   ├── rules/              # 프로젝트 규칙 시스템
│   ├── streaming/          # 스트리밍 diff 파서
│   ├── utils/              # 공통 유틸리티
│   └── __tests__/          # 테스트 파일
├── docs/                   # 문서
├── images/                 # 익스텐션 아이콘
├── out/                    # 빌드 결과물
├── package.json            # 익스텐션 매니페스트 + VS Code 설정/커맨드 정의
├── tsconfig.json           # TypeScript 설정
└── vitest.config.ts        # 테스트 설정
```

## API 연결 구조

```
VS Code Extension
    │
    ▼
OpenAI Node.js SDK
    │
    ▼
LiteLLM Proxy Server (사내)
    │
    ├── Qwen 3 (235B / 80B / Coder Flash)
    ├── Minimax M2.5
    ├── GLM 4.7
    ├── OpenAI GPT-4o (외부)
    ├── Claude (외부)
    └── Gemini (외부)
```

- API Key 하나로 LiteLLM을 통해 여러 모델에 접근
- OpenAI SDK 호환 인터페이스 사용 (model 이름만 바꾸면 됨)
- 모델별 Provider 클래스가 vision 지원, 토큰 제한 등 차이를 추상화
