# 05. 알려진 이슈 & 향후 과제

## 알려진 제한사항

### 1. chatPanel.ts 비대화

- **현재 상태**: ~2,300줄. 모든 서브시스템이 여기로 합류
- **영향**: 새 기능 추가 시 이 파일을 계속 수정해야 함
- **개선 방향**: 메시지 핸들링, 스트리밍, 파일 오퍼레이션 적용 등을 별도 클래스로 분리

### 2. Tree-sitter WASM 파일 배포

- **현재 상태**: `web-tree-sitter` 패키지는 설치되어 있지만, 언어별 WASM 파일(`tree-sitter-typescript.wasm` 등)이 번들에 포함되어 있지 않을 수 있음
- **영향**: tree-sitter 초기화 실패 시 regex fallback으로 동작 (기능 저하)
- **개선 방향**: esbuild 설정에서 WASM 에셋 복사를 자동화하거나, `parsers/` 폴더에 수동 배치

### 3. MCP SDK 미포함

- **현재 상태**: `@modelcontextprotocol/sdk`가 package.json dependencies에 없음
- **영향**: MCP 클라이언트가 dynamic import 시 실패 → MCP 기능 비활성
- **해결**: 필요 시 `npm install @modelcontextprotocol/sdk` 실행

### 4. puppeteer-core 미포함

- **현재 상태**: package.json에는 있지만 optional 성격
- **영향**: 시스템에 Chrome/Chromium이 없으면 브라우저 자동화 실패
- **해결**: `executablePath` 설정으로 브라우저 경로 지정 가능

### 5. 테스트 커버리지 한계

- **현재 상태**: vscode 의존 모듈은 단위 테스트 불가
- **영향**: chatPanel, engine, executor 등 핵심 파일의 자동 테스트 부재
- **개선 방향**: vscode API mock 라이브러리 도입 또는 E2E 테스트 프레임워크(`@vscode/test-electron`) 추가

### 6. 에러 핸들링

- **현재 상태**: 대부분의 에러가 `catch {}` (무시) 또는 `catch { /* fallback */ }` 패턴
- **영향**: 디버깅 시 원인 파악 어려움
- **개선 방향**: 최소한 logger.warn()으로 에러 기록

---

## 기술 부채

### 타입 안전성

- `executor.ts`의 `action.payload`가 `any` 타입
- `browserService.ts`의 puppeteer 인스턴스가 `any` 타입
- `treeSitterService.ts` 전체가 `any` (web-tree-sitter 타입 호환 문제)

### webviewContent.ts

- ~2,500줄의 인라인 HTML/CSS/JS
- 프론트엔드 프레임워크 없이 순수 DOM 조작
- CSS/JS 분리 또는 React/Svelte 도입을 고려할 수 있음

### engine.ts 복잡도

- ~1,400줄에 13개 상태, 10+ 핸들러 메서드
- 멀티 모델 리뷰/토론 로직이 한 파일에 집중
- 리뷰/토론을 별도 클래스로 분리하면 가독성 개선

---

## 향후 개선 아이디어

### UI/UX 개선 (최우선)

현재 UI가 사용하기 불편하다는 피드백이 있다. `webviewContent.ts`가 2,250줄짜리 인라인 HTML/CSS/JS로 되어 있어 유지보수도 어렵다.

#### 1. 채팅 입력 UX

| 문제 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| 입력창이 작음 | `min-height: 40px`, `max-height: 150px` 고정 | 자동 높이 조절 + 전체화면 입력 모드 (Cursor처럼 Shift+Enter로 확장) |
| 긴 코드 붙여넣기 어려움 | textarea가 작아서 긴 코드 미리보기 불가 | 코드 붙여넣기 시 접기(collapsible) 프리뷰 |
| 멘션 자동완성이 단순함 | `@`만 감지, 카테고리 구분 없음 | `@file:`, `@folder:`, `@symbol:` 카테고리 탭 + fuzzy search |
| 이미지 첨부 작음 | 80x80px 썸네일 | 클릭하면 확대 미리보기 |

#### 2. 응답 표시

