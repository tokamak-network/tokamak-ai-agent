# 📌 1. 프로젝트 요약 및 핵심 스펙

* **프로젝트명**: Tokamak AI Agent
* **사용 언어/환경**: TypeScript, Node.js (esbuild로 번들링)
* **주요 패키지**: `vscode` (익스텐션 API), `openai` (AI 모델과의 통신용 SDK)
* **주요 목적**: GitHub Copilot이나 Cursor와 유사하게, 에디터 내에서 채팅, 인라인 자동완성, 코드 리팩토링, 자율 에이전트 기능을 지원하여 회사 내부 AI 모델(예: `qwen3-235b`, `qwen3-coder-flash` 등)을 효과적으로 활용하기 위함입니다.

---

# 🚀 2. 핵심 제공 기능

### 💬 AI 챗봇 기능 (Chat Panel)
* 에디터 내에서 웹뷰(Webview) 형태로 AI와 대화할 수 있는 패널 제공.
* 멘션(`@`)을 통한 현재 작업 중인 파일 및 코드 컨텍스트 첨부 기능.
* **3가지 모드 지원**:
  * **Ask**: 일반적인 질문-답변 모드
  * **Plan**: 코드 작성 전 아키텍처 및 구현 계획 수립
  * **Agent**: 자율형 에이전트로서 실제로 파일 생성, 수정, 삭제 등의 작업을 스스로 수행. (변경 전 체크포인트를 저장하고 롤백/미리보기 기능 제공)

### ✨ 인라인 자동 완성 (Ghost Text)
* 유저가 코드를 타이핑할 때 백그라운드에서 실시간으로 다음 코드를 제안합니다.

### ⚡️ Slash Commands (Skills 시스템)
* `/explain`, `/refactor`, `/fix` 등의 명령어로 빠르게 액션을 수행.
* 프로젝트별로 `.tokamak/skills/` 폴더를 만들어 팀 단위로 커스텀 프롬프트를 공유할 수 있는 기능 지원.

### 🖱 Code Actions (우클릭 메뉴 연동)
* 에디터에서 코드를 드래그하고 우클릭하면 코드 설명(Explain), 리팩토링(Refactor) 기능을 바로 호출할 수 있습니다.

---

# 📂 3. 내부 디렉터리 및 아키텍처 분석 (`src/` 폴더 중심)
소스 코드는 기능별로 `src` 내 하위 폴더들에 잘 모듈화되어 있습니다.

### `src/extension.ts` & `src/main.ts`
* 익스텐션의 진입점(Entry Point). 
* 설정, 사이드바, 커맨드, Code Action, 인라인 자동완성 프로바이더 등을 VS Code에 등록(Activate)합니다.

### `src/chat/` (채팅 UI 및 로직)
* `chatPanel.ts`, `chatViewProvider.ts`: 익스텐션의 핵심인 웹뷰(Webview) 기반 채팅창을 렌더링하고, 유저의 입력과 AI의 응답, 버튼 클릭(코드 삽입, 터미널 실행 등) 이벤트를 처리합니다.

### `src/agent/` (자율 에이전트 코어)
* Agent 모드 로직을 담당하는 핵심 폴더입니다.
* `planner.ts`, `executor.ts`, `engine.ts`: 주어진 목표를 세부 단위로 나누고, 실행하고, 관리하는 엔진입니다.
* `searcher.ts`, `observer.ts`, `summarizer.ts`: 에디터 환경의 로컬 파일이나 프로젝트 구조를 탐색하고, 컨텍스트를 파악해 요약하는 역할을 합니다.
* `checkpointManager.ts`: 에이전트가 코드를 마음대로 변경하기 전에 상태를 백업하고 되돌릴 수 있는 롤백 기능을 제공합니다.

### `src/api/` (통신 계층)
* `client.ts`: OpenAI Node.js SDK를 감싸서 세팅된 LiteLLM 서버 엔드포인트(`https://api.ai.tokamak.network`)로 요청을 보내고 토큰 스트리밍 응답을 받는 추상화 계층입니다.

### `src/completion/` 및 `src/codeActions/`
* VS Code의 기본 에디터 기능과 연동되는 부분입니다. 
* 입력 중 코드 자동완성(`CompletionProvider`) 메뉴와 우클릭 코드 분석 메뉴(`CodeActionProvider`)를 제어합니다.

---

# 💡 요약

이 프로젝트는 최신 AI 어시스턴트(특히 Cursor 등)가 가진 장점을 회사 내부망 또는 전용 AI 모델 환경에 맞춰 통합한 매우 고도화된 VS Code 익스텐션입니다. 

단순한 API 호출용 챗봇을 넘어서, 직접 파일을 수정하고 계획을 세우는 Autonomous Agent 구조(`src/agent`), 커스텀 프롬프트를 조직원끼리 공유할 수 있는 Skills 구조 등을 갖추고 있어 확장성이 높은 구조로 설계되어 있습니다.

추가로 특정 컴포넌트나 폴더의 구체적인 소스코드를 보고 싶으시다면 편하게 말씀해 주세요!