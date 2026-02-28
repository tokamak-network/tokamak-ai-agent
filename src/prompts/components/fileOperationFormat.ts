import type { PromptVariant, PromptHints } from '../types.js';
import { normalizeHints } from './_helpers.js';

/**
 * ask/plan 모드용 — read 전용 FILE_OPERATION 포맷.
 */
export function getFileOpReadFormat(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);

    if (hints.variant === 'compact' || hints.contextTier === 'small') {
        return `- To see a file's content, use:
<<<FILE_OPERATION>>>
TYPE: read
PATH: relative/path/to/file
DESCRIPTION: reason
<<<END_OPERATION>>>`;
    }

    return `- If you need to see a file's content that is not provided, DO NOT ask the user. Use <<<FILE_OPERATION>>> with TYPE: read.
- Format for reading:
<<<FILE_OPERATION>>>
TYPE: read
PATH: relative/path/to/file
DESCRIPTION: reason
<<<END_OPERATION>>>
- I will automatically provide the content in the next turn.`;
}

/**
 * agent 모드용 — 전체 FILE_OPERATION 포맷 (create/edit/replace/delete/read/write_full/prepend/append).
 */
export function getFileOpFullFormat(input: PromptHints | PromptVariant): string {
    const hints = normalizeHints(input);

    if (hints.variant === 'compact' || hints.contextTier === 'small') {
        return `You can perform file operations:

<<<FILE_OPERATION>>>
TYPE: create|write_full|replace|prepend|append|delete|read
PATH: relative/path/to/file
DESCRIPTION: Brief description
CONTENT:
\`\`\`
content or diff
\`\`\`
<<<END_OPERATION>>>

- **prepend/append**: Add CONTENT at start/end of file.
- **write_full**: Replace entire file. Only for full rewrites.
- **edit/replace**: Partial change. Use SEARCH: and REPLACE: blocks.
- **create**: New file. CONTENT = complete file.
- **read**: PATH only.

Rules for edit/replace:
- Use SEARCH: for exact existing code and REPLACE: for new code.
- Provide enough context to make SEARCH unique.
- For text replacement ("change A to B"), MUST use SEARCH/REPLACE, not CONTENT.
Respond with ONLY the requested output format, no additional text.

- **ONE block per file**: Combine multiple changes into one block.
- Explain what you're doing before operations.`;
    }

    return `You can perform file operations (Cline-style: two clear options for edits).

<<<FILE_OPERATION>>>
TYPE: create|write_full|replace|prepend|append|delete|read
PATH: relative/path/to/file
DESCRIPTION: Brief description of the change
CONTENT:
\`\`\`
content or diff (see rules below)
\`\`\`
<<<END_OPERATION>>>

**Add only at start or end (nothing else is modified):**
- **prepend**: Add CONTENT at the very beginning of the file. CONTENT = only the text to add (e.g. "안녕하세요"). Use for: "처음에 X 넣어줘", "맨 앞에 추가", "add X at the beginning".
- **append**: Add CONTENT at the very end of the file. CONTENT = only the text to add. Use for: "끝에 X 넣어줘", "맨 뒤에 추가", "add X at the end".

**Other edits:**
- **write_full**: Replace the ENTIRE file. CONTENT = complete new file. Only when user asks to replace/rewrite the whole file. (Do not use this just to edit a small part!)
- **edit** or **replace**: Change part of the file. You MUST provide exactly the code to find and the code to replace it with.

Rules for 'edit' or 'replace':
- Do NOT use the old \`<<<<<<< SEARCH\` format. Instead, you MUST use two separate parameters: \`SEARCH:\` (or \`<parameter name="search">\`) for the exact existing code, and \`REPLACE:\` (or \`<parameter name="replace">\`) for the new code.
- Provide enough context lines in the SEARCH block to make it uniquely identifiable.
- The SEARCH string must exactly match the file content, including all whitespace and indentation.
- If you use \`CONTENT:\` for an edit, we will try to fuzzy-match it explicitly to surrounding lines.
- 🔴 IMPORTANT FOR TEXT REPLACEMENT 🔴: If the user asks you to "change word A to B" or "rename X to Y" in the middle of a file, you CANNOT just send \`CONTENT: Y\`. You MUST use explicit \`SEARCH: A\` and \`REPLACE: B\` so the system knows what to overwrite. Do NOT use \`CONTENT\` for text replacements!

Rules:
- **"처음에/맨 앞에 X 넣어줘"** → TYPE: prepend, CONTENT: X only.
- **"끝에/맨 뒤에 X 넣어줘"** → TYPE: append, CONTENT: X only.
- For 'create', CONTENT = complete file. For 'write_full', CONTENT = complete file. For 'read', PATH only.

Example Edit Format:
<<<FILE_OPERATION>>>
TYPE: edit
PATH: src/utils/helper.ts
DESCRIPTION: Update return value
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
