import * as vscode from 'vscode';
import type { DiagnosticInfo } from './observer.js';

export interface DiagnosticSnapshot {
  timestamp: number;
  diagnostics: DiagnosticInfo[];
  fingerprints: Set<string>;
}

export interface DiagnosticDiff {
  introduced: DiagnosticInfo[];   // new errors after edit
  resolved: DiagnosticInfo[];     // errors fixed after edit
  netChange: number;              // introduced.length - resolved.length
}

/**
 * Create a fingerprint for a diagnostic (pure function).
 * Uses file:message:code (no line number since edits shift lines).
 */
export function createDiagnosticFingerprint(diag: DiagnosticInfo): string {
  return `${diag.file}:${diag.message}:${diag.code ?? ''}`;
}

export class DiagnosticDiffTracker {
  private lastSnapshot: DiagnosticSnapshot | null = null;

  /**
   * Capture current diagnostic state as a snapshot.
   * Collects from vscode.languages.getDiagnostics(), errors and warnings only.
   */
  async captureSnapshot(): Promise<DiagnosticSnapshot> {
    const allDiagnostics = vscode.languages.getDiagnostics();
    const diagnostics: DiagnosticInfo[] = [];
    const fingerprints = new Set<string>();

    for (const [uri, fileDiagnostics] of allDiagnostics) {
      for (const diag of fileDiagnostics) {
        // Filter to Error and Warning only
        if (
          diag.severity !== vscode.DiagnosticSeverity.Error &&
          diag.severity !== vscode.DiagnosticSeverity.Warning
        ) {
          continue;
        }

        let codeValue = diag.code;
        if (codeValue && typeof codeValue === 'object') {
          codeValue = codeValue.value;
        }

        const info: DiagnosticInfo = {
          file: vscode.workspace.asRelativePath(uri),
          line: diag.range.start.line + 1,
          message: diag.message,
          severity:
            diag.severity === vscode.DiagnosticSeverity.Error
              ? 'Error'
              : 'Warning',
          code: codeValue as string | number,
        };

        diagnostics.push(info);
        fingerprints.add(createDiagnosticFingerprint(info));
      }
    }

    const snapshot: DiagnosticSnapshot = {
      timestamp: Date.now(),
      diagnostics,
      fingerprints,
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  /**
   * Compare two snapshots, finding introduced and resolved diagnostics.
   */
  diff(before: DiagnosticSnapshot, after: DiagnosticSnapshot): DiagnosticDiff {
    const introduced = after.diagnostics.filter(
      (d) => !before.fingerprints.has(createDiagnosticFingerprint(d))
    );

    const resolved = before.diagnostics.filter(
      (d) => !after.fingerprints.has(createDiagnosticFingerprint(d))
    );

    return {
      introduced,
      resolved,
      netChange: introduced.length - resolved.length,
    };
  }

  /**
   * Capture snapshot and diff against the last one.
   * Convenience method combining captureSnapshot() + diff().
   * Returns null on the first call (no previous snapshot to compare against).
   */
  async diffFromLast(): Promise<DiagnosticDiff | null> {
    if (!this.lastSnapshot) {
      await this.captureSnapshot();
      return null;
    }

    const before = this.lastSnapshot;
    const after = await this.captureSnapshot();
    return this.diff(before, after);
  }

  /**
   * Determine if auto-fix should be attempted based on diff.
   * Skip if too many new errors (>10) — likely a build issue, not a targeted fix.
   */
  shouldAutoFix(diff: DiagnosticDiff): boolean {
    return diff.introduced.length > 0 && diff.introduced.length <= 10;
  }

  /**
   * Format diff for AI prompt with structured error information.
   */
  formatDiffForPrompt(diff: DiagnosticDiff): string {
    const sections: string[] = [];

    if (diff.introduced.length > 0) {
      const header = `## New Errors Introduced (${diff.introduced.length})`;
      const items = diff.introduced.map(
        (d, i) =>
          `${i + 1}. [${d.severity}] ${d.file} - ${d.message}${d.code ? ` (${d.code})` : ''}`
      );
      sections.push([header, ...items].join('\n'));
    }

    if (diff.resolved.length > 0) {
      const header = `## Errors Resolved (${diff.resolved.length})`;
      const items = diff.resolved.map(
        (d, i) =>
          `${i + 1}. [${d.severity}] ${d.file} - ${d.message}${d.code ? ` (${d.code})` : ''}`
      );
      sections.push([header, ...items].join('\n'));
    }

    if (sections.length === 0) {
      return '## No Diagnostic Changes';
    }

    return sections.join('\n\n');
  }

  /**
   * Reset tracker state.
   */
  reset(): void {
    this.lastSnapshot = null;
  }
}
