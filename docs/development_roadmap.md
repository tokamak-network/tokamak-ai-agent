# 🗺️ Tokamak AI Agent - 개발 로드맵

> 현재 v0.1.0 기반 분석 결과, 추가하면 좋을 기능들을 우선순위별로 정리한 문서입니다.

---

## 📊 현재 상태 요약

### ✅ 구현 완료
- 채팅 패널 (스트리밍, 마크다운 렌더링, 모델 선택)
- 3가지 모드 (ASK / PLAN / AGENT)
- 파일 오퍼레이션 (Create/Edit/Delete/Read + SEARCH/REPLACE)
- 인라인 코드 완성 (Ghost Text)
- 코드 설명/리팩토링 액션
- 슬래시 커맨드 & 커스텀 스킬
- 자율 에이전트 엔진 (Planning→Executing→Observing→Reflecting→Fixing 루프)
- RAG 기반 파일 검색 + 컨텍스트 조립
- **✨ 터미널 출력 캡처 및 AI 피드백** (v0.1.1)
- **✨ Reflecting 상태 구현 (셀프 리뷰)** (v0.1.1)
- **✨ Replan 기능 구현** (v0.1.1)
- **✨ 파일 내용 검색 (grep 기반)** (v0.1.1)
- **✨ 대화 히스토리 관리 UI** (v0.1.1)

---

## ✅ Phase 1: 핵심 개선 (완료)

### ✅ 1.1 터미널 출력 캡처 및 AI 피드백

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- `child_process.exec`을 사용하여 명령 실행 결과(stdout/stderr/error) 캡처
- Run 버튼 클릭 시 명령 실행 후 결과를 자동으로 AI에게 전달
- 타임아웃 30초, 최대 버퍼 1MB 설정
- 터미널은 사용자가 볼 수 있도록 표시하면서 동시에 출력 캡처

**수정된 파일**:
- `src/chat/chatPanel.ts` → `runInTerminal()` 함수 개선 완료
- `src/agent/executor.ts` → `runTerminal()` 함수를 `child_process.exec`로 교체 완료

---

### ✅ 1.2 Reflecting 상태 구현 (셀프 리뷰)

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- AI가 실행 결과를 평가하여 SUCCESS/RETRY/REPLAN 중 하나로 판단
- SUCCESS: 다음 단계로 진행
- RETRY: Fixing 상태로 전환하여 자동 수정 시도
- REPLAN: 계획 수정 후 재실행
- Observing 단계에서 에러가 없으면 Reflecting으로 전환하도록 수정

**수정된 파일**: `src/agent/engine.ts` → `handleReflection()`, `handleObservation()` 함수

---

### ✅ 1.3 Replan 기능 구현

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- 현재 계획 상태와 새로운 컨텍스트를 AI에게 전달하여 수정된 계획 생성
- 완료된(done) 단계는 유지하고, 실패한 단계는 수정/제거
- Reflecting 단계에서 REPLAN 필요 시 자동으로 계획 수정
- 비동기 함수로 변경하여 AI 스트리밍 응답 처리

**수정된 파일**: 
- `src/agent/planner.ts` → `replan()` 함수 구현 완료
- `src/agent/engine.ts` → Reflecting 단계에서 replan 호출 로직 추가

---

## 🔧 Phase 2: 기능 확장 (진행 중)

### ✅ 2.1 파일 내용 검색 (grep 기반)

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- 코드 파일(ts, tsx, js, jsx, py, go, java, cpp 등)의 내용을 직접 읽어서 키워드 검색
- 정규식 기반 단어 경계 매칭으로 정확도 향상
- 가중치 차등 부여: 파일명 매칭(10점), 내용 매칭(3점)
  - 파일명을 직접 언급하면 해당 파일이 최우선으로 검색됨
- 성능 최적화:
  - 최대 30개 파일로 검색 제한
  - 500KB 이상 큰 파일은 자동 스킵
  - 최대 5개 키워드로 제한
- 검색 이유 누적 표시 (예: "Name match: engine, Content match: execute")

**수정된 파일**: `src/agent/searcher.ts` → `searchInFileContents()` 함수 추가

---

