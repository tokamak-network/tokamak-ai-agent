# Tokamak AI Agent Architecture

Tokamak AI Agent는 단순한 명령어 실행기에서 **자율 루프(Autonomous Loop)**를 가진 지능형 에이전트로 진화하고 있습니다. 현재 Phase 2인 **인터랙티브 플래너 및 자율 루프** 고도화가 완료되었습니다.

## 1. 개요 (High-level)

에이전트는 사용자의 질문으로부터 계획을 수립하고, 그 계획의 각 단계(Step)를 자율적으로 실행하며, 결과를 관찰하고 필요시 스스로 수정하는 **Loop**를 가집니다.

## 2. 핵심 컴포넌트

### 1) AgentEngine (Core Control)
- 에이전트의 전체 상태를 관리하는 State Machine 기반 제어 엔진입니다.
- **상태 전이**: `Idle -> Planning -> Executing -> Observing -> Reflecting -> Fixing -> Done`
- 계획에 따른 실행 흐름을 지휘하며, 예외 발생 시 복구 루틴을 활성화합니다.

### 2) Planner (Intelligence)
- AI의 텍스트 응답에서 구조화된 계획(`PlanStep[]`)을 추출합니다.
- **의존성 추출**: 단계 간 선후 관계(`[depends: id]`)를 해석하여 실행 순서를 결정합니다.
- **Re-planning**: 실행 중 상황 변화에 따라 계획을 동적으로 수정할 수 있는 기반을 제공합니다.

### 3) Executor (Action Layer)
- 실제 VS Code 환경에서 액션을 수행하는 유틸리티입니다.
- **File Control**: `vscode.workspace.fs`를 직접 다루어 파일 생성, 수정(Search/Replace 포함), 삭제를 수행합니다.
- **Terminal Execution**: 빌드나 테스트 실행을 위해 통합 터미널을 호출합니다.

### 4) Observer & Reflection (Verification - Phase 3 예정)
- **Observer**: 실행결과(Diagnostics, Terminal Log)를 실시간으로 모니터링합니다.
- **Reflection**: AI가 실행 결과를 평가하여 작업 완수 여부를 최종 판정합니다.

---

## 3. 실행 프로세스 (Autonomous Workflow)

```mermaid
graph TD
    User([User Message]) --> CP[ChatPanel]
    CP -->|Start| AE[AgentEngine]
    AE -->|Request Plan| AI[AI Model]
    AI -->|Text Response| PL[Planner]
    PL -->|Extract Steps| AE
    
    subgraph Execution Loop
        AE -->|Check Dependency| AE
        AE -->|Next Step| EX[Executor]
        EX -->|Modify Code| FS[(FileSystem)]
        EX -->|Return Result| AE
        AE -->|Verify| OB[Observer]
        OB -->|Detect Error| AE
        AE -->|Repair| FIX[Fixer/AI]
    end
    
    AE -->|Finish| Done([Work Completed])
    AE -->|Notify UI| CP
```

---

## 4. UI 구성: Implementation Plan Panel

인터랙티브한 사용자 경험을 위해 WebView 상단에 전용 패널을 제공합니다.
- **상태 아이콘**:
    - `○`: 대기 중 (Pending)
    - `⚡`: 현재 실행 중 (Running)
    - `✓`: 완료됨 (Done)
    - `✗`: 실패함 (Failed)
- **실시간 동기화**: 엔진의 모든 상태와 계획 업데이트는 UI에 즉시 반영됩니다.

---

## 5. 단계별 개발 로드맵

- [x] **Phase 1**: 상태 머신 및 기본 UI 연동 완료
- [x] **Phase 2**: 단계별 의존성 관리 및 자율 실행 루프 구축 완료
- [ ] **Phase 3**: Smart Observer (Linter 연동) 및 Auto-Fixer 구현 예정
- [ ] **Phase 4**: Global RAG 및 대규모 작업 최적화 예정
