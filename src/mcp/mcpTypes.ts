export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  serverName: string;
}

export interface McpToolResult {
  content: string;
  isError: boolean;
  metadata?: Record<string, any>;
}

export interface McpConfig {
  servers: McpServerConfig[];
}
