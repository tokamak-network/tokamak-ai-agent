import { describe, it, expect } from 'vitest';
import { parseFileOperations } from '../chat/fileOperationParser.js';

describe('parseFileOperations', () => {
    describe('<<<FILE_OPERATION>>> format', () => {
        it('parses a create operation', () => {
            const response = `
<<<FILE_OPERATION>>>
TYPE: create
PATH: src/hello.ts
DESCRIPTION: Create hello file
CONTENT:
\`\`\`typescript
export function hello() { return 'hello'; }
\`\`\`
<<<END_OPERATION>>>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].type).toBe('create');
            expect(ops[0].path).toBe('src/hello.ts');
            expect(ops[0].description).toBe('Create hello file');
            expect(ops[0].content).toContain("return 'hello'");
        });

        it('parses an edit operation with SEARCH/REPLACE', () => {
            const response = `
<<<FILE_OPERATION>>>
TYPE: edit
PATH: src/utils.ts
DESCRIPTION: Update return value
SEARCH:
\`\`\`
  return 'hello';
\`\`\`
REPLACE:
\`\`\`
  return 'world';
\`\`\`
<<<END_OPERATION>>>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].type).toBe('edit');
            expect(ops[0].path).toBe('src/utils.ts');
        });

        it('parses a delete operation', () => {
            const response = `
<<<FILE_OPERATION>>>
TYPE: delete
PATH: src/old.ts
DESCRIPTION: Remove old file
<<<END_OPERATION>>>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].type).toBe('delete');
            expect(ops[0].path).toBe('src/old.ts');
        });

        it('parses a read operation', () => {
            const response = `
<<<FILE_OPERATION>>>
TYPE: read
PATH: src/existing.ts
DESCRIPTION: Read file content
<<<END_OPERATION>>>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].type).toBe('read');
        });

        it('parses prepend operation', () => {
            const response = `
<<<FILE_OPERATION>>>
TYPE: prepend
PATH: src/file.ts
DESCRIPTION: Add header
CONTENT:
// License header
<<<END_OPERATION>>>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].type).toBe('prepend');
        });

        it('parses append operation', () => {
            const response = `
<<<FILE_OPERATION>>>
TYPE: append
PATH: src/file.ts
DESCRIPTION: Add footer
CONTENT:
// End of file
<<<END_OPERATION>>>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].type).toBe('append');
        });

        it('parses multiple operations', () => {
            const response = `
<<<FILE_OPERATION>>>
TYPE: create
PATH: src/a.ts
DESCRIPTION: Create A
CONTENT:
const a = 1;
<<<END_OPERATION>>>

<<<FILE_OPERATION>>>
TYPE: create
PATH: src/b.ts
DESCRIPTION: Create B
CONTENT:
const b = 2;
<<<END_OPERATION>>>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(2);
            expect(ops[0].path).toBe('src/a.ts');
            expect(ops[1].path).toBe('src/b.ts');
        });

        it('deduplicates identical operations', () => {
            const block = `
<<<FILE_OPERATION>>>
TYPE: create
PATH: src/dup.ts
DESCRIPTION: Duplicate
CONTENT:
const x = 1;
<<<END_OPERATION>>>
`;
            const response = block + '\n' + block;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
        });

        it('handles HTML-escaped < and > in response', () => {
            const response = `
&lt;&lt;&lt;FILE_OPERATION&gt;&gt;&gt;
TYPE: read
PATH: src/file.ts
DESCRIPTION: Read
&lt;&lt;&lt;END_OPERATION&gt;&gt;&gt;
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].type).toBe('read');
        });
    });

    describe('<invoke> XML format', () => {
        it('parses write_to_file invoke', () => {
            const response = `
<invoke name="write_to_file">
<parameter name="path">src/test.ts</parameter>
<parameter name="description">Write test file</parameter>
<parameter name="content">const x = 1;</parameter>
</invoke>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].type).toBe('write_full');
            expect(ops[0].path).toBe('src/test.ts');
        });

        it('parses replace_in_file invoke with search/replace', () => {
            const response = `
<invoke name="replace_in_file">
<parameter name="path">src/utils.ts</parameter>
<parameter name="search">old code</parameter>
<parameter name="replace">new code</parameter>
</invoke>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].type).toBe('replace');
            expect(ops[0].search).toBe('old code');
            expect(ops[0].replace).toBe('new code');
        });

        it('does not double-parse FILE_OPERATION blocks as invoke', () => {
            const response = `
<<<FILE_OPERATION>>>
TYPE: create
PATH: src/file.ts
DESCRIPTION: Test
CONTENT:
<invoke name="edit">not a real invoke</invoke>
<<<END_OPERATION>>>
`;
            const ops = parseFileOperations(response);
            // Should only get one op from FILE_OPERATION, not also from the invoke inside
            const createOps = ops.filter(op => op.path === 'src/file.ts');
            expect(createOps).toHaveLength(1);
        });
    });

    describe('post-processing', () => {
        it('removes write_full when same file has other operations', () => {
            const response = `
<<<FILE_OPERATION>>>
TYPE: write_full
PATH: src/file.ts
DESCRIPTION: Rewrite
CONTENT:
full content
<<<END_OPERATION>>>

<<<FILE_OPERATION>>>
TYPE: edit
PATH: src/file.ts
DESCRIPTION: Edit
SEARCH:
old
REPLACE:
new
<<<END_OPERATION>>>
`;
            const ops = parseFileOperations(response);
            // write_full should win, other ops on same file removed
            const writeFull = ops.filter(op => op.type === 'write_full');
            expect(writeFull).toHaveLength(1);
        });

        it('merges multiple replace/edit ops on same file', () => {
            const response = `
<invoke name="replace_in_file">
<parameter name="path">src/file.ts</parameter>
<parameter name="search">aaa</parameter>
<parameter name="replace">AAA</parameter>
</invoke>

<invoke name="replace_in_file">
<parameter name="path">src/file.ts</parameter>
<parameter name="search">bbb</parameter>
<parameter name="replace">BBB</parameter>
</invoke>
`;
            const ops = parseFileOperations(response);
            expect(ops).toHaveLength(1);
            expect(ops[0].content).toContain('<<<<<<< SEARCH');
        });

        it('returns empty array for response with no operations', () => {
            const response = 'Here is my explanation without any file operations.';
            expect(parseFileOperations(response)).toHaveLength(0);
        });
    });
});
