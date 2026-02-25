# Tokamak AI Agent: Empowering the Ecosystem with an Autonomous Coding Assistant

The transition toward AI-assisted development is accelerating across the Web3 space. However, many developers building the decentralized future still face significant hurdles, having to choose between fragmented, external tools and their established workflows. 

At Tokamak Network, we are dedicated to continuously expanding our infrastructure and providing developers with the most advanced resources to build effortlessly on our ecosystem. To embody this vision, we are proud to introduce our latest service: the **Tokamak AI Agent**. 

Driven by our high-performance proprietary models, the Tokamak AI Agent is a fully autonomous coding assistant designed to supercharge the development velocity of our community. This article outlines the core architecture of this new service and explains how you can participate in the early Beta program.

### The Evolution of Development Experience
The Tokamak AI Agent is designed to be more than a simple chat interface. It acts as a closed-loop autonomous engine capable of planning, executing, observing, and reflecting on software development tasks directly within VS Code.

*   **Autonomous Agent Mode**: Beyond simple auto-formatting, the agent autonomously creates, edits, and deletes files to achieve complex objectives. Provide a directive like "Refactor the payment module and add test coverage," and the agent will independently plan the required steps and execute the file operations.
*   **Checkpoint & Rollback System**: To ensure absolute workspace integrity, the agent automatically creates secure snapshots before any autonomous edits. Developers can visually compare differences and instantly rollback if the agent's work does not align with their intentions.
*   **Terminal Loop Integration**: The agent reads active terminal outputs. If an error occurs during runtime or testing, the agent proactively analyzes the `stderr` logs and autonomously injects the necessary fixes, minimizing the manual "run-error-fix" loop.
*   **Decentralized Knowledge Sharing**: Through the `.tokamak/skills/` infrastructure, development teams can define custom prompt schemas (e.g., specific code review standards) and seamlessly share them via Git, fostering a unified organizational coding culture.

### How to Install and Start
Getting started with the Tokamak AI Agent is straightforward and takes less than a minute. You can install it directly from our GitHub repository using the pre-built VSIX file.

