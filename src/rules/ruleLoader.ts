import * as vscode from 'vscode';
import type { Rule, RuleCondition } from './ruleTypes.js';

export class RuleLoader {
  private rules: Rule[] = [];
  private watcher: vscode.FileSystemWatcher | null = null;

  /**
   * Load all rules from .tokamak/rules/ directory.
   * Each .md file is parsed for YAML frontmatter + markdown body.
   */
  async loadRules(): Promise<Rule[]> {
    this.rules = [];

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return this.rules;
    }

    const rulesDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.tokamak', 'rules');

    try {
      const entries = await vscode.workspace.fs.readDirectory(rulesDir);
      const mdFiles = entries.filter(
        ([name, type]) => name.endsWith('.md') && type === vscode.FileType.File
      );

      for (const [name] of mdFiles) {
        const fileUri = vscode.Uri.joinPath(rulesDir, name);
        try {
          const raw = await vscode.workspace.fs.readFile(fileUri);
          const content = Buffer.from(raw).toString('utf-8');
          const rule = RuleLoader.parseRuleFile(content, fileUri.fsPath);
          if (rule) {
            this.rules.push(rule);
          }
        } catch {
          // Skip files that can't be read
        }
      }

      // Sort by priority descending
      this.rules.sort((a, b) => b.priority - a.priority);
    } catch {
      // .tokamak/rules/ directory doesn't exist — no rules to load
    }

    return this.rules;
  }

  /**
   * Start watching .tokamak/rules/ for changes.
   */
  startWatching(onChange: () => void): void {
    this.dispose();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    const pattern = new vscode.RelativePattern(
      workspaceFolders[0],
      '.tokamak/rules/*.md'
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const reload = async () => {
      await this.loadRules();
      onChange();
    };

    this.watcher.onDidCreate(reload);
    this.watcher.onDidChange(reload);
    this.watcher.onDidDelete(reload);
  }

  /**
   * Get cached rules.
   */
  getRules(): Rule[] {
    return this.rules;
  }

  /**
   * Parse a single rule file content.
   * Exported for testing.
   */
  static parseRuleFile(content: string, filePath: string): Rule | null {
    const trimmed = content.trim();

    // Must start with --- to have frontmatter
    if (!trimmed.startsWith('---')) {
      // No frontmatter: treat entire content as rule body with defaults
      const id = deriveIdFromPath(filePath);
      return {
        id,
        description: id,
        condition: {},
        priority: 0,
        content: trimmed,
        source: filePath,
      };
    }

    // Find the closing --- delimiter
    const secondDash = trimmed.indexOf('---', 3);
    if (secondDash === -1) {
      // Malformed frontmatter
      return null;
    }

    const frontmatterRaw = trimmed.substring(3, secondDash).trim();
    const body = trimmed.substring(secondDash + 3).trim();

    const frontmatter = parseSimpleYaml(frontmatterRaw);

    const id = deriveIdFromPath(filePath);
    const description = typeof frontmatter['description'] === 'string'
      ? frontmatter['description']
      : id;
    const priority = typeof frontmatter['priority'] === 'number'
      ? frontmatter['priority']
      : 0;

    const condition: RuleCondition = {};
    const rawCondition = frontmatter['condition'];

    if (rawCondition && typeof rawCondition === 'object' && !Array.isArray(rawCondition)) {
      const condObj = rawCondition as Record<string, unknown>;
      if (Array.isArray(condObj['languages'])) {
        condition.languages = condObj['languages'].map(String);
      }
      if (Array.isArray(condObj['modes'])) {
        condition.modes = condObj['modes'].map(String);
      }
      if (Array.isArray(condObj['filePatterns'])) {
        condition.filePatterns = condObj['filePatterns'].map(String);
      }
    }

    // Also support top-level languages/modes/filePatterns for convenience
    if (!condition.languages && Array.isArray(frontmatter['languages'])) {
      condition.languages = (frontmatter['languages'] as unknown[]).map(String);
    }
    if (!condition.modes && Array.isArray(frontmatter['modes'])) {
      condition.modes = (frontmatter['modes'] as unknown[]).map(String);
    }
    if (!condition.filePatterns && Array.isArray(frontmatter['filePatterns'])) {
      condition.filePatterns = (frontmatter['filePatterns'] as unknown[]).map(String);
    }

    return {
      id,
      description,
      condition,
      priority,
      content: body,
      source: filePath,
    };
  }

  dispose(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = null;
    }
  }
}

