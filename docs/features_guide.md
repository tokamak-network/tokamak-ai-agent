# 🚀 Tokamak AI Agent - 기능 가이드

> **v0.1.0** | VS Code용 AI 코딩 어시스턴트  
> LiteLLM 기반 OpenAI-호환 API를 활용한 자율형 코딩 에이전트

---

## 📋 목차

1. [시작하기](#-시작하기)
2. [채팅 패널](#-채팅-패널)
3. [3가지 동작 모드](#-3가지-동작-모드)
4. [파일 오퍼레이션](#-파일-오퍼레이션)
5. [인라인 코드 완성](#-인라인-코드-완성)
6. [코드 액션](#-코드-액션)
7. [슬래시 커맨드 & 스킬](#-슬래시-커맨드--스킬)
8. [컨텍스트 기능](#-컨텍스트-기능)
9. [자율 에이전트 엔진](#-자율-에이전트-엔진)
10. [설정](#-설정)

---

## 🏁 시작하기

### 필수 설정

1. **VS Code 확장 설치** 후 `Cmd+Shift+P` → `Tokamak: Open Chat` 실행
2. **Settings**(`Cmd+,`) → `tokamak` 검색 후 아래 항목 설정:
   - `tokamak.apiKey`: AI API 키
   - `tokamak.baseUrl`: API 엔드포인트 URL (예: `https://your-api.com/v1`)
   - `tokamak.models`: 사용 가능한 모델 목록 (배열)
   - `tokamak.selectedModel`: 기본 선택 모델

### 단축키

| 단축키 | 동작 |
|--------|------|
| `Cmd+Shift+I` | 채팅 패널 열기 |

### 등록된 커맨드 (Cmd+Shift+P)

| 커맨드 | 설명 |
|--------|------|
| `Tokamak: Open Chat` | AI 채팅 패널 열기 |
| `Tokamak: Explain Code` | 선택한 코드 설명 |
| `Tokamak: Refactor Code` | 선택한 코드 리팩토링 |
| `Tokamak: Clear Chat History` | 채팅 기록 초기화 |
| `Tokamak: Send to Chat` | 선택한 코드를 채팅으로 보내기 |
| `Tokamak: Initialize Skills Folder` | `.tokamak/skills/` 폴더 생성 |
| `Tokamak: Initialize Project Knowledge Folder` | `.tokamak/knowledge/` 폴더 및 샘플 파일 생성 |

---

## 💬 채팅 패널

AI와 대화하는 메인 인터페이스입니다.

### 주요 기능

- **실시간 스트리밍 응답**: AI 답변이 토큰 단위로 실시간 표시
- **마크다운 렌더링**: 코드 블록, 볼드, 인라인 코드 등 자동 렌더링
- **모델 선택**: 상단 드롭다운에서 사용할 AI 모델 변경 가능
- **대화 기록 저장/복원**: 세션 간 대화 내용이 자동 저장됨
- **생성 중지**: Stop 버튼으로 AI 응답 생성을 중간에 중단 가능
- **New Chat**: 새 대화 시작 가능

### 코드 블록 액션 버튼

AI가 코드 블록을 포함한 답변을 하면 각 블록 상단에 버튼이 표시됩니다:

| 버튼 | 동작 | 표시 조건 |
|------|------|-----------|
| **Insert** | 현재 에디터 커서 위치에 코드 삽입 | 모든 코드 블록 |
| **▶ Run** | 터미널(`Tokamak`)에서 명령 실행 | `bash`, `sh`, `zsh`, `shell`, `powershell`, `cmd`, `python`, `python3` |

### 파일 첨부

- **`@` 입력**: 파일 검색 자동완성 → 선택한 파일의 내용이 컨텍스트에 포함됨
- **드래그 앤 드롭**: 파일을 채팅창으로 드래그하여 첨부
- **이미지 붙여넣기**: 클립보드의 이미지를 `Ctrl+V`로 첨부 (멀티모달 지원)

---

## 🎯 3가지 동작 모드

채팅 패널 상단의 탭으로 전환합니다:

### ASK 모드
- **용도**: 단순 질문, 코드 설명 요청
- **동작**: 현재 에디터 컨텍스트 + 워크스페이스 정보를 포함하여 AI에게 질문
- **특징**: 파일 수정 없음, 순수 대화

### PLAN 모드
- **용도**: 구현 계획 수립
- **동작**: AI가 프로젝트 구조를 분석하고 단계별 실행 계획을 마크다운 체크리스트로 제시
- **특징**: 계획만 수립하고 실행은 하지 않음 (사용자 확인 후 실행)

### AGENT 모드
- **용도**: 자율적으로 코드 작성/수정/실행
- **동작**: AI가 계획 수립 → 파일 생성/수정/삭제 → 에러 감지/자동 수정까지 자율 수행
- **특징**: `<<<FILE_OPERATION>>>` 블록을 통해 파일 변경 사항을 제안하고, 사용자가 Apply/Reject 선택

---

## 📁 파일 오퍼레이션

AGENT 모드에서 AI가 파일 변경을 제안할 때 사용되는 시스템입니다.

### 지원 오퍼레이션

| 타입 | 설명 |
|------|------|
| `create` | 새 파일 생성 |
| `edit` | 기존 파일 수정 (SEARCH/REPLACE 패턴 지원) |
| `delete` | 파일 삭제 |
| `read` | 파일 읽기 (AI가 내용 확인 필요 시) |

### 사용 흐름

1. AI가 `<<<FILE_OPERATION>>>` 블록으로 변경 사항 제안
2. 채팅 하단에 **Operations Panel** 표시 (파일 목록 + 설명)
3. 각 오퍼레이션 미리보기/개별삭제 가능
4. **Apply All** → 일괄 적용 / **Reject** → 전체 취소

### SEARCH/REPLACE 형식 (edit)

기존 파일의 특정 부분만 수정할 때 사용:
```
<<<<<<< SEARCH
기존 코드...
=======
수정된 코드...
>>>>>>> REPLACE
```

---

## ✨ 인라인 코드 완성 (Ghost Text)

코드를 작성하는 동안 AI가 자동으로 다음 코드를 제안합니다.

- **트리거**: 타이핑 중 자동 (디바운스 300ms 기본값)
- **수락**: `Tab` 키로 제안 수락
- **컨텍스트**: 커서 전후 50줄/20줄을 참조
- **설정**:
  - `tokamak.enableInlineCompletion`: 활성화/비활성화 (기본: true)
  - `tokamak.completionDebounceMs`: 디바운스 딜레이 (기본: 300ms)

---

## 🔧 코드 액션

에디터에서 코드를 선택한 후 사용할 수 있는 기능입니다.

### 코드 설명 (Explain Code)
- **사용법**: 코드 선택 → 우클릭 → `Tokamak: Explain Code` 또는 `Cmd+Shift+P` → 커맨드 실행
- **결과**: Output 패널에 상세 설명 표시

### 코드 리팩토링 (Refactor Code)
- **사용법**: 코드 선택 → 우클릭 → `Tokamak: Refactor Code`
- **리팩토링 옵션**:
  - Improve Readability (가독성 개선)
  - Optimize Performance (성능 최적화)
  - Add Error Handling (에러 처리 추가)
  - Extract Function (함수 추출)
  - Add Types (타입 추가)
  - Custom (사용자 정의)
- **결과**: Apply Changes(바로 적용) / Show in Output(출력 확인) / Cancel(취소) 선택

### 코드를 채팅으로 보내기 (Send to Chat)
- **사용법**: 코드 선택 → 우클릭 → `Tokamak: Send to Chat`
- **동작**: 선택한 코드가 채팅 입력창에 자동 입력되고 파일이 컨텍스트로 첨부됨

---

## ⚡ 슬래시 커맨드 & 스킬

채팅 입력창에 `/`를 입력하면 사용 가능한 커맨드 목록이 표시됩니다.

### 기본 내장 스킬 (7개)

| 커맨드 | 설명 |
|--------|------|
| `/explain` | 코드 상세 설명 |
| `/refactor` | 리팩토링 제안 |
| `/fix` | 버그 찾기 및 수정 |
| `/test` | 유닛 테스트 생성 |
| `/docs` | 문서화 생성 |
| `/optimize` | 성능 최적화 |
| `/security` | 보안 감사 |

### 커스텀 스킬 생성

`Tokamak: Initialize Skills Folder` 커맨드 → `.tokamak/skills/` 폴더에 마크다운 파일 생성:

```yaml
---
description: 커맨드 설명
---

AI에게 전달할 프롬프트 내용...
```

커스텀 스킬 파일을 추가하면 `/` 자동완성에 자동 표시됩니다.

---

## 📎 컨텍스트 기능

AI에게 자동으로 전달되는 프로젝트 정보입니다.

### 자동 수집 컨텍스트

| 항목 | 설명 |
|------|------|
| **현재 에디터** | 열려있는 파일의 경로, 언어, 선택 영역 또는 커서 주변 코드 |
| **프로젝트 구조** | 워크스페이스의 파일 트리 (node_modules 등 제외) |
| **워크스페이스 정보** | 워크스페이스 이름 |
| **첨부 파일** | `@`로 첨부하거나 드래그한 파일의 전체 내용 |
| **대화 기록** | 이전 대화 내용 (컨텍스트 유지) |
| **프로젝트 지식** | `.tokamak/knowledge/` 내 `.md`, `.txt` (새 대화 시 자동 포함) |

### 프로젝트 지식 베이스 (.tokamak/knowledge/)

- **위치**: 워크스페이스 루트의 `.tokamak/knowledge/` (프로젝트별)
- **역할**: 코딩 컨벤션, 아키텍처 결정, 자주 쓰는 패턴 등을 문서로 두면 **새 채팅을 시작할 때** 시스템 프롬프트에 자동으로 포함됩니다.
- **지원 형식**: `.md`, `.txt` (파일명 알파벳 순, 전체 약 8KB 제한)
- **초기화**: `Tokamak: Initialize Project Knowledge Folder` 실행 시 폴더와 샘플 `conventions.md`, `README.md` 생성

### RAG 기반 파일 검색 (AGENT 모드)

- 사용자 질문에서 키워드 추출 → 파일명 매칭으로 관련 파일 검색
- 가중치 기반 스코어링 (활성 에디터: 20점, 파일명 매칭: 10점, TS/TSX: +5점)
- 상위 15개 파일을 컨텍스트에 포함
- 큰 파일은 AI를 통한 자동 요약으로 토큰 절약

---

## 🤖 자율 에이전트 엔진

AGENT 모드의 핵심 엔진입니다. 상태 머신(FSM) 기반의 자율 루프로 동작합니다.

### 상태 전이 다이어그램

```
Idle → Planning → Executing → Observing → Executing → ... → Done
                      ↓            ↓
                   Fixing ←────────┘
                      ↓
                   Observing → (성공) → Executing
                      ↓
                   Error (최대 재시도 초과)
```

### 각 단계 설명

| 상태 | 역할 | 담당 모듈 |
|------|------|-----------|
| **Planning** | 사용자 요청 분석 → 단계별 계획 수립 | `Planner` |
| **Executing** | 계획의 각 단계를 JSON Action으로 변환하여 실행 | `Executor` |
| **Observing** | VS Code 진단 정보(에러/경고) 수집 | `Observer` |
| **Fixing** | 에러 발생 시 AI에게 수정 요청 → 자동 재시도 (최대 3회) | `Engine` |
| **Done** | 모든 단계 완료 | - |
| **Error** | 복구 불가능한 오류 | - |

### 핵심 특징

- **지연 액션 생성(Lazy)**: 계획 수립 시 코드를 작성하지 않고, 실행 직전에 구체적 코드 생성 → 토큰 절약
- **의존성 관리**: 단계 간 `[depends: step-id]`로 실행 순서 보장
- **자동 에러 수정**: Observer가 VS Code 진단 정보를 수집하여 에러 감지 → 자동 수정 시도
- **SEARCH/REPLACE 지원**: 파일 전체 덮어쓰기 대신 부분 수정 가능

---

## ⚙️ 설정

`Settings > Tokamak AI Agent` 또는 `settings.json`에서 설정합니다.

| 설정 키 | 타입 | 기본값 | 설명 |
|---------|------|--------|------|
| `tokamak.apiKey` | string | `""` | AI API 키 |
| `tokamak.baseUrl` | string | `""` | AI API 엔드포인트 URL |
| `tokamak.models` | string[] | `["qwen3-235b"]` | 사용 가능한 모델 목록 |
| `tokamak.selectedModel` | string | `"qwen3-235b"` | 현재 선택된 모델 |
| `tokamak.enableInlineCompletion` | boolean | `true` | 인라인 코드 완성 활성화 |
| `tokamak.completionDebounceMs` | number | `300` | 자동완성 디바운스 딜레이(ms) |

---

## 🏗️ 아키텍처 개요

```
src/
├── extension.ts          # VS Code 확장 진입점 (커맨드 등록)
├── main.ts               # 에이전트 엔진 독립 실행 진입점
├── api/
│   └── client.ts         # OpenAI API 클라이언트 (스트리밍/일반/코드완성)
├── agent/
│   ├── engine.ts         # 자율 루프 엔진 (FSM)
│   ├── executor.ts       # 파일 CRUD + 터미널 실행
│   ├── planner.ts        # AI 응답 → 구조화된 계획 파싱
│   ├── observer.ts       # VS Code 진단 정보 수집
│   ├── searcher.ts       # RAG 기반 파일 검색
│   ├── contextManager.ts # 컨텍스트 조립 (파일 읽기 + 요약)
│   ├── summarizer.ts     # AI 기반 코드 요약
│   └── types.ts          # 타입 정의
├── chat/
│   └── chatPanel.ts      # Webview 채팅 UI + 메시지 핸들링
├── completion/
│   └── inlineCompletionProvider.ts  # Ghost Text 자동완성
├── codeActions/
│   └── codeActionProvider.ts        # 코드 설명/리팩토링
└── config/
    └── settings.ts       # VS Code 설정 관리
```
