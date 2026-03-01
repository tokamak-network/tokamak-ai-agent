/**
 * Auto-approval system for tool operations.
 *
 * Pure module — no VS Code or Node-specific imports.
 * All functions are deterministic and side-effect-free.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolCategory =
  | 'read_file'
  | 'write_file'
  | 'create_file'
  | 'delete_file'
  | 'terminal_command'
  | 'search';

export type ApprovalLevel = 'always_allow' | 'ask' | 'deny';

export interface AutoApprovalConfig {
  enabled: boolean;
  tools: Record<ToolCategory, ApprovalLevel>;
  /** Glob patterns — files matching these are auto-allowed. */
  allowedPaths: string[];
  /** Glob patterns — files matching these always require confirmation. */
  protectedPaths: string[];
  /** Auto-approve is denied when the file size (bytes) exceeds this value. */
  maxAutoApproveFileSize: number;
  /** Command patterns that may be auto-approved (supports `*` wildcard). */
  allowedCommands: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function getDefaultAutoApprovalConfig(): AutoApprovalConfig {
  return {
    enabled: false,
    tools: {
      read_file: 'always_allow',
      write_file: 'ask',
      create_file: 'ask',
      delete_file: 'ask',
      terminal_command: 'ask',
      search: 'always_allow',
    },
    allowedPaths: [],
    protectedPaths: [],
    maxAutoApproveFileSize: 1_048_576, // 1 MiB
    allowedCommands: [],
  };
}

// ---------------------------------------------------------------------------
// Operation classification
// ---------------------------------------------------------------------------

/**
 * Map a raw operation type string (from {@link FileOperation} or agent
 * action) to its corresponding {@link ToolCategory}.
 *
 * Recognised `opType` values:
 * - FileOperation types: create, edit, delete, read, write_full, replace,
 *   prepend, append
 * - Agent action types: write, read, run, search, delete, multi_write
 */
export function classifyOperation(opType: string): ToolCategory {
  switch (opType) {
    // --- FileOperation types ---
    case 'read':
      return 'read_file';
    case 'create':
      return 'create_file';
    case 'delete':
      return 'delete_file';
    case 'edit':
    case 'write_full':
    case 'replace':
    case 'prepend':
    case 'append':
      return 'write_file';

    // --- Agent action types ---
    case 'write':
    case 'multi_write':
      return 'write_file';
    case 'run':
      return 'terminal_command';
    case 'search':
      return 'search';

    default:
      // Treat unknown operations as writes (safest default — requires
      // confirmation).
      return 'write_file';
  }
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

/**
 * Simple glob matcher that supports:
 * - `*`  — matches any sequence of characters *except* path separators
 * - `**` — matches any sequence of characters *including* path separators
 * - `?`  — matches exactly one character (not a path separator)
 *
 * The match is performed against the entire string (anchored).
 */
export function matchGlobPattern(pattern: string, path: string): boolean {
  const regexStr = globToRegex(pattern);
  const re = new RegExp(`^${regexStr}$`);
  return re.test(path);
}

/**
 * Convert a glob pattern to a regex source string (unanchored).
 */
function globToRegex(pattern: string): string {
  let i = 0;
  let result = '';

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**` — match everything including separators
        // Skip optional trailing slash after `**`
        i += 2;
        if (pattern[i] === '/') {
          i += 1;
        }
        result += '.*';
      } else {
        // `*` — match everything except `/`
        i += 1;
        result += '[^/]*';
      }
    } else if (ch === '?') {
      result += '[^/]';
      i += 1;
    } else {
      // Escape regex-special characters.
      result += escapeRegexChar(ch);
      i += 1;
    }
  }

  return result;
}

function escapeRegexChar(ch: string): string {
  if ('.+^${}()|[]\\'.includes(ch)) {
    return `\\${ch}`;
  }
  return ch;
}

// ---------------------------------------------------------------------------
// Command pattern matching
// ---------------------------------------------------------------------------

/**
 * Match a command string against a pattern that supports `*` as a wildcard
 * for any sequence of characters.
 *
 * Examples:
 *   matchCommandPattern("npm test", "npm test")       → true
 *   matchCommandPattern("npm run *", "npm run build")  → true
 *   matchCommandPattern("npm run *", "npm test")       → false
 */
export function matchCommandPattern(pattern: string, command: string): boolean {
  // Build a regex from the pattern — `*` matches any character sequence.
  const parts = pattern.split('*');
  const regexStr = parts.map(escapeRegexString).join('.*');
  const re = new RegExp(`^${regexStr}$`);
  return re.test(command);
}

function escapeRegexString(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Main decision function
// ---------------------------------------------------------------------------

/**
 * Determine whether an operation should be auto-approved without user
 * confirmation.
 *
 * Decision chain:
 * 1. If auto-approval is globally disabled → `false`.
 * 2. If the tool category is set to `'deny'` or `'ask'` → `false`.
 * 3. If `filePath` matches any `protectedPaths` glob → `false`.
 * 4. If `filePath` matches any `allowedPaths` glob → `true`.
 * 5. If `fileSize` exceeds `maxAutoApproveFileSize` → `false`.
 * 6. For `terminal_command`: the command must match at least one entry in
 *    `allowedCommands` → `false` if unmatched.
 * 7. Otherwise → `true`.
 */
export function shouldAutoApprove(
  config: AutoApprovalConfig,
  category: ToolCategory,
  filePath?: string,
  fileSize?: number,
  command?: string,
): boolean {
  // 1. Global kill-switch.
  if (!config.enabled) {
    return false;
  }

  // 2. Per-tool approval level.
  const level = config.tools[category];
  if (level === 'deny' || level === 'ask') {
    return false;
  }

  // 3. Protected paths take precedence — always require confirmation.
  if (filePath && config.protectedPaths.length > 0) {
    for (const pattern of config.protectedPaths) {
      if (matchGlobPattern(pattern, filePath)) {
        return false;
      }
    }
  }

  // 4. Allowed paths — auto-approve if matched.
  if (filePath && config.allowedPaths.length > 0) {
    let pathAllowed = false;
    for (const pattern of config.allowedPaths) {
      if (matchGlobPattern(pattern, filePath)) {
        pathAllowed = true;
        break;
      }
    }
    if (pathAllowed) {
      return true;
    }
  }

  // 5. File size guard.
  if (fileSize !== undefined && fileSize > config.maxAutoApproveFileSize) {
    return false;
  }

  // 6. Terminal command allow-list.
  if (category === 'terminal_command') {
    if (!command) {
      return false;
    }
    if (config.allowedCommands.length === 0) {
      return false;
    }
    let commandAllowed = false;
    for (const pattern of config.allowedCommands) {
      if (matchCommandPattern(pattern, command)) {
        commandAllowed = true;
        break;
      }
    }
    if (!commandAllowed) {
      return false;
    }
  }

  // 7. All checks passed.
  return true;
}
