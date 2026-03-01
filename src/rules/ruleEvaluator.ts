import type { Rule, RuleCondition } from './ruleTypes.js';

/**
 * Check if a condition matches the current context.
 */
export function matchesCondition(
  condition: RuleCondition,
  language: string,
  mode: string,
  filePath?: string,
): boolean {
  // If condition.languages exists, currentLanguage must be in it
  if (condition.languages && condition.languages.length > 0) {
    if (!condition.languages.includes(language)) {
      return false;
    }
  }

  // If condition.modes exists, currentMode must be in it
  if (condition.modes && condition.modes.length > 0) {
    if (!condition.modes.includes(mode)) {
      return false;
    }
  }

  // If condition.filePatterns exists, currentFilePath must match at least one glob
  if (condition.filePatterns && condition.filePatterns.length > 0) {
    if (!filePath) {
      return false;
    }
    const matched = condition.filePatterns.some(pattern => matchGlob(pattern, filePath));
    if (!matched) {
      return false;
    }
  }

  return true;
}

/**
 * Filter rules based on current context.
 */
export function getActiveRules(
  rules: Rule[],
  currentLanguage: string,
  currentMode: string,
  currentFilePath?: string,
): Rule[] {
  const active = rules.filter(rule =>
    matchesCondition(rule.condition, currentLanguage, currentMode, currentFilePath)
  );

  // Sort by priority descending
  return active.sort((a, b) => b.priority - a.priority);
}

/**
 * Format active rules into a prompt section.
 */
export function formatRulesForPrompt(rules: Rule[]): string {
  if (rules.length === 0) {
    return '';
  }

  // Sort by priority descending (in case caller didn't pre-sort)
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);

  let output = '## Project Rules\n\n';

  for (const rule of sorted) {
    output += `### ${rule.description}\n${rule.content}\n\n`;
  }

  return output;
}

/**
 * Simple glob matching for file patterns.
 * Supports:
 *   *       - matches any sequence of non-separator characters
 *   **      - matches any sequence of characters including separators
 *   ?       - matches a single non-separator character
 *   {a,b,c} - matches any of the alternatives (one level, no nesting)
 */
function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize separators to forward slashes
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Expand brace alternatives: {a,b,c} -> try each alternative
  const expanded = expandBraces(normalizedPattern);

  return expanded.some(p => {
    const regex = globToRegex(p);
    return regex.test(normalizedPath);
  });
}

/**
 * Expand brace alternatives in a glob pattern.
 * e.g., "*.{ts,tsx}" -> ["*.ts", "*.tsx"]
 */
function expandBraces(pattern: string): string[] {
  const braceStart = pattern.indexOf('{');
  if (braceStart === -1) {
    return [pattern];
  }

  const braceEnd = pattern.indexOf('}', braceStart);
  if (braceEnd === -1) {
    return [pattern];
  }

  const prefix = pattern.substring(0, braceStart);
  const suffix = pattern.substring(braceEnd + 1);
  const alternatives = pattern.substring(braceStart + 1, braceEnd).split(',');

  const results: string[] = [];
  for (const alt of alternatives) {
    // Recursively expand in case there are more braces in suffix
    const expanded = expandBraces(prefix + alt.trim() + suffix);
    results.push(...expanded);
  }

  return results;
}

/**
 * Convert a glob pattern (without braces) to a RegExp.
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = '^';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      if (i + 1 < pattern.length && pattern[i + 1] === '*') {
        // ** matches anything including /
        if (i + 2 < pattern.length && pattern[i + 2] === '/') {
          regexStr += '(?:.*/)?';
          i += 3;
        } else {
          regexStr += '.*';
          i += 2;
        }
      } else {
        // * matches anything except /
        regexStr += '[^/]*';
        i++;
      }
    } else if (char === '?') {
      regexStr += '[^/]';
      i++;
    } else if (char === '.') {
      regexStr += '\\.';
      i++;
    } else {
      regexStr += escapeRegex(char);
      i++;
    }
  }

  regexStr += '$';
  return new RegExp(regexStr);
}

/**
 * Escape a character for use in a regular expression.
 */
function escapeRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