| 문제 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| 스트리밍 중 피드백 부족 | "AI is thinking..." 텍스트 + 점 애니메이션뿐 | 타이핑 커서 효과 + 경과 시간 + 토큰 카운트 실시간 표시 |
| 코드 블록 구문 강조 없음 | `<pre><code>` 태그만 사용 | highlight.js 또는 Shiki 적용 (VS Code 테마 매칭) |
| 긴 응답 스크롤 불편 | 자동 스크롤만 있음, 중간으로 못 돌아감 | "맨 아래로" 플로팅 버튼 + 스크롤 위치 기억 + 목차 네비게이션 |
| 마크다운 렌더링 미흡 | 기본적인 파싱만 됨 | 테이블, 체크리스트, mermaid 다이어그램 지원 |

#### 3. Pending File Operations 패널

| 문제 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| diff 미리보기 없음 | "Preview" 버튼 → VS Code diff 에디터로 이동 | 인라인 diff 뷰 (추가=초록, 삭제=빨강) — webview 안에서 바로 표시 |
| 전체 승인/거부만 가능 | Apply All / Reject All 버튼 2개 | 파일별 개별 체크박스 + 선택 적용 |
| 변경 내용 파악 어려움 | 파일 경로 + 타입(CREATE/EDIT/DELETE)만 표시 | 변경 줄 수 (`+15 -3`), 파일 크기, 영향받는 테스트 표시 |
| 패널 위치가 채팅 하단 고정 | 채팅 스크롤과 겹침 | 사이드 패널 또는 탭 분리 + 드래그 리사이즈 |

#### 4. 모드/설정 영역

| 문제 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| 헤더가 복잡함 | 모델 선택 + 모드 탭 + 리뷰 전략 + 체크박스가 한 곳에 몰림 | 기본: 모델+모드만 표시, 고급 설정은 기어 아이콘 → 드롭다운 패널 |
| 모드 전환 시 피드백 없음 | 탭 색만 바뀜 | 모드별 설명 툴팁 + 첫 사용 시 가이드 오버레이 |
| Agent 상태가 안 보임 | `agent-status-badge`가 Plan 패널 안에 숨어 있음 | 헤더에 상태 뱃지 항상 표시 (Planning → Executing → Observing...) |

#### 5. 세션 히스토리

| 문제 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| 사이드 패널이 밀어냄 | `position: fixed; left: -300px` 슬라이드 인 | VS Code Activity Bar처럼 아이콘 클릭 → 독립 패널 |
| 검색 기능 약함 | 세션 제목만 검색 | 대화 내용 전문 검색 + 날짜 필터 |
| 세션 관리 없음 | 삭제만 가능 | 이름 변경, 즐겨찾기, 내보내기(마크다운) |

#### 6. 전반적인 디자인

| 문제 | 현재 상태 | 개선 방향 |
|------|----------|----------|
| 프론트엔드 프레임워크 없음 | 2,250줄 인라인 HTML/CSS/JS, DOM 직접 조작 | React/Svelte/Lit 도입 → 컴포넌트 분리, 상태 관리 |
| CSS가 인라인 | `<style>` 태그 안에 전부 | CSS 파일 분리 또는 CSS-in-JS |
| 반응형 미지원 | 고정 폭, 좁은 사이드바에서 깨짐 | 패널 너비에 따른 레이아웃 조정 |
| 접근성 부족 | aria 속성 없음, 키보드 네비게이션 미지원 | aria-label, role, tabindex, 키보드 단축키 |
| 다크/라이트 테마 일부 깨짐 | VS Code CSS 변수 사용하지만 일부 하드코딩 색상 존재 (`color: white`, `color: black`) | 모든 색상을 CSS 변수로 교체 |

#### UI 개선 로드맵 (권장 순서)

```
1단계: 코드 블록 구문 강조 (highlight.js 추가, 가장 체감 큼)
   ↓
2단계: 인라인 diff 뷰 (파일 변경사항을 바로 확인)
   ↓
3단계: 입력창 UX 개선 (자동 높이, 전체화면 모드)
   ↓
4단계: 헤더 정리 (고급 설정 분리, Agent 상태 뱃지)
   ↓
5단계: 프론트엔드 프레임워크 도입 (전체 리빌드)
```

