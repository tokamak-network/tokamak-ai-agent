import { describe, it, expect } from 'vitest';
import {
    removeAutoExecutionCode,
    unescapeHtmlEntities,
    removeTrailingBackticks,
    stripThinkingBlocks,
    removeControlCharacterArtifacts,
    applySearchReplaceBlocks,
} from '../utils/contentUtils.js';

describe('removeAutoExecutionCode', () => {
    it('removes run() call at end of JS file', () => {
        const input = 'function hello() {}\nrun();\n';
        const result = removeAutoExecutionCode(input, 'test.js');
        expect(result).not.toContain('run()');
    });

    it('removes standalone main() call at end of file', () => {
        const input = 'function main() { return 1; }\nmain();\n';
        const result = removeAutoExecutionCode(input, 'test.ts');
        // Only the standalone main(); call is removed, the function def stays
        expect(result).not.toMatch(/^\s*main\(\)\s*;?\s*$/m);
        expect(result).toContain('function main()');
    });

    it('removes Python __main__ block', () => {
        const input = 'def main():\n    pass\n\nif __name__ == \'__main__\':\n    main()\n';
        const result = removeAutoExecutionCode(input, 'test.py');
        expect(result).not.toContain('__main__');
    });

    it('preserves code that does not have auto-execution patterns', () => {
        const input = 'export function hello() {\n  return "world";\n}';
        const result = removeAutoExecutionCode(input, 'test.ts');
        expect(result).toBe(input.trimEnd());
    });

    it('returns empty string unchanged', () => {
        expect(removeAutoExecutionCode('', 'test.ts')).toBe('');
    });
});

describe('unescapeHtmlEntities', () => {
    it('converts &lt; to <', () => {
        expect(unescapeHtmlEntities('&lt;div&gt;', 'test.ts')).toBe('<div>');
    });

    it('converts &gt; to >', () => {
        expect(unescapeHtmlEntities('a &gt; b', 'test.ts')).toBe('a > b');
    });

    it('converts &amp; to &', () => {
        expect(unescapeHtmlEntities('foo &amp; bar', 'test.ts')).toBe('foo & bar');
    });

    it('converts &quot; to "', () => {
        expect(unescapeHtmlEntities('&quot;hello&quot;', 'test.ts')).toBe('"hello"');
    });

    it('converts &#39; to single quote', () => {
        expect(unescapeHtmlEntities('it&#39;s', 'test.ts')).toBe("it's");
    });

    it('does NOT unescape HTML files', () => {
        const input = '&lt;div&gt;';
        expect(unescapeHtmlEntities(input, 'index.html')).toBe(input);
    });

    it('does NOT unescape XML files', () => {
        const input = '&lt;tag&gt;';
        expect(unescapeHtmlEntities(input, 'config.xml')).toBe(input);
    });

    it('returns empty string unchanged', () => {
        expect(unescapeHtmlEntities('', 'test.ts')).toBe('');
    });
});

