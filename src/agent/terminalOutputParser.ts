/**
 * Terminal Output Parser — pure module for the Terminal Feedback Loop feature.
 *
 * Parses compiler, test-runner, linter, package-manager, and runtime error
 * output into structured TerminalError objects so the agent can automatically
 * propose fixes.
 *
 * No VS Code or Node-specific imports — every function is pure and
 * regex-based.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TerminalError {
  type: 'compile' | 'test' | 'lint' | 'runtime' | 'dependency' | 'unknown';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  testName?: string;
  stackTrace?: string;
}

export interface TerminalAnalysis {
  success: boolean;
  errors: TerminalError[];
  suggestedAction?: 'fix_code' | 'install_deps' | 'change_config' | 'skip';
}

// ---------------------------------------------------------------------------
// 1. TypeScript errors
// ---------------------------------------------------------------------------

/**
 * Parse `tsc` output.
 *
 * Recognised patterns:
 *   src/file.ts(10,5): error TS2304: Cannot find name 'foo'.
 *   error TS2304: Cannot find name 'foo'.
 */
export function parseTypeScriptErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];

  // Pattern with file location
  const filePattern =
    /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = filePattern.exec(output)) !== null) {
    errors.push({
      type: 'compile',
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      message: `${match[4]}: ${match[5]}`,
    });
  }

  // Pattern without file location (e.g. from project-wide checks)
  const noFilePattern = /^error\s+(TS\d+):\s*(.+)$/gm;
  while ((match = noFilePattern.exec(output)) !== null) {
    // Avoid duplicating errors we already captured with file info
    const msg = `${match[1]}: ${match[2]}`;
    if (!errors.some((e) => e.message === msg)) {
      errors.push({
        type: 'compile',
        message: msg,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 2. Vitest errors
// ---------------------------------------------------------------------------

/**
 * Parse Vitest / Jest-style test output.
 *
 * Recognised patterns:
 *   FAIL  src/__tests__/foo.test.ts > describe > test name
 *   AssertionError: expected … to …
 *   Error: … with stack trace containing file:line:col
 */
export function parseVitestErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];

  // FAIL lines — extract file and test name
  const failPattern =
    /FAIL\s+(\S+\.(?:test|spec)\.\w+)\s*>\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = failPattern.exec(output)) !== null) {
    errors.push({
      type: 'test',
      file: match[1],
      testName: match[2].trim(),
      message: `Test failed: ${match[2].trim()}`,
    });
  }

  // AssertionError / AssertionError (vitest sometimes uses this spelling)
  const assertionPattern =
    /(?:Assertion|Assertion)Error:\s*(.+)$/gm;
  while ((match = assertionPattern.exec(output)) !== null) {
    errors.push({
      type: 'test',
      message: match[1].trim(),
    });
  }

  // Generic Error: … with optional stack trace file:line:col
  // We look for "Error: message" followed by a stack line with file location.
  const errorBlockPattern =
    /(?:^|\n)\s*((?:\w+)?Error:\s*.+?)(?:\n([\s\S]*?))?(?=\n\s*(?:FAIL|PASS|Test Files|Tests\s)|$)/gm;
  while ((match = errorBlockPattern.exec(output)) !== null) {
    const message = match[1].trim();
    const stack = match[2] || '';

    // Skip if we already captured this as an AssertionError
    if (/(?:Assertion|Assertion)Error/.test(message)) {
      continue;
    }

    const locMatch = stack.match(/\s+at\s+.+?\(?([\w./\\-]+):(\d+):(\d+)\)?/);
    const error: TerminalError = {
      type: 'test',
      message,
    };
    if (locMatch) {
      error.file = locMatch[1];
      error.line = parseInt(locMatch[2], 10);
      error.column = parseInt(locMatch[3], 10);
    }
    if (stack.trim()) {
      error.stackTrace = stack.trim();
    }
    errors.push(error);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 3. ESLint errors
// ---------------------------------------------------------------------------

/**
 * Parse ESLint output (default formatter).
 *
 * Recognised patterns:
 *   /absolute/path/to/file.ts
 *     10:5  error  Description  rule-name
 *     12:1  warning  Description  rule-name
 */
export function parseEslintErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];

  // Split into lines for contextual parsing — the file path appears on its
  // own line, followed by indented diagnostic lines.
  const lines = output.split('\n');
  let currentFile: string | undefined;

  const fileLinePattern = /^(\/\S+\.\w+)\s*$/;
  // Also accept Windows-style paths or relative paths that look like eslint file headers
  const fileLinePatternAlt = /^(\S+\.\w+)\s*$/;
  const diagPattern =
    /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/;

  for (const line of lines) {
    const fileMatch = fileLinePattern.exec(line) || fileLinePatternAlt.exec(line);
    if (fileMatch && !diagPattern.test(line)) {
      currentFile = fileMatch[1];
      continue;
    }

    const diagMatch = diagPattern.exec(line);
    if (diagMatch) {
      errors.push({
        type: 'lint',
        file: currentFile,
        line: parseInt(diagMatch[1], 10),
        column: parseInt(diagMatch[2], 10),
        message: `${diagMatch[5]}: ${diagMatch[4]}`,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 4. npm errors
// ---------------------------------------------------------------------------

/**
 * Parse npm / yarn error output.
 *
 * Recognised patterns:
 *   npm ERR! …
 *   npm warn …
 *   ENOENT / EACCES / E404
 *   Cannot find module '…'
 */
export function parseNpmErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];

  // npm ERR! lines
  const npmErrPattern = /^npm\s+ERR!\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = npmErrPattern.exec(output)) !== null) {
    const message = match[1].trim();
    // Classify known error codes
    const isDep = /E(?:NOENT|ACCES|404|RESOLVE)|peer dep|ERESOLVE|missing|not found/i.test(message);
    errors.push({
      type: isDep ? 'dependency' : 'runtime',
      message: `npm ERR! ${message}`,
    });
  }

  // npm warn lines (often useful context for dependency issues)
  const npmWarnPattern = /^npm\s+warn\s+(.+)$/gm;
  while ((match = npmWarnPattern.exec(output)) !== null) {
    const message = match[1].trim();
    if (/peer dep|deprecated|ERESOLVE/i.test(message)) {
      errors.push({
        type: 'dependency',
        message: `npm warn: ${message}`,
      });
    }
  }

  // Standalone error codes that might appear outside npm ERR! lines
  const errCodePattern = /\b(ENOENT|EACCES|E404|ERESOLVE)\b/g;
  while ((match = errCodePattern.exec(output)) !== null) {
    if (!errors.some((e) => e.message.includes(match![1]))) {
      errors.push({
        type: 'dependency',
        message: `${match[1]} error encountered`,
      });
    }
  }

  // Cannot find module
  const modulePattern = /Cannot find module\s+'([^']+)'/g;
  while ((match = modulePattern.exec(output)) !== null) {
    errors.push({
      type: 'dependency',
      message: `Cannot find module '${match[1]}'`,
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 5. Python errors
// ---------------------------------------------------------------------------

/**
 * Parse Python traceback and common error output.
 *
 * Recognised patterns:
 *   File "path.py", line 10, in func
 *   Traceback (most recent call last):
 *   ModuleNotFoundError / ImportError / SyntaxError / …
 */
export function parsePythonErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];

  // Capture full tracebacks
  const tracebackPattern =
    /Traceback \(most recent call last\):\n([\s\S]*?)(?:^(\w*(?:Error|Exception)\w*:\s*.+)$)/gm;
  let match: RegExpExecArray | null;
  while ((match = tracebackPattern.exec(output)) !== null) {
    const stack = match[1].trim();
    const errorLine = match[2].trim();

    // Extract the deepest file location from the stack
    const fileLocPattern = /File "([^"]+)", line (\d+)(?:, in (\S+))?/g;
    let lastFileLoc: RegExpExecArray | null = null;
    let fileLoc: RegExpExecArray | null;
    while ((fileLoc = fileLocPattern.exec(stack)) !== null) {
      lastFileLoc = fileLoc;
    }

    const isDep =
      /ModuleNotFoundError|ImportError/.test(errorLine);

    const error: TerminalError = {
      type: isDep ? 'dependency' : 'runtime',
      message: errorLine,
      stackTrace: `Traceback (most recent call last):\n${stack}\n${errorLine}`,
    };
    if (lastFileLoc) {
      error.file = lastFileLoc[1];
      error.line = parseInt(lastFileLoc[2], 10);
    }
    errors.push(error);
  }

  // Standalone Python errors without full tracebacks
  const standaloneErrorPattern =
    /^(ModuleNotFoundError|ImportError|SyntaxError|NameError|TypeError|ValueError|AttributeError|IndentationError|FileNotFoundError):\s*(.+)$/gm;
  while ((match = standaloneErrorPattern.exec(output)) !== null) {
    const fullMsg = `${match[1]}: ${match[2]}`;
    // Avoid duplicates from traceback parsing
    if (!errors.some((e) => e.message === fullMsg)) {
      const isDep =
        match[1] === 'ModuleNotFoundError' || match[1] === 'ImportError';
      errors.push({
        type: isDep ? 'dependency' : (match[1] === 'SyntaxError' ? 'compile' : 'runtime'),
        message: fullMsg,
      });
    }
  }

  // File "path.py", line N references without a full traceback
  const fileRefPattern = /File "([^"]+)", line (\d+)/g;
  while ((match = fileRefPattern.exec(output)) !== null) {
    // Only add if we don't already have an error for this file+line
    const file = match[1];
    const line = parseInt(match[2], 10);
    if (!errors.some((e) => e.file === file && e.line === line)) {
      errors.push({
        type: 'runtime',
        file,
        line,
        message: `Error at ${file}:${line}`,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 6. Go errors
// ---------------------------------------------------------------------------

/**
 * Parse Go compiler / vet / test error output.
 *
 * Recognised pattern:
 *   ./file.go:10:5: error message
 */
export function parseGoErrors(output: string): TerminalError[] {
  const errors: TerminalError[] = [];

  const goPattern = /^(\.\/.+?\.go):(\d+):(\d+):\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = goPattern.exec(output)) !== null) {
    errors.push({
      type: 'compile',
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      message: match[4].trim(),
    });
  }

  // Also match patterns without column (go vet, linker errors, etc.)
  const goPatternNoCol = /^(\.\/.+?\.go):(\d+):\s*(.+)$/gm;
  while ((match = goPatternNoCol.exec(output)) !== null) {
    const file = match[1];
    const line = parseInt(match[2], 10);
    // Avoid duplicates from the more specific pattern above
    if (!errors.some((e) => e.file === file && e.line === line)) {
      errors.push({
        type: 'compile',
        file,
        line,
        message: match[3].trim(),
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 7. Main dispatcher — analyzeTerminalOutput
// ---------------------------------------------------------------------------

/**
 * Analyse raw terminal output: detect ecosystem, run relevant parsers,
 * deduplicate, and recommend an action.
 */
export function analyzeTerminalOutput(output: string): TerminalAnalysis {
  const allErrors: TerminalError[] = [];

  // Detect which ecosystems are present and run their parsers

  // TypeScript
  if (/error TS\d+/.test(output)) {
    allErrors.push(...parseTypeScriptErrors(output));
  }

  // Vitest / Jest
  if (/FAIL\s+\S+\.(?:test|spec)\.\w+/.test(output) ||
      /(?:Assertion|Assertion)Error/.test(output) ||
      /vitest|jest/i.test(output)) {
    allErrors.push(...parseVitestErrors(output));
  }

  // ESLint
  if (/^\s+\d+:\d+\s+(?:error|warning)\s+/m.test(output)) {
    allErrors.push(...parseEslintErrors(output));
  }

  // npm / yarn
  if (/npm\s+ERR!|npm\s+warn|Cannot find module/i.test(output)) {
    allErrors.push(...parseNpmErrors(output));
  }

  // Python
  if (/Traceback \(most recent call last\)|File ".+", line \d+|(?:ModuleNotFoundError|ImportError|SyntaxError):/m.test(output)) {
    allErrors.push(...parsePythonErrors(output));
  }

  // Go
  if (/^\.\/.+\.go:\d+:/m.test(output)) {
    allErrors.push(...parseGoErrors(output));
  }

  // Deduplicate — two errors are considered duplicates if type+message+file+line all match
  const deduplicated = deduplicateErrors(allErrors);

  // Determine success
  const success = determineSuccess(output, deduplicated);

  // Determine suggested action
  const suggestedAction = determineSuggestedAction(deduplicated);

  return {
    success,
    errors: deduplicated,
    ...(suggestedAction ? { suggestedAction } : {}),
  };
}

// ---------------------------------------------------------------------------
// 8. formatErrorsForPrompt
// ---------------------------------------------------------------------------

/**
 * Format an array of TerminalError objects into a structured string suitable
 * for inclusion in an AI prompt.
 */
export function formatErrorsForPrompt(errors: TerminalError[]): string {
  if (errors.length === 0) {
    return 'No errors detected.';
  }

  const lines: string[] = [`Found ${errors.length} error(s):\n`];

  for (let i = 0; i < errors.length; i++) {
    const e = errors[i];
    const parts: string[] = [];

    parts.push(`[${i + 1}] (${e.type}) ${e.message}`);
    if (e.file) {
      let loc = `    File: ${e.file}`;
      if (e.line !== undefined) {
        loc += `:${e.line}`;
        if (e.column !== undefined) {
          loc += `:${e.column}`;
        }
      }
      parts.push(loc);
    }
    if (e.testName) {
      parts.push(`    Test: ${e.testName}`);
    }
    if (e.stackTrace) {
      // Indent stack trace and truncate to keep prompt concise
      const truncated = e.stackTrace.split('\n').slice(0, 8).join('\n');
      parts.push(`    Stack:\n${truncated.split('\n').map((l) => `      ${l}`).join('\n')}`);
    }

    lines.push(parts.join('\n'));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function deduplicateErrors(errors: TerminalError[]): TerminalError[] {
  const seen = new Set<string>();
  const result: TerminalError[] = [];

  for (const error of errors) {
    const key = `${error.type}|${error.message}|${error.file ?? ''}|${error.line ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(error);
    }
  }

  return result;
}

function determineSuccess(output: string, errors: TerminalError[]): boolean {
  // Explicit exit code markers
  if (/exit\s+code\s*[:\s]+0\b/i.test(output)) {
    return true;
  }
  if (/exit\s+code\s*[:\s]+[1-9]\d*/i.test(output)) {
    return false;
  }

  // Common success markers
  if (/Tests?\s+\d+\s+passed/i.test(output) && errors.length === 0) {
    return true;
  }
  if (/\b0 errors?\b/i.test(output) && errors.length === 0) {
    return true;
  }

  // If we found any errors, not a success
  if (errors.length > 0) {
    return false;
  }

  // Default optimistic — no errors detected means probable success
  return true;
}

function determineSuggestedAction(
  errors: TerminalError[],
): 'fix_code' | 'install_deps' | 'change_config' | 'skip' | undefined {
  if (errors.length === 0) {
    return undefined;
  }

  const hasDep = errors.some((e) => e.type === 'dependency');
  const hasCompile = errors.some((e) => e.type === 'compile');
  const hasLint = errors.some((e) => e.type === 'lint');
  const hasTest = errors.some((e) => e.type === 'test');
  const hasRuntime = errors.some((e) => e.type === 'runtime');

  // Dependency problems should be resolved first
  if (hasDep && !hasCompile && !hasTest && !hasLint) {
    return 'install_deps';
  }

  // Mixed dependency + code errors — still try install first
  if (hasDep) {
    return 'install_deps';
  }

  // Compile or lint errors are directly fixable in code
  if (hasCompile || hasLint || hasTest || hasRuntime) {
    return 'fix_code';
  }

  return 'fix_code';
}
