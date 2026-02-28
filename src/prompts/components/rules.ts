import type { PromptVariant, PromptHints } from '../types.js';
import { normalizeHints } from './_helpers.js';

/**
 * 공통 규칙 — ask/plan 모드에서 사용.
 */
export function getGeneralRules(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);

    if (hints.variant === 'compact') {
        return `- Analyze provided context and project structure.
- Be concise and helpful.`;
    }

    return `- Analyze provided context and the project structure.
- Be concise and helpful.`;
}

/**
 * Agent 전용 규칙 — agent 모드에서 FILE_OPERATION 포맷 뒤에 추가.
 */
export function getAgentRules(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);

    const base = hints.variant === 'compact'
        ? `- **ONE block per file**: Combine multiple changes into one block using multiple SEARCH/REPLACE pairs, or use write_full.
- Explain what you're doing before operations.
- Ask for confirmation if ambiguous.`
        : `- **ONE block per file**: Use exactly ONE <<<FILE_OPERATION>>> block per file. If you need multiple changes to the same file, combine them into a single block using multiple SEARCH/REPLACE pairs inside one CONTENT field, or use write_full to rewrite the whole file.
- Always explain what you're doing before the operations.
- Ask for confirmation if the task is ambiguous.`;

    const extras: string[] = [];

    if (hints.thinkingBlocks) {
        extras.push(`- **Structured thinking**: You can use <think>...</think> blocks to reason through complex problems before providing your response.`);
    }

    if (hints.contextTier === 'large') {
        extras.push(`- **Exploration first**: Begin by reading relevant files to understand the codebase before making changes. Use TYPE: read operations.`);
    }

    return extras.length > 0 ? `${base}\n${extras.join('\n')}` : base;
}

/**
 * Agent 예시 블록 — agent 모드에서 규칙 뒤에 추가.
 */
export function getAgentExample(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);

    if (hints.contextTier === 'small') {
        return '';
    }

    const createExample = `
Example:
I'll create a new utility function for you.

<<<FILE_OPERATION>>>
TYPE: create
PATH: src/utils/helper.ts
DESCRIPTION: Create helper utility function
CONTENT:
\`\`\`typescript
export function helper() {
  return 'hello';
}
\`\`\`
<<<END_OPERATION>>>`;

    if (hints.contextTier === 'large') {
        return `${createExample}

Example (edit):
I'll update the return value.

<<<FILE_OPERATION>>>
TYPE: edit
PATH: src/utils/helper.ts
DESCRIPTION: Change return value
SEARCH:
\`\`\`typescript
  return 'hello';
\`\`\`
REPLACE:
\`\`\`typescript
  return 'world';
\`\`\`
<<<END_OPERATION>>>`;
    }

    return createExample;
}

/**
 * Plan 모드 출력 형식.
 */
export function getPlanOutputFormat(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);

    if (hints.variant === 'compact' || hints.contextTier === 'small') {
        return `Format: 1) Overview 2) Steps 3) Files 4) Challenges 5) Testing`;
    }

    return `Format your response as:
1. Overview
2. Steps (numbered)
3. Files to modify/create
4. Potential challenges
5. Testing considerations`;
}
