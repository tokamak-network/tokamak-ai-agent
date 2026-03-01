import { describe, it, expect } from 'vitest';
import {
  parseTypeScriptErrors,
  parseVitestErrors,
  parseEslintErrors,
  parseNpmErrors,
  parsePythonErrors,
  parseGoErrors,
  analyzeTerminalOutput,
  formatErrorsForPrompt,
} from '../agent/terminalOutputParser.js';

// ---------------------------------------------------------------------------
// 1. parseTypeScriptErrors
// ---------------------------------------------------------------------------

describe('parseTypeScriptErrors', () => {
  it('parses a single error with file, line, and column', () => {
    const output = "src/foo.ts(10,5): error TS2304: Cannot find name 'bar'";
    const errors = parseTypeScriptErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: 'compile',
      file: 'src/foo.ts',
      line: 10,
      column: 5,
      message: "TS2304: Cannot find name 'bar'",
    });
  });

  it('parses multiple TypeScript errors', () => {
    const output = [
      "src/a.ts(1,1): error TS2304: Cannot find name 'x'",
      "src/b.ts(20,10): error TS2551: Property 'foo' does not exist on type 'Bar'",
    ].join('\n');
    const errors = parseTypeScriptErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0].file).toBe('src/a.ts');
    expect(errors[1].file).toBe('src/b.ts');
  });

  it('parses error without file location', () => {
    const output = "error TS6053: File 'notfound.ts' not found.";
    const errors = parseTypeScriptErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBeUndefined();
    expect(errors[0].message).toContain('TS6053');
  });

  it('returns empty array for clean output', () => {
    const output = 'Build succeeded. 0 errors, 0 warnings.';
    expect(parseTypeScriptErrors(output)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. parseVitestErrors
// ---------------------------------------------------------------------------

describe('parseVitestErrors', () => {
  it('extracts file and test name from FAIL lines', () => {
    const output = 'FAIL src/__tests__/foo.test.ts > describe > test name';
    const errors = parseVitestErrors(output);
    const failErrors = errors.filter((e) => e.testName);
    expect(failErrors.length).toBeGreaterThanOrEqual(1);
    expect(failErrors[0].file).toBe('src/__tests__/foo.test.ts');
    expect(failErrors[0].testName).toBe('describe > test name');
  });

  it('captures AssertionError messages', () => {
    const output = 'AssertionError: expected 1 to equal 2';
    const errors = parseVitestErrors(output);
    const assertErrors = errors.filter((e) => e.message.includes('expected 1 to equal 2'));
    expect(assertErrors.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts file location from stack traces', () => {
    const output = [
      'Error: Something went wrong',
      '    at Object.<anonymous> (src/utils/helper.ts:42:10)',
      '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n');
    const errors = parseVitestErrors(output);
    const withFile = errors.filter((e) => e.file);
    expect(withFile.length).toBeGreaterThanOrEqual(1);
    expect(withFile[0].file).toBe('src/utils/helper.ts');
    expect(withFile[0].line).toBe(42);
    expect(withFile[0].column).toBe(10);
  });

  it('returns empty array for passing test output', () => {
    const output = 'PASS src/__tests__/good.test.ts\nTests  1 passed';
    expect(parseVitestErrors(output)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. parseEslintErrors
// ---------------------------------------------------------------------------

describe('parseEslintErrors', () => {
  it('parses file header + diagnostic lines', () => {
    const output = [
      '/home/user/project/src/index.ts',
      '  10:5  error  Unexpected console statement  no-console',
      '  12:1  warning  Missing return type  @typescript-eslint/explicit-function-return-type',
    ].join('\n');
    const errors = parseEslintErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      type: 'lint',
      file: '/home/user/project/src/index.ts',
      line: 10,
      column: 5,
    });
    expect(errors[0].message).toContain('no-console');
    expect(errors[1].line).toBe(12);
  });

  it('associates diagnostics with the correct file', () => {
    const output = [
      'src/a.ts',
      '  1:1  error  Missing semicolon  semi',
      'src/b.ts',
      '  5:3  error  Unused variable  no-unused-vars',
    ].join('\n');
    const errors = parseEslintErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0].file).toBe('src/a.ts');
    expect(errors[1].file).toBe('src/b.ts');
  });

  it('returns empty array when no ESLint diagnostics are present', () => {
    const output = 'All files passed linting.';
    expect(parseEslintErrors(output)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. parseNpmErrors
// ---------------------------------------------------------------------------

describe('parseNpmErrors', () => {
  it('captures npm ERR! lines', () => {
    const output = [
      'npm ERR! code ELIFECYCLE',
      'npm ERR! errno 1',
      'npm ERR! project@1.0.0 test: `vitest`',
    ].join('\n');
    const errors = parseNpmErrors(output);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.every((e) => e.message.startsWith('npm ERR!'))).toBe(true);
  });

  it('detects "Cannot find module" errors', () => {
    const output = "Error: Cannot find module 'lodash'";
    const errors = parseNpmErrors(output);
    const moduleErrors = errors.filter((e) => e.message.includes("Cannot find module 'lodash'"));
    expect(moduleErrors.length).toBeGreaterThanOrEqual(1);
    expect(moduleErrors[0].type).toBe('dependency');
  });

  it('detects ENOENT error codes', () => {
    const output = 'ENOENT: no such file or directory';
    const errors = parseNpmErrors(output);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.message.includes('ENOENT'))).toBe(true);
  });

  it('returns empty array for clean npm output', () => {
    const output = 'added 50 packages in 2s';
    expect(parseNpmErrors(output)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. parsePythonErrors
// ---------------------------------------------------------------------------

describe('parsePythonErrors', () => {
  it('parses a full traceback block', () => {
    const output = [
      'Traceback (most recent call last):',
      '  File "app.py", line 42, in main',
      '    result = compute()',
      '  File "utils.py", line 10, in compute',
      '    return 1 / 0',
      'ZeroDivisionError: division by zero',
    ].join('\n');
    const errors = parsePythonErrors(output);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    const tbError = errors.find((e) => e.message.includes('ZeroDivisionError'));
    expect(tbError).toBeDefined();
    expect(tbError!.type).toBe('runtime');
    expect(tbError!.file).toBe('utils.py');
    expect(tbError!.line).toBe(10);
    expect(tbError!.stackTrace).toContain('Traceback');
  });

  it('detects ModuleNotFoundError as dependency type', () => {
    const output = [
      'Traceback (most recent call last):',
      '  File "main.py", line 1, in <module>',
      '    import flask',
      "ModuleNotFoundError: No module named 'flask'",
    ].join('\n');
    const errors = parsePythonErrors(output);
    const depErr = errors.find((e) => e.type === 'dependency');
    expect(depErr).toBeDefined();
    expect(depErr!.message).toContain('flask');
  });

  it('detects standalone SyntaxError', () => {
    const output = 'SyntaxError: invalid syntax';
    const errors = parsePythonErrors(output);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toContain('SyntaxError');
  });

  it('returns empty array for clean Python output', () => {
    const output = 'OK (3 tests passed)';
    expect(parsePythonErrors(output)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. parseGoErrors
// ---------------------------------------------------------------------------

describe('parseGoErrors', () => {
  it('parses go compiler errors with file:line:col format', () => {
    const output = './main.go:10:5: undefined: foo';
    const errors = parseGoErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: 'compile',
      file: './main.go',
      line: 10,
      column: 5,
      message: 'undefined: foo',
    });
  });

  it('parses multiple Go errors', () => {
    const output = [
      './main.go:10:5: undefined: foo',
      './handler.go:25:12: cannot use x (type int) as type string',
    ].join('\n');
    const errors = parseGoErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0].file).toBe('./main.go');
    expect(errors[1].file).toBe('./handler.go');
  });

  it('returns empty array for clean Go output', () => {
    const output = 'ok  \tgithub.com/user/project\t0.015s';
    expect(parseGoErrors(output)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. analyzeTerminalOutput
// ---------------------------------------------------------------------------

describe('analyzeTerminalOutput', () => {
  it('detects success for clean output with no errors', () => {
    const output = 'Build completed successfully.\n0 errors found.';
    const result = analyzeTerminalOutput(output);
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('detects TypeScript errors and suggests fix_code', () => {
    const output = "src/foo.ts(10,5): error TS2304: Cannot find name 'bar'";
    const result = analyzeTerminalOutput(output);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.suggestedAction).toBe('fix_code');
  });

  it('detects npm dependency errors and suggests install_deps', () => {
    const output = "npm ERR! code E404\nnpm ERR! 404 Not Found: nonexistent-package@latest";
    const result = analyzeTerminalOutput(output);
    expect(result.success).toBe(false);
    expect(result.suggestedAction).toBe('install_deps');
  });

  it('handles mixed output with multiple ecosystems', () => {
    const output = [
      "src/foo.ts(10,5): error TS2304: Cannot find name 'bar'",
      "npm ERR! code ENOENT",
    ].join('\n');
    const result = analyzeTerminalOutput(output);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('treats empty output as success (no errors detected)', () => {
    const result = analyzeTerminalOutput('');
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. formatErrorsForPrompt
// ---------------------------------------------------------------------------

describe('formatErrorsForPrompt', () => {
  it('returns "No errors detected." for an empty array', () => {
    expect(formatErrorsForPrompt([])).toBe('No errors detected.');
  });

  it('formats a single error with file location', () => {
    const result = formatErrorsForPrompt([
      {
        type: 'compile',
        message: "TS2304: Cannot find name 'x'",
        file: 'src/foo.ts',
        line: 10,
        column: 5,
      },
    ]);
    expect(result).toContain('1 error(s)');
    expect(result).toContain('[1]');
    expect(result).toContain('(compile)');
    expect(result).toContain("TS2304: Cannot find name 'x'");
    expect(result).toContain('File: src/foo.ts:10:5');
  });

  it('formats multiple errors with different types', () => {
    const result = formatErrorsForPrompt([
      { type: 'compile', message: 'Error A' },
      { type: 'test', message: 'Error B', testName: 'should work' },
      { type: 'dependency', message: 'Error C' },
    ]);
    expect(result).toContain('3 error(s)');
    expect(result).toContain('[1]');
    expect(result).toContain('[2]');
    expect(result).toContain('[3]');
    expect(result).toContain('(compile)');
    expect(result).toContain('(test)');
    expect(result).toContain('(dependency)');
    expect(result).toContain('Test: should work');
  });
});
