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

### 2.4 대화 히스토리 관리 UI

**현재 문제**: 대화 기록이 자동 저장되지만 이전 세션을 브라우징/복원하는 UI가 없음

**구현 계획**:
- 사이드바에 이전 대화 목록 표시 (제목, 날짜, 모드)
- 대화 검색 기능
- 대화 삭제/내보내기(Export) 기능

**관련 파일**: `src/chat/chatPanel.ts` → 웹뷰 HTML에 히스토리 패널 추가

---

## 🚀 Phase 3: 고도화 (장기)

### 3.1 멀티 파일 동시 편집 지원

**현재 문제**: 에이전트가 한 번에 하나의 파일만 처리

**구현 계획**:
- 여러 파일을 병렬로 읽기/수정하는 워크플로우
- 파일 간 의존성 분석 (import/export 관계)
- Atomic 트랜잭션 패턴: 모든 편집이 성공해야 적용, 하나라도 실패하면 전체 롤백

---

### 3.2 Git 통합

**구현 계획**:
- 에이전트 작업 전 자동 브랜치 생성
- 변경 사항 자동 커밋 (커밋 메시지 AI 생성)
- 작업 실패 시 자동 `git reset`으로 롤백
- Diff 기반 코드 리뷰 요청

---

### 3.3 프로젝트 지식 베이스 (Persistent Memory)

**구현 계획**:
- `.tokamak/knowledge/` 폴더에 프로젝트 관련 지식 저장
- 코딩 컨벤션, 아키텍처 결정, 자주 쓰는 패턴 등 축적
- 새 대화 시작 시 자동으로 관련 지식 컨텍스트에 포함

---

### 3.4 웹 검색 통합

**구현 계획**:
- 에러 메시지나 라이브러리 문서를 웹에서 검색
- 검색 결과를 AI 컨텍스트에 포함하여 더 정확한 답변 제공
- `/search` 슬래시 커맨드로 수동 트리거 가능

---

### 3.5 MCP (Model Context Protocol) 지원

**구현 계획**:
- 외부 도구(데이터베이스, API 서버 등)와 표준화된 방식으로 연동
- MCP 서버 설정 UI 제공
- 에이전트가 MCP 도구를 자율적으로 사용

---

## 📋 우선순위 요약

| 순위 | 기능 | 난이도 | 임팩트 | Phase | 상태 |
|------|------|--------|--------|-------|------|
| ~~🥇~~ | ~~터미널 출력 캡처~~ | ⭐⭐ | ⭐⭐⭐⭐⭐ | 1 | ✅ 완료 |
| ~~🥈~~ | ~~Reflecting 상태 구현~~ | ⭐⭐ | ⭐⭐⭐⭐ | 1 | ✅ 완료 |
| ~~🥉~~ | ~~Replan 기능~~ | ⭐⭐⭐ | ⭐⭐⭐⭐ | 1 | ✅ 완료 |
| ~~4~~ | ~~파일 내용 검색~~ | ⭐⭐ | ⭐⭐⭐⭐ | 2 | ✅ 완료 |
| ~~5~~ | ~~Diff 미리보기~~ | ⭐⭐⭐ | ⭐⭐⭐ | 2 | ✅ 완료 |
| ~~6~~ | ~~토큰 사용량 표시~~ | ⭐ | ⭐⭐⭐ | 2 | ✅ 완료 |
| 7 | 대화 히스토리 UI | ⭐⭐⭐ | ⭐⭐⭐ | 2 | |
| 8 | Git 통합 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 3 | |
| 9 | 프로젝트 지식 베이스 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 3 | |
| 10 | 웹 검색 통합 | ⭐⭐⭐ | ⭐⭐⭐ | 3 | |
| 11 | MCP 지원 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 3 | |

---

> 🎉 **Phase 2 진행 중!** (2026-02-17)  
> 파일 내용 검색, Diff 미리보기, 토큰 사용량 표시 기능이 모두 완료되어 개발 경험이 크게 향상되었습니다!  
> 
> 💡 **다음 단계**: **대화 히스토리 관리 UI**를 구현하면 이전 대화를 쉽게 찾아보고 복원할 수 있습니다.