1.  **Download the Extension**: Visit our [GitHub Releases page](https://github.com/tokamak-network/tokamak-ai-agent/releases) and download the latest `.vsix` package (e.g., `tokamak-agent-0.1.2.vsix`).
2.  **Open VS Code**: Navigate to the **Extensions** view (`Cmd+Shift+X` on Mac or `Ctrl+Shift+X` on Windows).
3.  **Install from VSIX**: Click the **Views and More Actions...** (... icon) at the top right of the Extensions view, select **Install from VSIX...**, and choose the downloaded file.
4.  **Configure API Key**: Enter the exclusive API key received via Telegram into your VS Code settings (`Cmd+,` or `Ctrl+,`) under `tokamak.apiKey` to immediately activate the autonomous agent.
5.  **How to Use**: Press (`Cmd+Shift+I` or `Ctrl+Shift+I`) within VS Code to launch the Tokamak AI Agent.

### 🚀 Exclusive Beta Program: Free API Keys for the First 5 Users
The Tokamak Network is built on community collaboration. To ensure optimal performance, the Tokamak AI Agent currently utilizes highly capable, proprietary local LLMs (`qwen3-235b`, `minimax-m2.5`, `glm-4.7`). 

As we are in the initial rollout phase, we are looking for passionate early testers to provide feedback and shape the future of autonomous development tools within our ecosystem.

**To accelerate adoption, we are giving away FREE API Keys to the first 5 developers who reach out to us!**

This is a strictly first-come, first-served opportunity. Claim your free key and experience the most advanced autonomous workspace before the spots are filled.

👉 **[Link to Telegram: Claim your Free API Key]**

---

# Tokamak AI Agent: 생태계에 강력함을 더하는 자율형 코딩 어시스턴트

Web3 생태계 전반에서 AI 기반 개발 환경으로의 전환이 가속화되고 있습니다. 하지만 파편화된 외부 툴과 기존 작업 환경 사이에서 고민해야 하는 점은 스마트 컨트랙트 및 디앱(DApp) 개발자들에게 여전히 큰 장벽으로 남아 있습니다.

Tokamak Network는 개발자들이 우리 생태계 위에서 그 어떤 제약 없이 혁신적인 제품을 빌드할 수 있도록 인프라를 확장해 나가는 데 전념하고 있습니다. 이러한 비전의 일환으로, 우리는 개발자 경험(Developer Experience)을 근본적으로 혁신할 새로운 서비스인 **Tokamak AI Agent**를 공식적으로 소개합니다.

Tokamak Network의 고성능 자체 모델 인프라로 구동되는 Tokamak AI Agent는, 단순한 보조 도구를 넘어 커뮤니티의 개발 속도를 극대화하도록 설계된 '완전 자율형(Fully Autonomous) 코딩 어시스턴트'입니다. 본 글에서는 이 혁신적인 서비스의 핵심 아키텍처를 안내하고, 초기 Beta 프로그램에 참여하는 방법을 소개합니다.

### 개발 경험의 진화
Tokamak AI Agent는 단순한 대화형 인터페이스를 넘어섭니다. 이 에이전트는 기획(Plan), 실행(Execute), 관찰(Observe), 자기 반성 및 수정(Reflect & Fix) 단계로 이어지는 폐쇄 루프(Closed-loop) 엔진을 통해 VS Code 내에서 직접 구동됩니다.

*   **자율형 에이전트 모드 (Autonomous Agent Mode)**: 단순한 코드 제안을 넘어 직접 파일을 생성, 수정, 삭제합니다. "결제 모듈을 리팩토링하고 테스트 코드를 추가하라"는 지시를 내리면, 에이전트가 단계를 세분화하고 스스로 작업을 수행합니다.
*   **체크포인트 및 롤백 시스템 (Checkpoint System)**: 프로젝트 안정성을 완벽히 보장하기 위해, 에이전트가 코드를 수정하기 직전 자동으로 스냅샷을 저장합니다. 개발자는 뷰어를 통해 변경 사항을 즉시 비교하고 버튼 클릭 한 번으로 완벽하게 이전 상태로 롤백할 수 있습니다.
*   **터미널 통합 및 디버깅 (Terminal Loop Integration)**: 에이전트는 발생한 터미널 에러를 인지합니다. 코드 테스트 시 에러가 발생하면 에이전트가 로그를 분석하고 원인을 파악하여 코드를 자율적으로 수정(Auto-Fix)합니다.
*   **지식의 분산형 공유 (Knowledge Sharing via Skills)**: 팀별 코드 컨벤션 등을 `.tokamak/skills/` 디렉터리에 마크다운으로 정의하여 Git을 통해 구성원 전체가 일관된 프롬프트 환경을 공유할 수 있도록 지원합니다.

### 1분 만에 설치하고 시작하기
Tokamak AI Agent는 복잡한 빌드 과정 없이 손쉽게 설치하여 사용할 수 있습니다. GitHub에서 제공하는 빌드 완료된 VSIX 파일을 통해 1분 만에 설치를 완료해 보세요.

1.  **확장 프로그램 다운로드**: [GitHub Releases 페이지](https://github.com/tokamak-network/tokamak-ai-agent/releases)에 접속하여 최신 버전의 `.vsix` 파일(예: `tokamak-agent-0.1.2.vsix`)을 다운로드합니다.
2.  **VS Code 실행**: VS Code를 열고 좌측 사이드바에서 **확장 프로그램** 아이콘(`Cmd+Shift+X` 또는 `Ctrl+Shift+X`)을 클릭합니다.
3.  **VSIX로 설치**: 확장 프로그램 뷰 상단 우측의 **기타 작업...** (점 세 개 모 모양 아이콘)을 클릭한 후, **VSIX에서 설치...(Install from VSIX...)**를 선택하고 다운로드한 파일을 엽니다.
4.  **API Key 설정**: 텔레그램을 통해 선착순으로 발급받은 전용 API Key를 VS Code 설정 창(`Cmd+,` 또는 `Ctrl+,`)의 `tokamak.apiKey`에 입력하면 즉시 자율형 에이전트가 완벽하게 활성화됩니다.
5. **사용법**: VS Code에서 (`Cmd+Shift+I` 또는 `Ctrl+Shift+I`)를 클릭하여 Tokamak AI Agent를 실행합니다.

### 🚀 익스클루시브 베타 프로그램: 선착순 5명 한정 무료 API Key
Tokamak Network 생태계는 커뮤니티와의 지속적인 교류를 기반으로 합니다. 최적의 퍼포먼스를 보장하기 위해 현재 Tokamak AI Agent는 당사의 고성능 전용 LLM 모델(`qwen3-235b`, `minimax-m2.5`, `glm-4.7`) 인프라 내에서 구동 중입니다.

이번 Beta 프로그램은 생태계 내 자율형 개발 인프라의 미래를 직접 피드백하고 빚어갈 초기 테스트 기여자를 찾기 위해 기획되었습니다.

**초기 릴리즈를 기념하여, 텔레그램으로 가장 먼저 연락을 주시는 선착순 5분에게 '무료 API Key'를 제공합니다!**

선착순 마감 시 무료 배포가 즉각 종료될 예정이니 늦지 않게 연락해 주세요. 지금 바로 연락하여 VS Code 내에 나만의 자율형 코딩 환경을 가장 먼저 구축해 보세요.

👉 **[선착순 무료 API Key 발급을 위한 텔레그램 링크]**