### ✅ 2.2 Diff 미리보기 (편집 전/후 비교)

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- `vscode.commands.executeCommand('vscode.diff')` 활용하여 변경 전/후 비교 뷰 표시
- Operations Panel에 각 오퍼레이션마다 "Preview" 버튼 추가
- CREATE: 빈 파일 vs 새 내용 비교
- EDIT: 기존 파일 vs 수정된 내용 비교 (SEARCH/REPLACE 블록 자동 적용)
- DELETE: 파일 미리보기 + 경고 메시지
- `TextDocumentContentProvider`를 사용하여 임시 URI(`tokamak-preview:`)로 수정 내용 제공

**수정된 파일**: `src/chat/chatPanel.ts` → `previewFileOperation()` 함수 완성

---

### ✅ 2.3 토큰 사용량 표시

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- OpenAI API의 `stream_options: { include_usage: true }` 활용하여 스트리밍 중 토큰 사용량 수집
- `streamChatCompletion()` 함수 리팩토링:
  - 반환 타입을 `StreamResult` 객체로 변경 (`{ content: AsyncGenerator, usage: Promise<TokenUsage> }`)
  - 스트리밍 완료 후 토큰 사용량 정보를 Promise로 제공
- 웹뷰 하단에 토큰 사용량 표시 바 추가:
  - 총 토큰 수 (Total)
  - 프롬프트 토큰 수 (Prompt)
  - 완성 토큰 수 (Completion)
- 세션별 누적 토큰 추적 (New Chat 시 리셋)
- 천 단위 구분 기호 표시 (예: 1,234 tokens)

**수정된 파일**:
- `src/api/client.ts` → `streamChatCompletion()` API 변경, `TokenUsage` 인터페이스 추가
- `src/chat/chatPanel.ts` → 토큰 사용량 UI 추가 및 업데이트 로직
- `src/agent/engine.ts` → 새로운 API 사용
- `src/agent/summarizer.ts` → 새로운 API 사용
- `src/chat/chatViewProvider.ts` → 새로운 API 사용

---

### ✅ 2.4 대화 히스토리 관리 UI

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- 히스토리 패널 UI 구현 (사이드바 슬라이드 패널)
- 이전 대화 목록 표시 (제목, 날짜, 모드 배지)
- 대화 검색 기능 (제목 및 날짜 기반 실시간 필터링)
- 대화 삭제 기능 (각 세션 아이템에 삭제 버튼)
- 대화 내보내기 기능 (JSON 형식으로 파일 저장)
- 모드 배지 표시 (ASK/PLAN/AGENT 구분)
- 현재 활성 세션 하이라이트

**수정된 파일**:
- `src/chat/chatPanel.ts` → 히스토리 패널 HTML/CSS 추가, 검색/내보내기 기능 구현

---

### 📎 참고: Cline 파일 편집 방식 (정리)

