# Tokamak Agent - Requirements Specification

## 1. 목적
Tokamak Agent는 사용자의 자연어 요청을 받아 코드 계획 수립, 실행, 오류 관찰 및 자동 수정을 수행하는 자율 프로그래밍 에이전트입니다.

## 2. 핵심 기능 요구사항

### 2.1 모듈 구조
- 에이전트는 다음 주요 모듈로 구성되어야 합니다:
  - `Planner`: 사용자 요청을 바탕으로 단계별 계획 수립
  - `Executor`: 코드 생성, 파일 읽기/쓰기 등 액션 실행
  - `Observer`: 코드 진단 정보(Linter, TypeScript 오류 등) 수집
  - `Searcher`: 관련 파일 검색 (RAG 기반)
  - `ContextManager`: 전역 컨텍스트 조합
  - `AgentEngine`: 상태 기반 중앙 루프 제어

### 2.2 진입점 (main)
- `src/main.ts` 파일에 `main()` 함수가 존재해야 하며, 다음을 수행:
  - VS Code 확장 활성화 시 호출
  - `AgentEngine` 인스턴스 생성
  - 사용자 입력 수신 대기
  - 에이전트 실행 루프 시작

### 2.3 확장 등록
- `main()` 함수는 `vscode.ExtensionContext`를 인자로 받아야 함
- 에이전트는 명령어 `tokamak-agent.start`로 실행 가능해야 함

## 3. 상태 관리
- 에이전트는 다음 상태를 가짐: `Idle`, `Planning`, `Executing`, `Observing`, `Reflecting`, `Fixing`, `Done`, `Error`
- 상태 전이 시 `onStateChange` 콜백 호출

## 4. 오류 처리
- 모든 모듈은 예외를 적절히 처리하고, `Error` 상태로 전이 가능해야 함
- 최대 3회 자동 수정 시도 후 실패 시 중단

## 5. 확장성
- 모든 모듈은 의존성 주입 가능해야 함 (테스트 용이성)
