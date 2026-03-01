import type { McpServerConfig, McpTool, McpToolResult } from './mcpTypes.js';

// Module paths as variables to prevent TypeScript from statically resolving them
const SDK_CLIENT_MODULE = '@modelcontextprotocol/sdk/client/index.js';
const SDK_STDIO_MODULE = '@modelcontextprotocol/sdk/client/stdio.js';
const SDK_SSE_MODULE = '@modelcontextprotocol/sdk/client/sse.js';

export class McpClient {
  private serverConfig: McpServerConfig;
  private client: any = null;
  private transport: any = null;
  private connected: boolean = false;
  private tools: McpTool[] = [];

  constructor(config: McpServerConfig) {
    this.serverConfig = config;
  }

  /**
   * Connect to the MCP server.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    let sdkClient: any;
    let sdkStdio: any;
    let sdkSse: any;

    try {
      sdkClient = await import(SDK_CLIENT_MODULE);
    } catch {
      throw new Error(
        'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk'
      );
    }

    const { Client } = sdkClient;

    this.client = new Client(
      { name: 'tokamak-agent', version: '1.0.0' },
      { capabilities: {} }
    );

    if (this.serverConfig.transport === 'stdio') {
      if (!this.serverConfig.command) {
        throw new Error(
          `MCP server "${this.serverConfig.name}" has transport "stdio" but no command specified.`
        );
      }

      try {
        sdkStdio = await import(SDK_STDIO_MODULE);
      } catch {
        throw new Error(
          'MCP SDK stdio transport not available. Run: npm install @modelcontextprotocol/sdk'
        );
      }

      const { StdioClientTransport } = sdkStdio;

      this.transport = new StdioClientTransport({
        command: this.serverConfig.command,
        args: this.serverConfig.args ?? [],
        env: {
          ...process.env,
          ...(this.serverConfig.env ?? {}),
        } as Record<string, string>,
      });
    } else if (
      this.serverConfig.transport === 'sse' ||
      this.serverConfig.transport === 'http'
    ) {
      if (!this.serverConfig.url) {
        throw new Error(
          `MCP server "${this.serverConfig.name}" has transport "${this.serverConfig.transport}" but no url specified.`
        );
      }

      try {
        sdkSse = await import(SDK_SSE_MODULE);
      } catch {
        throw new Error(
          'MCP SDK SSE transport not available. Run: npm install @modelcontextprotocol/sdk'
        );
      }

      const { SSEClientTransport } = sdkSse;

      this.transport = new SSEClientTransport(
        new URL(this.serverConfig.url)
      );
    } else {
      throw new Error(
        `Unsupported transport type: ${this.serverConfig.transport}`
      );
    }

    await this.client.connect(this.transport);
    this.connected = true;

    // Cache available tools on connect
    await this.refreshTools();
  }

  /**
   * Refresh the cached tool list from the server.
   */
  private async refreshTools(): Promise<void> {
    if (!this.client || !this.connected) {
      return;
    }

    try {
      const response = await this.client.listTools();
      this.tools = (response.tools ?? []).map((tool: any) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? {},
        serverName: this.serverConfig.name,
      }));
    } catch (err) {
      console.error(
        `Failed to list tools from MCP server "${this.serverConfig.name}":`,
        err
      );
      this.tools = [];
    }
  }

  /**
   * List available tools from this server.
   */
  async listTools(): Promise<McpTool[]> {
    if (this.tools.length === 0 && this.connected) {
      await this.refreshTools();
    }
    return [...this.tools];
  }

  /**
   * Call a tool with arguments.
   */
  async callTool(
    toolName: string,
    args: Record<string, any>
  ): Promise<McpToolResult> {
    if (!this.client || !this.connected) {
      return {
        content: `MCP server "${this.serverConfig.name}" is not connected.`,
        isError: true,
      };
    }

    const tool = this.tools.find((t) => t.name === toolName);
    if (!tool) {
      return {
        content: `Tool "${toolName}" not found on MCP server "${this.serverConfig.name}".`,
        isError: true,
      };
    }

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: args,
      });

      // Parse result content — the SDK returns content as an array of content blocks
      let content = '';
      if (Array.isArray(result.content)) {
        content = result.content
          .map((block: any) => {
            if (typeof block === 'string') {
              return block;
            }
            if (block.type === 'text') {
              return block.text ?? '';
            }
            return JSON.stringify(block);
          })
          .join('\n');
      } else if (typeof result.content === 'string') {
        content = result.content;
      } else {
        content = JSON.stringify(result.content);
      }

      return {
        content,
        isError: result.isError ?? false,
        metadata: {
          serverName: this.serverConfig.name,
          toolName,
        },
      };
    } catch (err: any) {
      return {
        content: `Error calling tool "${toolName}": ${err?.message ?? String(err)}`,
        isError: true,
        metadata: {
          serverName: this.serverConfig.name,
          toolName,
        },
      };
    }
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect and clean up.
   */
  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      try {
        await this.client.close();
      } catch {
        // Ignore errors during disconnect
      }
    }

    if (this.transport) {
      try {
        if (typeof this.transport.close === 'function') {
          await this.transport.close();
        }
      } catch {
        // Ignore errors during transport cleanup
      }
    }

    this.client = null;
    this.transport = null;
    this.connected = false;
    this.tools = [];
  }
}