[Cline](https://github.com/cline/cline)은 파일 편집을 **도구를 두 개로 분리**해서 애매함을 없앤다.

| 도구 | 파라미터 | 의미 |
|------|----------|------|
| **write_to_file** | `path` + `content` | **전체 파일 덮어쓰기**. 새로 만들기 또는 파일 전체 교체. |
| **replace_in_file** | `path` + `diff` | **부분 수정**. 기존 파일 내용 + `diff`(SEARCH/REPLACE 블록)로 새 내용 계산. |

- **ApplyPatch**: 별도로 `APPLY_PATCH` 도구로 unified-diff 스타일 패치(ADD/UPDATE/DELETE 마커)를 파싱해 여러 파일 변경을 한 번에 처리한다.
- **흐름**: Diff 뷰 열기 → 제안 내용 스트리밍/표시 → 사용자 Approve/Reject → Approve 시에만 `saveChanges()`로 디스크 반영.

**Tokamak에 적용할 때 참고**:
- **부분 수정**(끝에 추가, 처음에 추가, 중간 수정)은 **반드시 SEARCH/REPLACE**로만 처리하는 것이 안전하다. CONTENT에 SEARCH/REPLACE가 없으면 “전체 교체”로만 해석하는 현재 동작을 유지하는 것이 좋다.
- 필요하면 프롬프트/도구 정의에서 **write_to_file** vs **replace_in_file**처럼 “전체 쓰기”와 “diff 기반 수정”을 명시적으로 구분해, 모델이 형식을 잘못 쓰는 경우를 줄일 수 있다.
- Cline도 SEARCH 블록 매칭 실패, 모델별 포맷 오류 등 이슈가 있어 이슈 트래커에 보고된 바 있다. 우리도 SEARCH/REPLACE 규칙을 문서화하고, 실패 시 재시도/에러 메시지를 명확히 하는 방향이 유리하다.

---

## 🚀 Phase 3: 고도화 (장기)

### ✅ 3.1 멀티 파일 동시 편집 지원

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- `multi_write` 액션 타입 추가: 여러 파일을 한 번에 처리
- 파일 간 의존성 분석 기능 (`DependencyAnalyzer` 클래스)
  - import/export 관계 파싱
  - 의존성 그래프 구축
  - 영향받는 파일 자동 탐지
- Atomic 트랜잭션 패턴 구현
  - 모든 편집이 성공해야 적용
  - 하나라도 실패하면 전체 롤백 (백업 기반)
  - Non-atomic 모드도 지원 (순차 실행, 실패해도 계속)
- 에이전트 엔진 프롬프트 개선
  - Planning 단계에서 멀티 파일 작업 인식
  - Execution 단계에서 `multi_write` 액션 생성 지원
- SEARCH/REPLACE 형식 지원 (멀티 파일에서도 동작)

**사용 예시**:
```json
{
  "type": "multi_write",
  "payload": {
    "atomic": true,
    "operations": [
      { "operation": "create", "path": "Component.tsx", "content": "..." },
      { "operation": "create", "path": "Component.test.tsx", "content": "..." },
      { "operation": "edit", "path": "index.ts", "content": "<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE" }
    ]
  }
}
```

**수정된 파일**:
- `src/agent/dependencyAnalyzer.ts` → 새로 생성 (의존성 분석)
- `src/agent/types.ts` → `MultiFileOperation`, `MultiWritePayload` 인터페이스 추가
- `src/agent/executor.ts` → `multiWrite()` 메서드 및 Atomic 트랜잭션 구현
- `src/agent/engine.ts` → 멀티 파일 작업 프롬프트 및 의존성 분석기 통합

---

### 3.2 프로젝트 지식 베이스 (Persistent Memory) ✅

**구현 완료** (v0.1.1):
- `.tokamak/knowledge/` 폴더에 프로젝트 관련 지식 저장 (`.md`, `.txt` 지원)
- 코딩 컨벤션, 아키텍처 결정, 자주 쓰는 패턴 등을 파일로 두면 **새 대화 시작 시** 시스템 프롬프트에 자동 포함 (Ask/Plan/Agent 공통)
- 최대 약 8KB까지 로드, 파일명 알파벳 순
- 커맨드: `Tokamak: Initialize Project Knowledge Folder` 로 폴더 및 샘플 파일 생성

---

### 3.3 웹 검색 통합

**구현 계획**:
- 에러 메시지나 라이브러리 문서를 웹에서 검색
- 검색 결과를 AI 컨텍스트에 포함하여 더 정확한 답변 제공
- `/search` 슬래시 커맨드로 수동 트리거 가능

---

### 3.4 MCP (Model Context Protocol) 지원

**구현 계획**:
- 외부 도구(데이터베이스, API 서버 등)와 표준화된 방식으로 연동
- MCP 서버 설정 UI 제공
- 에이전트가 MCP 도구를 자율적으로 사용

---

## 🚀 Phase 4: 즉시 구현 (High Impact)

### ✅ 4.1 체크포인트 시스템 (Checkpoints)

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- `CheckpointManager` 클래스 구현: 워크스페이스 스냅샷 저장/복원
- 각 작업 단계 실행 전 자동 체크포인트 생성
- Checkpoints 패널 UI 추가 (Plan Panel 아래)
- "Compare" 버튼: 체크포인트와 현재 상태의 diff 확인
- "Restore" 버튼: 워크스페이스 복원 (Plan 상태도 함께 복원 가능)
- "Delete" 버튼: 불필요한 체크포인트 삭제
- "Refresh" 버튼: 체크포인트 목록 새로고침
- 체크포인트 메타데이터 저장 (단계 설명, 타임스탬프, 파일 개수)
- Extension storage에 체크포인트 영구 저장
- 대규모 프로젝트 지원 (최대 1000개 파일, 10MB 제한)

**사용 방법**:
1. Agent 모드에서 작업 시작
2. 각 단계마다 자동으로 체크포인트 생성
3. Checkpoints 패널에서 이전 상태 확인/복원 가능

**수정된 파일**:
- `src/agent/checkpointManager.ts` → 새로 생성 (체크포인트 관리)
- `src/agent/engine.ts` → 체크포인트 생성 로직 통합
- `src/agent/types.ts` → `AgentContext`에 `extensionContext` 추가
- `src/chat/chatPanel.ts` → 체크포인트 UI 및 핸들러 추가
- `docs/testing_checkpoints.md` → 테스트 가이드 작성

---

### ✅ 4.2 기본 터미널 실행 기능

**✅ 구현 완료** (2026-02-17)

**구현 내용**:
- Agent가 터미널 명령을 자동으로 실행할 수 있도록 `run` 액션 지원
- Planning 단계에서 터미널 명령 실행 계획 포함
- Execution 단계에서 터미널 명령 실행 프롬프트 추가
- VS Code 터미널 API를 사용하여 명령 실행 및 출력 표시
- 터미널 실행 결과를 채팅에 표시 및 Agent에게 피드백
- Agent 모드에서 FILE_OPERATION이 없을 때 자율 루프 시작

**사용 예시**:
- "npm install 실행해줘" → Agent가 자동으로 `npm install` 실행
- "테스트 실행해줘" → Agent가 `npm test` 실행
- "빌드해줘" → Agent가 `npm run build` 실행

**수정된 파일**:
- `src/agent/engine.ts` → Planning/Execution 프롬프트에 run 액션 설명 추가
- `src/agent/executor.ts` → VS Code 터미널 API 사용하여 명령 실행
- `src/chat/chatPanel.ts` → Agent 모드에서 자율 루프 시작 로직 추가

---

### 4.3 실시간 터미널 출력 스트리밍 (향후 구현)

**목적**: 장시간 실행되는 프로세스와 병행 작업 가능

**구현 계획**:
- 터미널 출력을 실시간으로 스트림하여 에이전트에게 전달
- "Proceed While Running" 버튼 추가
- dev server 같은 장시간 프로세스 실행 중에도 에이전트 작업 계속
- 새로운 터미널 출력 발생 시 에이전트에게 알림
- 컴파일 에러 등 즉시 반응 가능

**관련 파일**: `src/agent/executor.ts`, `src/chat/chatPanel.ts`


## 📋 우선순위 요약

| 순위 | 기능 | 난이도 | 임팩트 | Phase | 상태 |
|------|------|--------|--------|-------|------|
| ~~🥇~~ | ~~터미널 출력 캡처~~ | ⭐⭐ | ⭐⭐⭐⭐⭐ | 1 | ✅ 완료 |
| ~~🥈~~ | ~~Reflecting 상태 구현~~ | ⭐⭐ | ⭐⭐⭐⭐ | 1 | ✅ 완료 |
| ~~🥉~~ | ~~Replan 기능~~ | ⭐⭐⭐ | ⭐⭐⭐⭐ | 1 | ✅ 완료 |
| ~~4~~ | ~~파일 내용 검색~~ | ⭐⭐ | ⭐⭐⭐⭐ | 2 | ✅ 완료 |
| ~~5~~ | ~~Diff 미리보기~~ | ⭐⭐⭐ | ⭐⭐⭐ | 2 | ✅ 완료 |
| ~~6~~ | ~~토큰 사용량 표시~~ | ⭐ | ⭐⭐⭐ | 2 | ✅ 완료 |
| ~~7~~ | ~~대화 히스토리 UI~~ | ⭐⭐⭐ | ⭐⭐⭐ | 2 | ✅ 완료 |
| ~~8~~ | ~~멀티 파일 동시 편집~~ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 3 | ✅ 완료 |
| 9 | 프로젝트 지식 베이스 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 3 | ✅ 완료 |
| 10 | 웹 검색 통합 | ⭐⭐⭐ | ⭐⭐⭐ | 3 | |
| 11 | MCP 지원 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 3 | |
| ~~🚀 12~~ | ~~체크포인트 시스템~~ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 4 | ✅ 완료 |
| 🚀 13 | 실시간 터미널 스트리밍 | ⭐⭐⭐ | ⭐⭐⭐⭐ | 4 | |

---

> 🎉 **Phase 2 완료!** (2026-02-17)  
> 파일 내용 검색, Diff 미리보기, 토큰 사용량 표시, 대화 히스토리 관리 UI 기능이 모두 완료되어 개발 경험이 크게 향상되었습니다!  
> 
> 💡 **다음 단계**: **Phase 3**로 진행하여 Git 통합, 프로젝트 지식 베이스, 웹 검색 통합 등 고급 기능을 구현할 수 있습니다.
