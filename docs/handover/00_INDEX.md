# Tokamak AI Agent - 인수인계 문서

> 마지막 업데이트: 2026-03-02 | v0.1.2

## 문서 목록

| # | 문서 | 내용 |
|---|------|------|
| 01 | [프로젝트 개요](./01_PROJECT_OVERVIEW.md) | 이 프로젝트가 뭔지, 왜 만들었는지, 현재 상태 |
| 02 | [아키텍처](./02_ARCHITECTURE.md) | 코드 구조, 모듈 관계, 핵심 설계 패턴 |
| 03 | [기능 목록](./03_FEATURES.md) | 12개 기능 상세 설명 (Phase 1~4) |
| 04 | [개발 환경 & 빌드](./04_DEV_GUIDE.md) | 로컬 세팅, 빌드, 테스트, 디버깅, 배포 |
| 05 | [알려진 이슈 & 향후 과제](./05_KNOWN_ISSUES.md) | 남은 작업, 기술 부채, UI 개선, **게이미피케이션 비전** |

## 빠른 시작

```bash
# 1. 의존성 설치
npm install

# 2. 테스트 확인 (297 tests)
npm test

# 3. 빌드
npm run bundle

# 4. VS Code에서 디버그 실행
# F5 키
```

## 핵심 파일 5개 (이것만 먼저 읽으세요)

1. **`src/extension.ts`** — 익스텐션 진입점, 커맨드 등록
2. **`src/chat/chatPanel.ts`** — 채팅 UI 허브 (모든 서브시스템 통합, ~2,300줄)
3. **`src/agent/engine.ts`** — 자율 에이전트 상태 머신 (~1,400줄)
4. **`src/agent/executor.ts`** — 파일/터미널 실행기 (~780줄)
5. **`src/api/providers/BaseProvider.ts`** — AI 모델 통신 기반 클래스
