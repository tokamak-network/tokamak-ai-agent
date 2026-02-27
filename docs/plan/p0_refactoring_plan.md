# P0 적용 계획: 테스트 + chatPanel.ts 분리 + 데드코드 제거

## Context

분석 결과 Tokamak Agent는 세 가지 P0 문제를 가짐:
1. 테스트 인프라 전무 → 회귀 버그 위험
2. `chatPanel.ts` 4,244줄 단일 파일 → 유지보수 불가
3. `chatPanel copy.ts` 데드코드 → 혼란 유발

---

## Task 1: chatPanel copy.ts 삭제

파일: `src/chat/chatPanel copy.ts` (190KB)
- `rm` 명령으로 삭제

---

## Task 2: chatPanel.ts 분리 (4개 모듈 추출)

**추출 원칙**
- VS Code API 의존성 없는 순수 로직을 우선 분리
- `ChatPanel` 클래스 자체는 유지, 내부 메서드를 위임

### 2-A. src/chat/fileOperationParser.ts

`parseFileOperations()` 추출 (~258줄)
- 입력: AI 응답 텍스트 (`string`)
- 출력: `FileOperation[]`
- 3가지 포맷 파싱: `<<<FILE_OPERATION>>>`, `<invoke>` XML, SEARCH/REPLACE 블록
- No VS Code API 필요 → 완전 분리 가능

### 2-B. src/chat/systemPromptBuilder.ts

`getSystemPromptForMode()` 추출 (~120줄)
- 입력: `mode`, `workspaceInfo`, `projectStructure`, `knowledge`
- 출력: 시스템 프롬프트 `string`
- 순수 함수 → 분리 가능

### 2-C. src/chat/skillsManager.ts

4개 메서드 추출 (~100줄):
- `loadSkillsFromFolder(folder)` → `SlashCommand[]`
- `getAllSkills(folder)` → `SlashCommand[]`
- `parseSlashCommand(text)` → `{ command, args } | null`
- `searchSlashCommands(query)` → `SlashCommand[]`
- `fs` API만 사용 → `vscode.workspace`는 폴더 경로만 필요

### 2-D. src/chat/webviewContent.ts

`getHtmlContent()` 추출 (~880줄 HTML+CSS+JS)
- 인자: `extensionUri`
- 출력: HTML `string`
- Pure function → 완전 분리 가능

결과: `chatPanel.ts` ~2,000줄로 감소

---

## Task 3: 테스트 인프라 구축

### 3-A. Vitest 설정

수정: `package.json`에 devDependency 추가:
```json
"vitest": "^2.0.0",
"@vitest/coverage-v8": "^2.0.0"
```
생성: `vitest.config.ts`

### 3-B. 테스트 디렉토리 구조

```
src/__tests__/
  contentUtils.test.ts   (순수 함수 6개)
  planner.test.ts        (parsePlan 다양한 포맷)
  fileOperationParser.test.ts  (Task 2-A 추출 후)
```

### 3-C. contentUtils.test.ts 커버리지

모든 6개 순수 함수 테스트:
- `removeAutoExecutionCode()` - run(), main() 제거 케이스
- `unescapeHtmlEntities()` - `&lt;`, `&gt;`, `&amp;` 변환
- `removeTrailingBackticks()` - 백틱 정리
- `stripThinkingBlocks()` - `<think>` 블록 제거
- `removeControlCharacterArtifacts()` - 제어 문자 제거
- `applySearchReplaceBlocks()` - SEARCH/REPLACE 4-tier 매칭

### 3-D. planner.test.ts 커버리지

`parsePlan()` 함수 - 3가지 포맷:
- 마크다운 체크리스트: `- [ ] description`
- 번호 매기기: `1. description`
- JSON 플랜: `{"type":"plan","payload":[...]}`

---

## 실행 순서

1. `chatPanel copy.ts` 삭제
2. `fileOperationParser.ts` 추출 + `chatPanel.ts`에서 import
3. `systemPromptBuilder.ts` 추출
4. `skillsManager.ts` 추출
5. `webviewContent.ts` 추출
6. `package.json` + `vitest.config.ts` 설정
7. `src/__tests__/contentUtils.test.ts` 작성
8. `src/__tests__/planner.test.ts` 작성
9. `src/__tests__/fileOperationParser.test.ts` 작성
10. `npm test` 실행으로 검증

## 변경 예상 파일

**수정될 파일**
- `src/chat/chatPanel.ts` (4,244 → ~2,000줄)
- `package.json` (vitest 추가)

**생성될 파일**
- `src/chat/fileOperationParser.ts`
- `src/chat/systemPromptBuilder.ts`
- `src/chat/skillsManager.ts`
- `src/chat/webviewContent.ts`
- `vitest.config.ts`
- `src/__tests__/contentUtils.test.ts`
- `src/__tests__/planner.test.ts`
- `src/__tests__/fileOperationParser.test.ts`

**삭제될 파일**
- `src/chat/chatPanel copy.ts`

**검증**
```bash
npm run compile   # TypeScript 에러 없음 확인
npm test          # 모든 테스트 통과 확인
```
