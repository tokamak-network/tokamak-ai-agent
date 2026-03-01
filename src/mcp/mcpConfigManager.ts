import * as vscode from 'vscode';
import type { McpConfig, McpServerConfig } from './mcpTypes.js';

const CONFIG_DIR = '.tokamak';
const CONFIG_FILE = 'mcp.json';
const CONFIG_PATH = `${CONFIG_DIR}/${CONFIG_FILE}`;

const EXAMPLE_CONFIG: McpConfig = {
  servers: [
    {
      name: 'example-server',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@example/mcp-server'],
      env: {},
      enabled: false,
    },
  ],
};

export class McpConfigManager {
  private config: McpConfig = { servers: [] };
  private watcher: vscode.FileSystemWatcher | null = null;
  private onConfigChanged: (() => void) | null = null;

  /**
   * Load config from .tokamak/mcp.json in workspace root.
   */
  async loadConfig(): Promise<McpConfig> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.config = { servers: [] };
      return this.config;
    }

    const configUri = vscode.Uri.joinPath(workspaceFolder.uri, CONFIG_PATH);

    try {
      const fileData = await vscode.workspace.fs.readFile(configUri);
      const text = Buffer.from(fileData).toString('utf-8');
      const parsed = JSON.parse(text);

      if (parsed && Array.isArray(parsed.servers)) {
        this.config = {
          servers: parsed.servers.filter(
            (s: any) =>
              typeof s.name === 'string' &&
              typeof s.transport === 'string' &&
              ['stdio', 'sse', 'http'].includes(s.transport)
          ),
        };
      } else {
        this.config = { servers: [] };
      }
    } catch {
      // File doesn't exist or is invalid — return empty config
      this.config = { servers: [] };
    }

    return this.config;
  }

  /**
   * Start watching .tokamak/mcp.json for changes.
   */
  startWatching(onChange: () => void): void {
    this.onConfigChanged = onChange;

    // Watch for changes to mcp.json inside .tokamak directories
    const pattern = new vscode.RelativePattern(
      vscode.workspace.workspaceFolders?.[0] ?? '',
      `${CONFIG_PATH}`
    );
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const handleChange = async () => {
      await this.loadConfig();
      this.onConfigChanged?.();
    };

    this.watcher.onDidChange(handleChange);
    this.watcher.onDidCreate(handleChange);
    this.watcher.onDidDelete(async () => {
      this.config = { servers: [] };
      this.onConfigChanged?.();
    });
  }

  /**
   * Get all enabled server configs.
   */
  getEnabledServers(): McpServerConfig[] {
    return this.config.servers.filter((s) => s.enabled);
  }

  /**
   * Get a specific server config by name.
   */
  getServer(name: string): McpServerConfig | undefined {
    return this.config.servers.find((s) => s.name === name);
  }

  /**
   * Create default mcp.json with example config.
   */
  async createDefaultConfig(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        'No workspace folder open. Cannot create MCP config.'
      );
      return;
    }

    const dirUri = vscode.Uri.joinPath(workspaceFolder.uri, CONFIG_DIR);
    try {
      await vscode.workspace.fs.stat(dirUri);
    } catch {
      await vscode.workspace.fs.createDirectory(dirUri);
    }

    const configUri = vscode.Uri.joinPath(workspaceFolder.uri, CONFIG_PATH);
    const content = JSON.stringify(EXAMPLE_CONFIG, null, 2) + '\n';
    await vscode.workspace.fs.writeFile(
      configUri,
      Buffer.from(content, 'utf-8')
    );

    vscode.window.showInformationMessage(
      `Created ${CONFIG_PATH} with example configuration.`
    );
  }

  /**
   * Stop watching and clean up.
   */
  dispose(): void {
    this.watcher?.dispose();
    this.watcher = null;
    this.onConfigChanged = null;
  }
}
