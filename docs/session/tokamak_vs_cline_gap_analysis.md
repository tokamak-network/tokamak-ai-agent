# Tokamak Agent vs Cline — 핵심 Gap 분석

## Tokamak의 강점 (Cline에 없는 것)

- Multi-model review/debate 시스템 — Cline에는 없는 고유 기능
- 수렴 감지 (convergence detection) — 리뷰 라운드 자동 종료
- 모델별 프롬프트 최적화 — 방금 구현한 PromptHints 시스템
- 의존성 분석기 — import/export 그래프 추적

---

## 우선순위 1: 자율성을 심각하게 제한하는 Gap

| Gap | Cline 구현 | 영향도 |
|---|---|---|
| Auto-approval | 도구별 자동/수동/무시 세분화 | Agent 모드가 매번 사용자 확인 → 자율 에이전트가 아님 |
| 컨텍스트 윈도우 관리 | 80% 도달 시 자동 요약/압축 | 긴 대화에서 컨텍스트 넘침 → 크래시 또는 잘림 |
| 터미널 출력 피드백 루프 | 실행 결과를 AI에 돌려보내 자동 수정 | npm test 실패 → 수동 복붙 필요 |

Auto-approval이 가장 큰 병목입니다. Agent 모드에서 5단계 계획을 세워도, 매 파일 수정마다 사용자가 "Apply" 클릭해야 합니다. Cline은 read_file은 자동, write_to_file은 수동, execute_command는 패턴 기반 허용 같은 세분화된 권한 체계를 가지고 있습니다.

---

## 우선순위 2: 코드 이해력 차이

| Gap | Cline 구현 | 영향도 |
|---|---|---|
| Tree-sitter AST | 15개 언어, 함수/클래스 정의 추출 | list_code_definition_names로 파일 구조 즉시 파악 |
| Mention 시스템 | @file, @folder, @url, @problems | 사용자가 컨텍스트를 명시적으로 지정 가능 |
| 진단 기반 자동 수정 | linter 에러 전/후 비교 | 편집 후 새로 생긴 에러 자동 감지 → 자동 수정 |

현재 Tokamak의 Searcher는 키워드 기반이라, "이 함수를 호출하는 곳"같은 질문에 정확도가 낮습니다. Tree-sitter를 쓰면 파일을 전부 읽지 않고도 구조를 파악할 수 있어서 토큰 효율이 크게 올라갑니다.

---

## 우선순위 3: 확장성

| Gap | Cline 구현 | 영향도 |
|---|---|---|
| MCP (Model Context Protocol) | stdio/HTTP/SSE, OAuth, 동적 도구 등록 | 외부 DB, API, 도구 연동 불가 |
| 브라우저 자동화 | Puppeteer, screenshot, click, type | 웹 앱 테스트/디버깅 불가 |
| Hooks 시스템 | pre/post tool 실행 훅 | 사용자 커스텀 워크플로우 불가 |
| Rule 시스템 | .cline/rules/ YAML 기반 조건부 규칙 | 프로젝트별 코딩 규칙 강제 불가 |

MCP는 "에이전트를 에코시스템으로 확장"하는 핵심인데, 현재 Tokamak은 LiteLLM API 하나에만 의존합니다. MCP가 있으면 PostgreSQL 쿼리, Slack 알림, Jira 이슈 등을 도구로 추가할 수 있습니다.

---

## 우선순위 4: 안정성/품질

| Gap | Cline 구현 | 영향도 |
|---|---|---|
| Git 기반 체크포인트 | 실제 git commit으로 스냅샷 | Tokamak의 파일 복사 방식보다 안정적 |
| Rate limiting / 재시도 | 지수 백오프, retry-after 헤더 | API 에러 시 무한 실패 가능 |
| Unified diff (apply_patch) | 표준 diff 형식 지원 | SEARCH/REPLACE 실패 시 대안 없음 |

---

## Cline과 무관하게 Tokamak 자체의 발전 방향

### A. 에이전트 루프 강화

현재 상태 머신이 Planning → Executing → Observing → Reflecting → Fixing인데, Observing이 진단 수집만 합니다. 여기에:
- 터미널 실행 결과를 AI에 자동 피드백
- 테스트 실행 → 실패 시 자동 수정 루프
- 빌드 에러 → 자동 파싱 → 타겟 수정

이러면 "에이전트가 한 번에 작업 완료"하는 비율이 크게 올라갑니다.

### B. Streaming 파일 편집

현재 AI 응답이 완전히 끝난 후 파싱/적용합니다. Cline은 스트리밍 중에 diff를 실시간 표시합니다. 사용자 경험에서 큰 차이입니다.

### C. 인라인 코드 완성 강화

enableInlineCompletion이 있지만, 현재 얼마나 정교한지 확인 필요합니다. FIM (Fill-in-the-Middle) 최적화, 멀티라인 제안 등.

### D. 프로젝트 지식 자동 수집

현재 `.tokamak/knowledge/`는 사용자가 수동으로 작성합니다. 첫 실행 시 자동으로:
- package.json 분석 → 기술 스택 파악
- tsconfig.json / pyproject.toml → 빌드 설정
- README → 프로젝트 개요

이런 걸 자동 생성하면 "냉시작" 문제가 줄어듭니다.

---

## 권장 로드맵 (Impact × Effort)

### Phase 1 (높은 임팩트, 중간 노력)
- Auto-approval 시스템 (read 자동, write 수동, 패턴 기반)
- 컨텍스트 윈도우 자동 압축 (80% 도달 시 요약)
- 터미널 결과 → AI 피드백 루프

### Phase 2 (높은 임팩트, 높은 노력)
- Tree-sitter AST 통합 (코드 구조 파악)
- Mention 시스템 (@file, @folder)
- 진단 기반 자동 수정 강화

### Phase 3 (확장성)
- MCP 클라이언트 구현
- Rule 시스템 (.tokamak/rules/)
- Hooks (pre/post tool execution)

### Phase 4 (차별화)
- 스트리밍 diff 표시
- 프로젝트 지식 자동 수집
- 브라우저 자동화
