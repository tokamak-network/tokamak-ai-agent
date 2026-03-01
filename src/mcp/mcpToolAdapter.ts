import type { McpTool, McpToolResult } from './mcpTypes.js';

const MCP_CALL_START = '<<<MCP_TOOL_CALL>>>';
const MCP_CALL_END = '<<<END_MCP_CALL>>>';

/**
 * Format MCP tools as a description section for system prompts.
 */
export function formatToolsForPrompt(tools: McpTool[]): string {
  if (tools.length === 0) {
    return '';
  }

  let output = '## Available External Tools (MCP)\n\n';

  for (const tool of tools) {
    output += `### ${tool.name}\n`;
    output += `${tool.description}\n`;
    output += `Parameters: ${JSON.stringify(tool.inputSchema, null, 2)}\n\n`;
  }

  output +=
    'To use an MCP tool, output the following pattern:\n' +
    `${MCP_CALL_START}\n` +
    'TOOL: tool_name\n' +
    'ARGS: { "param": "value" }\n' +
    `${MCP_CALL_END}\n\n`;

  return output;
}

/**
 * Parse AI response for MCP tool call pattern.
 * Pattern: <<<MCP_TOOL_CALL>>>\nTOOL: tool_name\nARGS: { json }\n<<<END_MCP_CALL>>>
 */
export function parseMcpToolCalls(
  response: string
): Array<{ toolName: string; args: Record<string, any> }> {
  const results: Array<{ toolName: string; args: Record<string, any> }> = [];

  const pattern = new RegExp(
    `${escapeRegExp(MCP_CALL_START)}\\s*\\nTOOL:\\s*(.+?)\\s*\\nARGS:\\s*(.+?)\\s*\\n${escapeRegExp(MCP_CALL_END)}`,
    'gs'
  );

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(response)) !== null) {
    const toolName = match[1].trim();
    const argsRaw = match[2].trim();

    try {
      const args = JSON.parse(argsRaw);
      if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
        results.push({ toolName, args });
      }
    } catch {
      // Skip malformed ARGS — not valid JSON
    }
  }

  return results;
}

/**
 * Format tool result for injecting back into conversation.
 */
export function formatToolResult(
  toolName: string,
  result: McpToolResult
): string {
  const status = result.isError ? 'ERROR' : 'SUCCESS';
  return (
    `[MCP Tool Result: ${toolName}] (${status})\n` +
    `${result.content}`
  );
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
