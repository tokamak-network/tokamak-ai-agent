# Tokamak Agent - Key Notes

## Build System
- `npm run compile` (tsc) → TypeScript 타입 체크 전용, `out/extension.js` 영향 없음
- `npm run bundle` (esbuild) → `out/extension.js` 생성 ← **실제 VSCode가 실행하는 파일**
- 코드 수정 후 반드시 `npm run bundle` 실행 필요

## Common Pitfalls
- `getHtmlContent()`의 template string 안 JS 코드에 TypeScript 타입 어노테이션(`: string[]` 등) 사용 금지 → webview SyntaxError로 모든 버튼이 동작 안 함
- `npm run compile`만 하면 변경사항이 반영되지 않음 (bundle 필수)