> **참고**: Cline, Continue, Cursor 등 경쟁 제품의 UI를 벤치마크로 삼을 것. 특히 Cline의 diff 뷰와 Cursor의 입력 UX가 좋은 참고 자료.

---

### 단기 (1~2주)

| 항목 | 설명 | 관련 파일 |
|------|------|----------|
| 코드 블록 구문 강조 | highlight.js 또는 Shiki 라이브러리 추가 | `webviewContent.ts` |
| 스트리밍 피드백 개선 | 경과 시간 + 토큰 카운트 실시간 표시 | `webviewContent.ts` |
| E2E 테스트 추가 | @vscode/test-electron으로 통합 테스트 | 새 파일 |
| WASM 번들링 자동화 | esbuild 플러그인으로 tree-sitter WASM 복사 | package.json scripts |
| MCP SDK 설치 | MCP 기능 완전 활성화 | package.json |
| 에러 로깅 강화 | 빈 catch 블록에 logger 추가 | 전체 |

### 중기 (1~2개월)

| 항목 | 설명 |
|------|------|
| 인라인 diff 뷰 | Pending Operations에서 변경사항을 webview 안에서 바로 표시 |
| 입력창 UX 전면 개선 | 자동 높이, 전체화면 입력, 코드 붙여넣기 프리뷰 |
| 헤더/설정 영역 정리 | 고급 설정 분리, Agent 상태 뱃지 상시 표시 |
| chatPanel 리팩토링 | 메시지 핸들링, 스트리밍, 파일 오퍼레이션을 별도 클래스로 분리 |
| 멀티 워크스페이스 지원 | 현재 workspaceFolders[0]만 사용 |
| 다국어 UI | 현재 한국어/영어 혼재 → i18n 적용 |

### 장기

| 항목 | 설명 |
|------|------|
| Webview 프론트엔드 프레임워크 도입 | React/Svelte/Lit으로 전면 리빌드 → 컴포넌트 분리, 상태 관리, 테스트 가능 |
| 접근성(A11Y) 대응 | aria 속성, 키보드 네비게이션, 스크린 리더 지원 |
| VS Code Marketplace 출시 | 공개 배포 |
| Remote SSH 지원 | 원격 개발 환경에서 동작 확인 |
| 에이전트 메모리 | 세션 간 학습 내용 유지 |
| 멀티 에이전트 | 여러 AI가 역할 분담 (코더, 리뷰어, 테스터) |
| 게이미피케이션 시스템 | 아래 "미래 비전" 섹션 참고 |

---

## 미래 비전: 게이미피케이션 + 토큰 경제 시스템

원래 기획자가 구상했지만 미처 구현하지 못한 핵심 방향성이다.
다음 인계자가 이 프로젝트의 장기 목표를 이해하는 데 중요하므로 상세히 기록한다.

### 핵심 아이디어

**ChatDev 스타일의 가상 개발 사무실** + **토큰 경제 시스템**을 합쳐서,
AI 코딩을 게임처럼 만드는 것이 최종 목표였다.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   🏢 가상 개발 사무실 (픽셀 아트 / 2D 탑뷰)              │
│                                                          │
│   ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│   │Designing│  │  Coding  │  │ Testing  │  │Documenting│ │
│   │  💡     │  │  ⌨️     │  │  🧪     │  │  📝     │  │
│   │ (Qwen)  │  │(Minimax) │  │  (GLM)   │  │(Gemini)  │  │
│   └─────────┘  └──────────┘  └──────────┘  └─────────┘  │
│                                                          │
│   각 자리 = AI 에이전트 (모델) = 역할                      │
│   캐릭터들이 걸어다니며 협업하는 애니메이션                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

