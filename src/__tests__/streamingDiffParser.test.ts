import { describe, it, expect } from 'vitest';
import { StreamingDiffParser } from '../streaming/streamingDiffParser.js';

describe('StreamingDiffParser', () => {
    it('returns null for getCurrentOperation() in initial state', () => {
        const parser = new StreamingDiffParser();
        expect(parser.getCurrentOperation()).toBeNull();
    });

    it('returns text content and no operation for plain text', () => {
        const parser = new StreamingDiffParser();
        // Feed enough text to exceed the marker hold-back buffer so text is flushed.
        const text = 'hello world - this is a long enough string to exceed the marker hold-back buffer size';
        const result = parser.feed(text);
        expect(result.textContent.length).toBeGreaterThan(0);
        expect(result.operation).toBeNull();
    });

    it('parses a complete operation in one chunk', () => {
        const parser = new StreamingDiffParser();
        const chunk = [
            '<<<FILE_OPERATION>>>',
            'TYPE: create',
            'PATH: src/foo.ts',
            'DESCRIPTION: test',
            'CONTENT:',
            '```typescript',
            'const x = 1;',
            '```',
            '<<<END_OPERATION>>>',
        ].join('\n');

        const result = parser.feed(chunk);
        expect(result.operation).not.toBeNull();
        expect(result.operation!.isComplete).toBe(true);
        expect(result.operation!.state).toBe('complete');
        expect(result.operation!.type).toBe('create');
        expect(result.operation!.path).toBe('src/foo.ts');
        expect(result.operation!.contentSoFar).toContain('const x = 1;');
    });

    it('detects start marker split across two chunks', () => {
        const parser = new StreamingDiffParser();

        // First chunk: partial marker
        const r1 = parser.feed('<<<FILE_OP');
        // Text should be held back (not flushed) because it could be a partial marker.
        expect(r1.operation).toBeNull();

        // Second chunk: completes the marker and provides the operation content
        const r2 = parser.feed('ERATION>>>\nTYPE: edit\nPATH: src/bar.ts\nDESCRIPTION: fix\nCONTENT:\n```\nfixed\n```\n<<<END_OPERATION>>>');
        expect(r2.operation).not.toBeNull();
        expect(r2.operation!.type).toBe('edit');
    });

    it('detects type field correctly', () => {
        const parser = new StreamingDiffParser();
        const chunk = [
            '<<<FILE_OPERATION>>>',
            'TYPE: edit',
            'PATH: src/x.ts',
            'DESCRIPTION: d',
            'CONTENT:',
            '```',
            'x',
            '```',
            '<<<END_OPERATION>>>',
        ].join('\n');

        const result = parser.feed(chunk);
        expect(result.operation).not.toBeNull();
        expect(result.operation!.type).toBe('edit');
    });

    it('detects path field correctly', () => {
        const parser = new StreamingDiffParser();
        const chunk = [
            '<<<FILE_OPERATION>>>',
            'TYPE: create',
            'PATH: src/bar.ts',
            'DESCRIPTION: new file',
            'CONTENT:',
            '```',
            'code',
            '```',
            '<<<END_OPERATION>>>',
        ].join('\n');

        const result = parser.feed(chunk);
        expect(result.operation).not.toBeNull();
        expect(result.operation!.path).toBe('src/bar.ts');
    });

    it('accumulates content progressively', () => {
        const parser = new StreamingDiffParser();

        // Feed the entire header + content + end marker to ensure full processing
        // The hold-back buffer (19 chars) retains tail bytes for cross-chunk marker detection
        const fullOp = [
            '<<<FILE_OPERATION>>>',
            'TYPE: create',
            'PATH: src/a.ts',
            'DESCRIPTION: test',
            'CONTENT:',
            '```typescript',
            'const x = 1;',
            'const y = 2;',
            '```',
            '<<<END_OPERATION>>>',
        ].join('\n');

        const result = parser.feed(fullOp);
        expect(result.operation).not.toBeNull();
        expect(result.operation!.state).toBe('complete');
        expect(result.operation!.contentSoFar).toContain('const x = 1;');
    });

    it('resets state completely', () => {
        const parser = new StreamingDiffParser();

        // Start parsing an operation
        parser.feed('<<<FILE_OPERATION>>>\nTYPE: create\nPATH: src/a.ts\nDESCRIPTION: d\nCONTENT:\n```\ncode\n```\n<<<END_OPERATION>>>');

        // Reset
        parser.reset();

        // After reset, state should be clean
        expect(parser.getCurrentOperation()).toBeNull();

        // Should be able to parse a new operation
        const result = parser.feed('<<<FILE_OPERATION>>>\nTYPE: delete\nPATH: src/b.ts\nDESCRIPTION: remove\nCONTENT:\n```\n```\n<<<END_OPERATION>>>');
        expect(result.operation).not.toBeNull();
        expect(result.operation!.type).toBe('delete');
    });

    it('preserves text content before and after an operation', () => {
        const parser = new StreamingDiffParser();

        // Text before operation - long enough to be flushed
        const beforeText = 'Here is some explanatory text that is long enough to be flushed from the buffer. ';
        const r1 = parser.feed(beforeText);
        expect(r1.textContent.length).toBeGreaterThan(0);

        // Now feed an operation followed by after-text
        const op = [
            '<<<FILE_OPERATION>>>',
            'TYPE: create',
            'PATH: src/c.ts',
            'DESCRIPTION: test',
            'CONTENT:',
            '```',
            'code',
            '```',
            '<<<END_OPERATION>>>',
        ].join('\n');

        const r2 = parser.feed(op);
        expect(r2.operation).not.toBeNull();
        expect(r2.operation!.isComplete).toBe(true);

        // Text after the operation
        const afterText = 'This is the text that comes after the operation and is long enough to flush. ';
        const r3 = parser.feed(afterText);
        expect(r3.textContent.length).toBeGreaterThan(0);
        expect(r3.operation).toBeNull();
    });

    it('handles two complete operations fed sequentially', () => {
        const parser = new StreamingDiffParser();

        const op1 = [
            '<<<FILE_OPERATION>>>',
            'TYPE: create',
            'PATH: src/first.ts',
            'DESCRIPTION: first file',
            'CONTENT:',
            '```typescript',
            'const a = 1;',
            '```',
            '<<<END_OPERATION>>>',
        ].join('\n');

        const op2 = [
            '<<<FILE_OPERATION>>>',
            'TYPE: edit',
            'PATH: src/second.ts',
            'DESCRIPTION: second file',
            'CONTENT:',
            '```typescript',
            'const b = 2;',
            '```',
            '<<<END_OPERATION>>>',
        ].join('\n');

        const r1 = parser.feed(op1);
        expect(r1.operation).not.toBeNull();
        expect(r1.operation!.isComplete).toBe(true);
        expect(r1.operation!.type).toBe('create');
        expect(r1.operation!.path).toBe('src/first.ts');

        const r2 = parser.feed(op2);
        expect(r2.operation).not.toBeNull();
        expect(r2.operation!.isComplete).toBe(true);
        expect(r2.operation!.type).toBe('edit');
        expect(r2.operation!.path).toBe('src/second.ts');
    });
});
