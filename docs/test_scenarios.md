# Tokamak AI Agent Test Scenarios

이 문서는 구현된 Phase 1부터 Phase 4까지의 핵심 기능을 검증하기 위한 가이드를 제공합니다.

---

## 1. Phase 1 & 2: Autonomous Loop & Planner
**목표**: 에이전트가 복잡한 요청을 단계별로 나누고 의존성에 맞게 자율적으로 실행하는지 확인합니다.

### 시나리오: 다중 파일 생성 및 의존성 실행
- **질문**: `"docs 폴더에 requirements.md 파일을 만들고, 그 내용에 따라 src 폴더에 main.ts 파일을 생성해줘."`
- **확인 포인트**:
    - [ ] `Planner`가 두 개의 단계를 생성하는지 (1. write requirements.md, 2. write main.ts)
    - [ ] 두 번째 단계가 첫 번째 단계에 의존(`dependsOn`)하는지
    - [ ] 첫 번째 단계 완료 후 두 번째 단계가 자동으로 시작되는지

---

## 2. Phase 3: Smart Observer & Auto-Fixer
**목표**: 에러 발생 시 에이전트가 스스로 감지하고 수정하는지 확인합니다.

### 시나리오: 구문 에러 유도 및 자동 수정
- **질문**: `"src/agent/engine.ts 파일의 constructor 마지막에 문법에 맞지 않는 랜덤한 문자열을 추가해서 에러를 내봐. 그리고 그걸 다시 스스로 고쳐줘."`
- **확인 포인트**:
    - [ ] `Executing` 단계에서 에러 유도 코드 삽입
    - [ ] `Observing` 단계에서 VS Code의 에러(빨간 줄)를 감지하는지
    - [ ] `Fixing` 단계로 전이되어 AI가 수정안을 제시하고 적용하는지
    - [ ] 최종적으로 에러가 사라지고 `Done` 상태가 되는지

---

## 3. Phase 4: Global RAG (Search & Summary)
**목표**: 에이전트가 파일명을 알려주지 않아도 프로젝트 전체 맥락을 통해 관련 정보를 찾아내는지 확인합니다.

### 시나리오 1: 파일명 언급 없는 코드 분석
- **질문**: `"이 프로젝트에서 사용자의 입력을 엔진에 전달하거나 업데이트하는 로직이 어디에 있는지 찾아보고 설명해줘."`
- **확인 포인트**:
    - [ ] `Searcher`가 `src/agent/engine.ts`나 `src/chat/chatPanel.ts`를 스스로 찾아내는지
    - [ ] `ContextManager`가 해당 파일들의 내용을 컨텍스트에 포함시키는지

### 시나리오 2: 대규모 컨텍스트 및 요약 (Stress Test)
- **질문**: `"현재 프로젝트의 모든 핵심 모듈(Engine, Planner, Executor, Observer, Searcher, ContextManager)의 상호작용 방식을 요약해서 알려줘."`
- **확인 포인트**:
    - [ ] 여러 파일을 동시에 검색(`Searcher`)하는지
    - [ ] 파일 내용이 많을 때 `Summarizer`가 작동하여 요약본을 생성하는지 (컨테이너 로그 확인 가능)
    - [ ] 토큰 제한 내에서 전체적인 아키텍처를 정확히 설명하는지

---

## 4. 모니터링 팁
- **Output 패널**: VS Code의 `Output` 탭에서 에이전트의 로그(Transition, Search Score 등)를 실시간으로 확인할 수 있습니다.
- **Problem 패널**: `Observer`가 감지하는 에러는 VS Code의 `Problems` 패널과 동기화됩니다.
