# Tokamak AI Agent

회사 자체 AI 모델(LiteLLM 기반 OpenAI 호환 API)을 VS Code에서 사용할 수 있는 Extension입니다.

---

## 빠른 시작 (설치 방법)

### 1. VSIX 파일을 통한 설치
소스 코드를 직접 빌드하지 않고, 빌드된 파일을 사용하여 간편하게 설치할 수 있습니다.

1. [GitHub Releases](https://github.com/tokamak-network/tokamak-ai-agent/releases) 페이지에서 최신 버전의 `.vsix` 파일을 다운로드합니다.
2. VS Code에서 **확장 프로그램** 보기(`Cmd+Shift+X`)를 엽니다.
3. 확장 프로그램 탭 상단 우측의 **기타 작업...** (점 세 개 모 모양) 메뉴를 클릭합니다.
4. **VSIX에서 설치...(Install from VSIX...)**를 선택합니다.
5. 다운로드한 `.vsix` 파일을 선택하여 설치를 완료합니다.

---

## API 설정

`Cmd+,` (Mac) / `Ctrl+,` (Windows)로 설정을 열고 `tokamak`을 검색합니다.

| 설정 | 설명 | 필수 |
|------|------|:----:|
| `tokamak.apiKey` | AI 서비스 API Key | ✅ |
| `tokamak.models` | 사용 가능한 모델 목록 | - |
| `tokamak.selectedModel` | 현재 선택된 모델 | - |
| `tokamak.enableInlineCompletion` | Ghost Text 자동완성 활성화 | - |
| `tokamak.completionDebounceMs` | 자동완성 딜레이 (기본 300ms) | - |

**settings.json 예시:**
```json
{
  "tokamak.apiKey": "your-api-key",
  "tokamak.models": [
    "qwen3-235b",
    "qwen3-80b-next",
    "qwen3-coder-flash",
    "minimax-m2.5",
    "glm-4.7"
  ],
  "tokamak.selectedModel": "qwen3-235b"
}
```

---

## 소스 코드 빌드 (개발자용)

### 1. Extension 빌드

```bash
# 의존성 설치
npm install

# 컴파일
npm run compile
```

### 2. 테스트 실행

VS Code에서 프로젝트 폴더를 열고 `F5`를 눌러 Extension Development Host를 실행합니다.


---

## 기능 사용법

### 1. AI 채팅

**채팅 열기:**
- 단축키: `Cmd+Shift+I` (Mac) / `Ctrl+Shift+I` (Windows)
- 또는: `Cmd+Shift+P` → "Tokamak: Open Chat"

채팅창이 에디터 옆에 열려서 코드와 폴더 구조를 함께 볼 수 있습니다.

```
┌──────────┬─────────────────┬─────────────────┐
│  📁      │                 │                 │
│  Explorer│   Code Editor   │  Tokamak AI     │
│  (폴더)  │                 │  Chat           │
└──────────┴─────────────────┴─────────────────┘
```

#### 파일 첨부 (@멘션)

채팅에서 프로젝트 파일을 AI에게 전달할 수 있습니다.

1. 입력창에 `@` 입력
2. 파일명을 타이핑하면 자동완성 목록 표시
3. `↑` `↓` 키로 선택
4. `Enter` 또는 `Tab`으로 첨부

여러 파일을 첨부할 수 있습니다.

```
┌─────────────────────────────────────┐
│  📄 extension.ts        src/        │  ← 자동완성
│  📄 chatPanel.ts        src/chat/   │
│  📄 client.ts           src/api/    │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ 📄 extension.ts ×  📄 client.ts ×   │  ← 첨부된 파일
├─────────────────────────────────────┤
│ 이 두 파일 비교해줘                   │  ← 메시지 입력
└─────────────────────────────────────┘
```

- **파일 태그 클릭**: 해당 파일을 에디터에서 열기
- **× 클릭**: 첨부 해제

#### 자동 컨텍스트

파일을 첨부하지 않으면 **현재 열린 파일**과 **선택한 코드**가 자동으로 AI에게 전달됩니다.

#### 모델 선택

채팅창 상단의 드롭다운에서 모델을 변경할 수 있습니다.

#### 코드 삽입

AI 응답의 코드 블록에서 `Insert` 버튼을 클릭하면 현재 커서 위치에 코드가 삽입됩니다.

#### 터미널 명령 실행

AI 응답의 bash/shell 코드 블록에서 `▶ Run` 버튼을 클릭하면 통합 터미널에서 명령이 실행됩니다.

#### 선택 코드 → 채팅 전송

코드를 선택한 후 우클릭 → **Tokamak: Send to Chat**을 선택하면 선택한 코드가 채팅창에 전송됩니다.

#### 채팅 히스토리

채팅 내용은 자동으로 저장되어 VS Code를 재시작해도 유지됩니다. (프로젝트별 저장)

---

### 2. 슬래시 명령어 (Skills)

입력창에서 `/`를 입력하면 사용 가능한 명령어 목록이 표시됩니다.

```
┌─────────────────────────────────────┐
│ ⚡ /explain    코드 설명            │
│ ⚡ /refactor   리팩토링 제안         │
│ ⚡ /fix        버그 찾기 및 수정     │
│ ⚡ /test       유닛 테스트 생성      │
│ ⚡ /docs       문서화               │
│ ⚡ /optimize   성능 최적화          │
│ ⚡ /security   보안 감사            │
└─────────────────────────────────────┘
```

**사용 예시:**
- `/explain` - 현재 선택된 코드 또는 열린 파일 설명
- `/fix 이 함수가 null을 반환해` - 추가 컨텍스트와 함께 버그 수정 요청
- `/test` - 테스트 코드 자동 생성

#### 커스텀 스킬 만들기

프로젝트에 맞는 커스텀 스킬을 만들 수 있습니다.

**1. 스킬 폴더 초기화:**
```
Cmd+Shift+P → "Tokamak: Initialize Skills Folder"
```

이 명령은 `.tokamak/skills/` 폴더와 기본 스킬 파일들을 생성합니다.

**2. 스킬 파일 구조:**
```
프로젝트/
├── .tokamak/
│   └── skills/
│       ├── explain.md      → /explain
│       ├── refactor.md     → /refactor
│       ├── my-custom.md    → /my-custom (직접 추가)
│       └── ...
```

**3. 스킬 파일 형식:**
```markdown
---
description: 스킬 설명 (자동완성에 표시됨)
---

여기에 AI에게 보낼 프롬프트를 작성합니다.
마크다운 형식을 사용할 수 있습니다.

예시:
1. 첫 번째 지시사항
2. 두 번째 지시사항
```

**4. 예시 - 코드 리뷰 스킬 (`review.md`):**
```markdown
---
description: 시니어 개발자 관점 코드 리뷰
---

이 코드를 시니어 개발자 관점에서 리뷰해주세요:

1. 코드 품질 및 베스트 프랙티스
2. 잠재적 버그나 엣지 케이스
3. 보안 이슈
4. 성능 문제
5. 개선 제안

구체적이고 건설적인 피드백을 제공해주세요.
```

**장점:**
- 팀원들과 스킬 공유 (Git으로 관리)
- 프로젝트별 맞춤 스킬
- 코드 수정 없이 스킬 추가/수정

---

### 3. 채팅 모드

채팅창 상단의 탭에서 3가지 모드를 선택할 수 있습니다.

```
┌─────────────────────────────────────┐
│ [💬 Ask] [📋 Plan] [🤖 Agent]       │
└─────────────────────────────────────┘
```

#### 💬 Ask 모드 (기본)

코드에 대해 질문하고 답변을 받는 모드입니다.

**사용 예시:**
- "이 함수가 뭘 하는 거야?"
- "이 에러 어떻게 해결해?"
- "React에서 상태 관리 어떻게 해?"

**특징:**
- 단순 질문/답변
- 코드 수정 없음
- 가장 빠른 응답

---

#### 📋 Plan 모드

구현 전에 작업 계획을 세우는 모드입니다.

**사용 예시:**
- "사용자 인증 기능을 추가하려고 해. 어떻게 구현할까?"
- "이 코드를 마이크로서비스로 분리하고 싶어"
- "테스트 코드를 작성하려면 뭘 해야 해?"

**특징:**
- 구조화된 계획 제공
- 단계별 구현 순서
- 수정할 파일 목록
- 잠재적 문제점 분석
- **코드를 직접 작성하지 않음**

**응답 형식:**
```
1. Overview (개요)
2. Steps (구현 단계)
3. Files to modify/create (파일 목록)
4. Potential challenges (잠재적 문제)
5. Testing considerations (테스트 고려사항)
```

---

#### 🤖 Agent 모드

AI가 직접 파일을 생성, 수정, 삭제하는 모드입니다.

**사용 예시:**
- "로그인 페이지 만들어줘"
- "이 함수에 에러 핸들링 추가해줘"
- "테스트 파일 생성해줘"

**특징:**
- 실제 파일 생성/수정/삭제
- 변경 사항 미리보기
- 승인 후 적용

**사용 흐름:**

1. Agent 모드 선택
2. 요청 입력 (예: "유틸리티 함수 만들어줘")
3. AI가 파일 변경 제안
4. **Pending File Operations** 패널에서 변경 목록 확인

```
┌─────────────────────────────────────┐
│ ⚡ Pending File Operations          │
├─────────────────────────────────────┤
│ [CREATE] src/utils/helper.ts [Preview]│
│ [EDIT]   src/index.ts        [Preview]│
│ [DELETE] src/old-file.ts     [Preview]│
├─────────────────────────────────────┤
│ [✓ Apply Changes]  [✗ Reject]       │
└─────────────────────────────────────┘
```

5. **Preview** 클릭 → Diff 뷰어에서 변경 내용 확인
6. **Apply Changes** 클릭 → 파일에 실제 적용
7. **Reject** 클릭 → 취소

**주의사항:**
- 중요한 파일 수정 시 Git 커밋 후 사용 권장
- 변경 내용을 꼭 확인 후 적용

---

### 3. 코드 자동완성 (Ghost Text)

Copilot처럼 코드 작성 중 회색 미리보기로 자동완성을 제안합니다.

- 자동으로 활성화됨
- `Tab`을 눌러 제안 수락
- `Esc`로 제안 무시

설정에서 비활성화:
```json
{
  "tokamak.enableInlineCompletion": false
}
```

---

### 3. 코드 설명 / 리팩토링

코드를 선택한 후 우클릭 메뉴에서 사용할 수 있습니다.

#### Explain Code (코드 설명)

1. 코드 선택
2. 우클릭 → **Tokamak: Explain Code**
3. Output 패널에 설명 표시

#### Refactor Code (코드 리팩토링)

1. 코드 선택
2. 우클릭 → **Tokamak: Refactor Code**
3. 리팩토링 유형 선택:
   - Improve Readability (가독성 개선)
   - Optimize Performance (성능 최적화)
   - Add Error Handling (에러 처리 추가)
   - Extract Function (함수 추출)
   - Add Types (타입 추가)
   - Custom (직접 입력)
4. 결과 확인 후 Apply Changes 클릭

---

## 명령어 목록

| 명령어 | 단축키 | 설명 |
|--------|--------|------|
| Tokamak: Open Chat | `Cmd+Shift+I` | AI 채팅 열기 |
| Tokamak: Send to Chat | - | 선택한 코드를 채팅으로 전송 |
| Tokamak: Explain Code | - | 선택한 코드 설명 |
| Tokamak: Refactor Code | - | 선택한 코드 리팩토링 |
| Tokamak: Clear Chat History | - | 채팅 기록 삭제 |
| Tokamak: Initialize Skills Folder | - | 커스텀 스킬 폴더 생성 |

---

## 문제 해결

### API 연결 오류

```
Error: 500 litellm.InternalServerError: Connection error
```

- LiteLLM 서버 상태 확인
- 모델명이 올바른지 확인
- 네트워크 연결 확인

### 채팅이 열리지 않음

- `Cmd+Shift+P` → "Tokamak: Open Chat" 실행
- Extension이 활성화되었는지 확인

### 자동완성이 작동하지 않음

- 설정에서 `tokamak.enableInlineCompletion`이 `true`인지 확인
- API Key가 설정되었는지 확인

---

## 개발

```bash
# 컴파일 (한 번)
npm run compile

# 감시 모드 (파일 변경 시 자동 컴파일)
npm run watch

# VSIX 패키징
npm run package
```

---

## 기술 스택

- **언어**: TypeScript
- **빌드**: tsc
- **API**: OpenAI Node.js SDK
- **패키징**: vsce
