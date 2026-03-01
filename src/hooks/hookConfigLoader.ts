import * as vscode from 'vscode';
import type { HooksConfig, HookConfig, HookEvent } from './hookTypes.js';

const HOOKS_FILE = '.tokamak/hooks.json';

const DEFAULT_HOOKS_CONFIG: HooksConfig = {
  hooks: [
    {
      event: 'PreToolUse',
      command: 'echo "Hook triggered"',
      timeout: 30000,
      blocking: false,
      enabled: false,
    },
  ],
};

export class HookConfigLoader {
  private config: HooksConfig = { hooks: [] };
  private watcher: vscode.FileSystemWatcher | null = null;

  /**
   * Load hooks configuration from .tokamak/hooks.json.
   */
  async loadConfig(): Promise<HooksConfig> {
    this.config = { hooks: [] };

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return this.config;
    }

    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, HOOKS_FILE);

    try {
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const content = Buffer.from(raw).toString('utf-8');
      const parsed = JSON.parse(content);

      if (parsed && Array.isArray(parsed.hooks)) {
        this.config.hooks = parsed.hooks
          .filter((h: unknown) => isValidHookConfig(h))
          .map((h: Partial<HookConfig>) => applyDefaults(h));
      }
    } catch {
      // File doesn't exist or is invalid — no hooks configured
    }

    return this.config;
  }

  /**
   * Start watching .tokamak/hooks.json for changes.
   */
  startWatching(onChange: () => void): void {
    this.dispose();

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    const pattern = new vscode.RelativePattern(
      workspaceFolders[0],
      HOOKS_FILE
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const reload = async () => {
      await this.loadConfig();
      onChange();
    };

    this.watcher.onDidCreate(reload);
    this.watcher.onDidChange(reload);
    this.watcher.onDidDelete(reload);
  }

  /**
   * Get hooks that match a given event.
   * Only returns enabled hooks. Applies toolFilter if present.
   */
  getHooksForEvent(event: string, toolName?: string): HookConfig[] {
    return this.config.hooks.filter(hook => {
      if (!hook.enabled) {
        return false;
      }
      if (hook.event !== event) {
        return false;
      }
      // If toolFilter is set, only match if toolName is in the filter list
      if (hook.toolFilter && hook.toolFilter.length > 0) {
        if (!toolName || !hook.toolFilter.includes(toolName)) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Create a default hooks.json configuration file in the workspace.
   */
  async createDefaultConfig(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, HOOKS_FILE);

    const content = JSON.stringify(DEFAULT_HOOKS_CONFIG, null, 2) + '\n';
    const encoded = Buffer.from(content, 'utf-8');

    await vscode.workspace.fs.writeFile(fileUri, encoded);
  }

  dispose(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = null;
    }
  }
}

/**
 * Validate that a value looks like a HookConfig.
 */
function isValidHookConfig(value: unknown): value is Partial<HookConfig> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  // event and command are required
  if (typeof obj['event'] !== 'string' || typeof obj['command'] !== 'string') {
    return false;
  }

  const validEvents: HookEvent[] = [
    'PreToolUse', 'PostToolUse', 'PreApproval', 'PostApproval',
    'PreMessage', 'PostMessage',
  ];

  if (!validEvents.includes(obj['event'] as HookEvent)) {
    return false;
  }

  return true;
}

/**
 * Apply default values for optional HookConfig fields.
 */
function applyDefaults(hook: Partial<HookConfig>): HookConfig {
  return {
    event: hook.event!,
    command: hook.command!,
    timeout: typeof hook.timeout === 'number' ? hook.timeout : 30000,
    blocking: typeof hook.blocking === 'boolean' ? hook.blocking : true,
    toolFilter: Array.isArray(hook.toolFilter) ? hook.toolFilter : undefined,
    enabled: typeof hook.enabled === 'boolean' ? hook.enabled : true,
  };
}