> 참고 이미지: ChatDev (https://github.com/OpenBMB/ChatDev) 의 가상 사무실 시각화

### 1. 토큰 경제 시스템

AI 사용량(토큰)을 화폐처럼 관리하고, 팀/개인 예산 개념을 도입.

```
┌─────────────────────────────────────────┐
│  💰 Token Economy                        │
│                                         │
│  팀 예산: 1,000,000 tokens / month      │
│  ├── Design팀: 200,000 (사용: 45,320)   │
│  ├── Dev팀:    500,000 (사용: 312,100)   │
│  ├── QA팀:     200,000 (사용: 88,750)    │
│  └── Docs팀:   100,000 (사용: 12,400)    │
│                                         │
│  모델별 단가:                             │
│  ├── qwen3-235b:  1x (기본)             │
│  ├── gpt-4o:      5x (비쌈)             │
│  └── qwen3-flash: 0.3x (저렴)           │
└─────────────────────────────────────────┘
```

**구현에 필요한 것:**

| 컴포넌트 | 설명 | 비고 |
|---------|------|------|
| `src/token/tokenTracker.ts` | 세션별/사용자별 토큰 사용량 기록 | 현재 `token-usage-bar`에 일부 구현 |
| `src/token/tokenBudget.ts` | 팀/개인 예산 설정, 잔액 체크 | 예산 초과 시 경고/차단 |
| `src/token/tokenStorage.ts` | 사용량 영구 저장 (SQLite 또는 JSON) | VS Code globalState 활용 가능 |
| API 서버 | 팀 단위 토큰 집계, 대시보드 | LiteLLM 서버와 연동 |

### 2. 게이미피케이션 UI (ChatDev 스타일)

현재의 채팅 UI를 **가상 개발 사무실**로 전환하는 비전.

**핵심 요소:**

| 요소 | 설명 |
|------|------|
| **가상 사무실 맵** | 픽셀 아트 스타일의 2D 탑뷰 사무실. 각 구역(Designing, Coding, Testing, Documenting)에 AI 캐릭터 배치 |
| **AI 캐릭터** | 각 모델을 캐릭터로 시각화. 예: Qwen = 파란머리 개발자, GLM = 녹색 테스터 |
| **역할 배정** | 팀장(사용자)이 각 AI에게 역할 지정: Designer, Coder, Tester, Documenter, Reviewer |
| **작업 흐름 시각화** | 캐릭터가 자기 자리에서 일하다가, 다른 구역으로 걸어가서 전달하는 애니메이션 |
| **말풍선** | AI가 응답할 때 해당 캐릭터 위에 말풍선으로 표시 |
| **진행 바** | 각 캐릭터 위에 작업 진행도 표시 |

**작업 흐름 예시:**

```
1. 사용자: "로그인 페이지 만들어줘"
   → 팀장(사용자) 캐릭터가 화이트보드에 요구사항 적음

2. Designing 구역:
   → Designer(Qwen-235b) 캐릭터가 설계 작업
   → 말풍선: "UI 컴포넌트 구조를 설계합니다..."
   → 완료 후 서류를 들고 Coding 구역으로 이동 애니메이션

3. Coding 구역:
   → Coder(Minimax) 캐릭터가 코드 작성
   → 모니터에 코드 타이핑 애니메이션
   → 완료 후 Testing 구역으로 전달

4. Testing 구역:
   → Tester(GLM) 캐릭터가 테스트 실행
   → ⚠️ 버그 발견 시 경고 아이콘 → Coding 구역으로 되돌아감
   → ✅ 통과 시 Documenting 구역으로 전달

5. Documenting 구역:
   → Documenter(Gemini) 캐릭터가 문서 작성

6. 전체 완료:
   → 모든 캐릭터가 가운데 모여서 축하 애니메이션 🎉
   → 사용 토큰, 소요 시간, 파일 수 등 결과 표시
```

**기술 스택 검토:**

| 선택지 | 장점 | 단점 |
|-------|------|------|
| **Canvas 2D** (직접 구현) | 완전한 제어, 의존성 없음 | 개발 시간 많이 소요 |
| **PixiJS** | 2D 렌더링 최적화, 스프라이트/애니메이션 지원 | 번들 크기 증가 (~300KB) |
| **Phaser** | 게임 프레임워크, 타일맵/캐릭터 시스템 내장 | 과한 기능, 번들 크기 (~1MB) |
| **CSS + HTML** | 단순, VS Code 테마 호환 | 캐릭터 애니메이션 한계 |

> 권장: **PixiJS** — 게임 수준의 애니메이션은 필요 없고, 스프라이트 + 간단한 이동 애니메이션이면 충분

**필요한 에셋:**
- 캐릭터 스프라이트시트 (걷기, 앉기, 타이핑 모션)
- 사무실 타일맵 (책상, 의자, 컴퓨터, 화이트보드)
- UI 아이콘 (말풍선, 진행 바, 토큰 표시)
- 배경음악 / 효과음 (선택)

### 3. 팀 모델 배정 시스템

각 AI 모델에 역할을 부여하고 팀을 구성하는 기능.

```
┌─────────────────────────────────────────┐
│  🏗️ Team Configuration                  │
│                                         │
│  Role          Model        Cost/Token  │
│  ───────────── ──────────── ─────────── │
│  👨‍🎨 Designer    qwen3-235b    1.0x     │
│  👨‍💻 Coder       minimax-m2.5  0.8x     │
│  🧪 Tester      glm-4.7       0.7x     │
│  📝 Documenter  qwen3-flash   0.3x     │
│  🔍 Reviewer    qwen3-80b     0.6x     │
│                                         │
│  Total Budget: 500K tokens              │
│  [Save Team] [Load Preset]             │
└─────────────────────────────────────────┘
```

**현재 코드와의 연결점:**

| 현재 구현 | 확장 방향 |
|----------|----------|
| `ProviderRegistry` (모델 선택) | 역할별 모델 자동 라우팅 |
| `AgentEngine` (단일 모델 실행) | 역할별 다른 모델로 각 단계 실행 |
| 멀티 모델 리뷰 (`reviewerModel`) | Tester/Reviewer 역할로 일반화 |
| `tokenEstimator.ts` | 모델별 단가 적용한 비용 계산 |
| `chatPanel.ts` 웹뷰 | 가상 사무실 UI로 교체 |

### 구현 로드맵 (권장)

```
Phase A: 토큰 추적 기초 (2~3일)
  - tokenTracker.ts 생성 (세션별 사용량 기록)
  - 기존 token-usage-bar에 누적 사용량 표시
  - VS Code globalState에 저장

Phase B: 팀 모델 배정 (1주)
  - 역할(Role) 타입 정의
  - 팀 설정 UI (webview)
  - AgentEngine이 단계별로 다른 모델 사용

Phase C: 토큰 경제 (1~2주)
  - 모델별 단가 설정
  - 팀/개인 예산 시스템
  - 예산 초과 경고 / 저렴한 모델 자동 추천
  - 대시보드 (사용량 차트)

Phase D: 게이미피케이션 UI (2~4주)
  - PixiJS 또는 Canvas 2D 통합
  - 캐릭터 스프라이트 + 사무실 타일맵
  - 역할별 구역 배치
  - 작업 흐름 애니메이션
  - 말풍선으로 AI 응답 표시
```

---

## 자주 발생하는 문제

### "API Key가 설정되지 않았습니다"
→ VS Code Settings에서 `tokamak.apiKey` 확인

### "모델을 찾을 수 없습니다"
→ `tokamak.models` 목록에 해당 모델이 있는지, LiteLLM 서버에서 지원하는지 확인

### "채팅이 안 열립니다"
→ `Cmd+Shift+P` → "Tokamak: Open Chat" 시도. Extension이 활성화되었는지 확인

### "Agent 모드에서 파일이 안 바뀝니다"
→ AI 응답에 `<<<FILE_OPERATION>>>` 마커가 포함되어야 함. 시스템 프롬프트가 올바른지 확인

### "번들 후 에러 발생"
→ `npm run compile`은 정상인데 `npm run bundle`에서만 에러나면 esbuild 외부 모듈 설정 확인

---

## 연락처 & 참고 자료

- **리포지토리**: https://github.com/tokamak-network/tokamak-ai-agent
- **기존 문서**: `docs/` 폴더 (아키텍처, 로드맵, 테스트 가이드 등)
- **VS Code Extension API**: https://code.visualstudio.com/api
- **OpenAI SDK**: https://github.com/openai/openai-node
- **벤치마크 (Cline)**: https://github.com/cline/cline