describe('removeTrailingBackticks', () => {
    it('removes trailing triple backticks', () => {
        expect(removeTrailingBackticks('code here\n```')).toBe('code here');
    });

    it('removes multiple trailing backtick blocks', () => {
        expect(removeTrailingBackticks('code\n```\n```')).toBe('code');
    });

    it('preserves code with internal backticks', () => {
        const input = '```typescript\nconst x = 1;\n```';
        const result = removeTrailingBackticks(input);
        // Should remove the trailing ``` but keep internal content
        expect(result).not.toMatch(/```\s*$/);
    });

    it('returns empty string unchanged', () => {
        expect(removeTrailingBackticks('')).toBe('');
    });
});

describe('stripThinkingBlocks', () => {
    it('removes <think>...</think> blocks', () => {
        const input = '<think>internal reasoning</think>\nactual response';
        expect(stripThinkingBlocks(input)).toBe('actual response');
    });

    it('removes <thinking>...</thinking> blocks', () => {
        const input = '<thinking>step by step</thinking>\nresult';
        expect(stripThinkingBlocks(input)).toBe('result');
    });

    it('removes [TOOL_CALL]...[/TOOL_CALL] blocks', () => {
        const input = '[TOOL_CALL]some tool call[/TOOL_CALL]\noutput';
        expect(stripThinkingBlocks(input)).toBe('output');
    });

    it('handles multiline think blocks', () => {
        const input = '<think>\nline 1\nline 2\n</think>\nresponse';
        expect(stripThinkingBlocks(input)).toBe('response');
    });

    it('returns text unchanged when no thinking blocks present', () => {
        const input = 'plain response without thinking';
        expect(stripThinkingBlocks(input)).toBe(input);
    });

    it('returns empty string unchanged', () => {
        expect(stripThinkingBlocks('')).toBe('');
    });
});

describe('removeControlCharacterArtifacts', () => {
    it('removes <ctrl46> type artifacts', () => {
        expect(removeControlCharacterArtifacts('hello<ctrl46>world')).toBe('helloworld');
    });

    it('removes actual ASCII control characters (except \\n, \\t, \\r)', () => {
        // \x07 is BEL (bell character)
        const input = 'hello\x07world';
        expect(removeControlCharacterArtifacts(input)).toBe('helloworld');
    });

    it('preserves newlines and tabs', () => {
        const input = 'line1\nline2\ttabbed';
        expect(removeControlCharacterArtifacts(input)).toContain('line1\nline2\ttabbed');
    });

    it('collapses 3+ consecutive newlines to 2', () => {
        const input = 'a\n\n\n\nb';
        expect(removeControlCharacterArtifacts(input)).toBe('a\n\nb');
    });

    it('returns empty string unchanged', () => {
        expect(removeControlCharacterArtifacts('')).toBe('');
    });
});

describe('applySearchReplaceBlocks', () => {
    it('applies a basic SEARCH/REPLACE block', () => {
        const original = 'hello world\nfoo bar';
        const diff = '<<<<<<< SEARCH\nhello world\n=======\nhello universe\n>>>>>>> REPLACE';
        const result = applySearchReplaceBlocks(original, diff);
        expect(result).toBe('hello universe\nfoo bar');
    });

    it('returns null when SEARCH string not found', () => {
        const original = 'hello world';
        const diff = '<<<<<<< SEARCH\nnonexistent\n=======\nreplacement\n>>>>>>> REPLACE';
        const result = applySearchReplaceBlocks(original, diff);
        expect(result).toBeNull();
    });

    it('returns null when no SEARCH/REPLACE blocks present', () => {
        const original = 'hello world';
        const diff = 'no blocks here';
        expect(applySearchReplaceBlocks(original, diff)).toBeNull();
    });

    it('applies multiple SEARCH/REPLACE blocks in sequence', () => {
        const original = 'aaa\nbbb\nccc';
        const diff = [
            '<<<<<<< SEARCH',
            'aaa',
            '=======',
            'AAA',
            '>>>>>>> REPLACE',
            '',
            '<<<<<<< SEARCH',
            'ccc',
            '=======',
            'CCC',
            '>>>>>>> REPLACE',
        ].join('\n');
        const result = applySearchReplaceBlocks(original, diff);
        expect(result).toBe('AAA\nbbb\nCCC\n');
    });

    it('handles empty SEARCH for empty file (prepend)', () => {
        const original = '';
        const diff = '<<<<<<< SEARCH\n=======\nnew content\n>>>>>>> REPLACE';
        const result = applySearchReplaceBlocks(original, diff);
        expect(result).toBe('new content\n');
    });

    it('uses tier-2 line-trimmed matching for whitespace differences', () => {
        const original = '  function foo() {\n    return 1;\n  }';
        // SEARCH with different indentation
        const diff = '<<<<<<< SEARCH\nfunction foo() {\n  return 1;\n}\n=======\nfunction foo() {\n  return 2;\n}\n>>>>>>> REPLACE';
        const result = applySearchReplaceBlocks(original, diff);
        expect(result).not.toBeNull();
        expect(result).toContain('return 2;');
    });
});
