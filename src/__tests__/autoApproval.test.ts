import { describe, it, expect } from 'vitest';
import {
  getDefaultAutoApprovalConfig,
  classifyOperation,
  shouldAutoApprove,
  matchGlobPattern,
  matchCommandPattern,
  AutoApprovalConfig,
} from '../approval/autoApproval.js';

// ---------------------------------------------------------------------------
// getDefaultAutoApprovalConfig
// ---------------------------------------------------------------------------

describe('getDefaultAutoApprovalConfig', () => {
  it('returns disabled by default with expected tool levels', () => {
    const cfg = getDefaultAutoApprovalConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.tools.write_file).toBe('ask');
    expect(cfg.tools.create_file).toBe('ask');
    expect(cfg.tools.delete_file).toBe('ask');
    expect(cfg.tools.terminal_command).toBe('ask');
    expect(cfg.allowedPaths).toEqual([]);
    expect(cfg.protectedPaths).toEqual([]);
    expect(cfg.allowedCommands).toEqual([]);
    expect(cfg.maxAutoApproveFileSize).toBe(1_048_576);
  });

  it('sets read_file and search to always_allow by default', () => {
    const cfg = getDefaultAutoApprovalConfig();
    expect(cfg.tools.read_file).toBe('always_allow');
    expect(cfg.tools.search).toBe('always_allow');
  });
});

// ---------------------------------------------------------------------------
// classifyOperation
// ---------------------------------------------------------------------------

describe('classifyOperation', () => {
  it('maps "read" to read_file', () => {
    expect(classifyOperation('read')).toBe('read_file');
  });

  it('maps "create" to create_file', () => {
    expect(classifyOperation('create')).toBe('create_file');
  });

  it('maps "delete" to delete_file', () => {
    expect(classifyOperation('delete')).toBe('delete_file');
  });

  it('maps write-related ops (edit, write_full, replace, prepend, append, write, multi_write) to write_file', () => {
    for (const op of ['edit', 'write_full', 'replace', 'prepend', 'append', 'write', 'multi_write']) {
      expect(classifyOperation(op)).toBe('write_file');
    }
  });

  it('maps "run" to terminal_command and "search" to search', () => {
    expect(classifyOperation('run')).toBe('terminal_command');
    expect(classifyOperation('search')).toBe('search');
  });

  it('maps unknown operation types to write_file as a safe default', () => {
    expect(classifyOperation('foobar')).toBe('write_file');
    expect(classifyOperation('')).toBe('write_file');
  });
});

// ---------------------------------------------------------------------------
// matchGlobPattern
// ---------------------------------------------------------------------------

describe('matchGlobPattern', () => {
  it('matches *.ts against foo.ts', () => {
    expect(matchGlobPattern('*.ts', 'foo.ts')).toBe(true);
  });

  it('matches src/**/*.ts against deeply nested paths', () => {
    expect(matchGlobPattern('src/**/*.ts', 'src/a/b.ts')).toBe(true);
    expect(matchGlobPattern('src/**/*.ts', 'src/utils/deep/file.ts')).toBe(true);
  });

  it('matches ? wildcard for single character', () => {
    expect(matchGlobPattern('?oo.ts', 'foo.ts')).toBe(true);
    expect(matchGlobPattern('?oo.ts', 'boo.ts')).toBe(true);
  });

  it('does not match when the pattern does not fit', () => {
    expect(matchGlobPattern('*.ts', 'foo.js')).toBe(false);
    expect(matchGlobPattern('src/*.ts', 'src/a/b.ts')).toBe(false); // * does not cross /
    expect(matchGlobPattern('?oo.ts', 'fooo.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchCommandPattern
// ---------------------------------------------------------------------------

describe('matchCommandPattern', () => {
  it('matches exact command strings', () => {
    expect(matchCommandPattern('npm test', 'npm test')).toBe(true);
  });

  it('matches wildcard patterns like "npm run *"', () => {
    expect(matchCommandPattern('npm run *', 'npm run build')).toBe(true);
    expect(matchCommandPattern('npm run *', 'npm run lint')).toBe(true);
  });

  it('does not match when the pattern differs', () => {
    expect(matchCommandPattern('npm run *', 'npm test')).toBe(false);
    expect(matchCommandPattern('npm test', 'npm run test')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldAutoApprove
// ---------------------------------------------------------------------------

describe('shouldAutoApprove', () => {
  /** Helper to build an enabled config with sensible defaults. */
  function enabledConfig(overrides?: Partial<AutoApprovalConfig>): AutoApprovalConfig {
    return {
      ...getDefaultAutoApprovalConfig(),
      enabled: true,
      ...overrides,
    };
  }

  it('returns false when auto-approval is globally disabled', () => {
    const cfg = getDefaultAutoApprovalConfig(); // enabled: false
    expect(shouldAutoApprove(cfg, 'read_file', 'foo.ts')).toBe(false);
  });

  it('returns true for read_file when enabled and level is always_allow', () => {
    const cfg = enabledConfig();
    expect(shouldAutoApprove(cfg, 'read_file', 'anything.ts')).toBe(true);
  });

  it('returns false for write_file when level is ask', () => {
    const cfg = enabledConfig(); // write_file defaults to 'ask'
    expect(shouldAutoApprove(cfg, 'write_file', 'foo.ts')).toBe(false);
  });

  it('returns false when file matches a protected path even if tool is always_allow', () => {
    const cfg = enabledConfig({
      tools: {
        ...getDefaultAutoApprovalConfig().tools,
        write_file: 'always_allow',
      },
      protectedPaths: ['*.env', 'secrets/**'],
    });
    expect(shouldAutoApprove(cfg, 'write_file', '.env')).toBe(false);
    expect(shouldAutoApprove(cfg, 'write_file', 'secrets/key.json')).toBe(false);
  });

  it('auto-approves terminal_command when matching allowedCommands', () => {
    const cfg = enabledConfig({
      tools: {
        ...getDefaultAutoApprovalConfig().tools,
        terminal_command: 'always_allow',
      },
      allowedCommands: ['npm test', 'npm run *'],
    });
    expect(shouldAutoApprove(cfg, 'terminal_command', undefined, undefined, 'npm test')).toBe(true);
    expect(shouldAutoApprove(cfg, 'terminal_command', undefined, undefined, 'npm run build')).toBe(true);
  });

  it('denies terminal_command when no allowedCommands match', () => {
    const cfg = enabledConfig({
      tools: {
        ...getDefaultAutoApprovalConfig().tools,
        terminal_command: 'always_allow',
      },
      allowedCommands: ['npm test'],
    });
    expect(shouldAutoApprove(cfg, 'terminal_command', undefined, undefined, 'rm -rf /')).toBe(false);
  });

  it('returns false when file size exceeds maxAutoApproveFileSize', () => {
    const cfg = enabledConfig({
      tools: {
        ...getDefaultAutoApprovalConfig().tools,
        write_file: 'always_allow',
      },
      maxAutoApproveFileSize: 500,
    });
    expect(shouldAutoApprove(cfg, 'write_file', 'big.ts', 1000)).toBe(false);
    // Under the limit should succeed
    expect(shouldAutoApprove(cfg, 'write_file', 'small.ts', 100)).toBe(true);
  });
});