/**
 * Derive a rule ID from the file path.
 * e.g., "/path/to/.tokamak/rules/typescript-conventions.md" -> "typescript-conventions"
 */
function deriveIdFromPath(filePath: string): string {
  const segments = filePath.replace(/\\/g, '/').split('/');
  const filename = segments[segments.length - 1] || 'unknown';
  return filename.replace(/\.md$/i, '');
}

/**
 * Simple YAML-subset parser for frontmatter.
 * Handles:
 *   key: value              (strings)
 *   key: 10                 (numbers)
 *   key: [a, b, c]          (inline arrays)
 *   key:                    (block arrays or nested objects)
 *     - item1
 *     - item2
 *   key:                    (nested object)
 *     subkey: value
 *     subkey2: [a, b]
 */
function parseSimpleYaml(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trimEnd();

    // Skip empty lines and comments
    if (stripped === '' || stripped.trimStart().startsWith('#')) {
      i++;
      continue;
    }

    // Determine indentation level of this line
    const indent = line.length - line.trimStart().length;

    // Only process top-level keys (indent === 0)
    if (indent > 0) {
      i++;
      continue;
    }

    const colonIdx = stripped.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = stripped.substring(0, colonIdx).trim();
    const valueRaw = stripped.substring(colonIdx + 1).trim();

    if (valueRaw === '') {
      // Could be a block array or nested object — peek at subsequent indented lines
      const nested = collectIndentedBlock(lines, i + 1);
      i = nested.nextIndex;

      if (nested.lines.length === 0) {
        result[key] = '';
        continue;
      }

      // Check if it's a block array (lines start with "- ")
      const firstTrimmed = nested.lines[0].trimStart();
      if (firstTrimmed.startsWith('- ')) {
        result[key] = nested.lines
          .map(l => l.trimStart())
          .filter(l => l.startsWith('- '))
          .map(l => parseScalar(l.substring(2).trim()));
      } else {
        // Nested object
        const nestedContent = nested.lines
          .map(l => {
            // Remove the base indentation
            const baseIndent = nested.lines[0].length - nested.lines[0].trimStart().length;
            return l.length > baseIndent ? l.substring(baseIndent) : l.trimStart();
          })
          .join('\n');
        result[key] = parseSimpleYaml(nestedContent);
      }
    } else if (valueRaw.startsWith('[') && valueRaw.endsWith(']')) {
      // Inline array: [item1, item2, item3]
      const inner = valueRaw.substring(1, valueRaw.length - 1).trim();
      if (inner === '') {
        result[key] = [];
      } else {
        result[key] = inner.split(',').map(s => parseScalar(s.trim()));
      }
    } else {
      // Scalar value
      result[key] = parseScalar(valueRaw);
    }

    i++;
  }

  return result;
}

/**
 * Collect consecutive indented lines starting from startIndex.
 */
function collectIndentedBlock(lines: string[], startIndex: number): { lines: string[]; nextIndex: number } {
  const collected: string[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line within a block — include it
    if (line.trim() === '') {
      // Check if the next non-empty line is still indented
      let nextNonEmpty = i + 1;
      while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') {
        nextNonEmpty++;
      }
      if (nextNonEmpty < lines.length) {
        const nextIndent = lines[nextNonEmpty].length - lines[nextNonEmpty].trimStart().length;
        if (nextIndent > 0) {
          collected.push(line);
          i++;
          continue;
        }
      }
      break;
    }

    const indent = line.length - line.trimStart().length;
    if (indent > 0) {
      collected.push(line);
      i++;
    } else {
      break;
    }
  }

  return { lines: collected, nextIndex: i };
}

/**
 * Parse a scalar value from YAML.
 * Handles numbers, booleans, quoted strings, and bare strings.
 */
function parseScalar(value: string): string | number | boolean {
  // Quoted strings
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.substring(1, value.length - 1);
  }

  // Booleans
  if (value === 'true') { return true; }
  if (value === 'false') { return false; }

  // Numbers
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}
