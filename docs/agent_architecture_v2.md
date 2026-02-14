# Tokamak Agent - Architecture Overview (v2)

이 문서는 `tokamak-agent`의 핵심 모듈 간 상호작용 방식을 설명합니다.  
에이전트는 상태 기반 자율 루프를 통해 사용자의 자연어 요청을 코드로 변환하고, 실행, 검증, 수정까지 자동으로 수행합니다.

---

## 🧩 핵심 모듈

| 모듈 | 역할 |
|------|------|
| AgentEngine | 상태 기반 루프 제어, 전반적 흐름 관리 |
| Planner | LLM 응답을 PlanStep[]으로 파싱 |
| Executor | create, edit, read 등 파일 작업 실행 |
| Observer | 진단 API로 오류/경고 감지 |
| Searcher | RAG 기반 관련 파일 검색 |
| ContextManager | 검색된 파일들을 프롬프트용 컨텍스트로 조합 |
| Summarizer | 긴 실행 이력이나 파일 내용을 요약하여 토큰 절약 |
| ApiClient | 다양한 LLM Provider(OpenAI, Anthropic 등)와의 통신 추상화 |

---

## 📊 상태 머신 다이어그램 (State Machine)

