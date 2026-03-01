export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'PreApproval' | 'PostApproval'
  | 'PreMessage' | 'PostMessage';

export interface HookConfig {
  event: HookEvent;
  command: string;       // shell command to execute
  timeout: number;       // ms, default 30000
  blocking: boolean;     // if true, non-zero exit blocks the operation
  toolFilter?: string[]; // only trigger for these tool types
  enabled: boolean;
}

export interface HookInput {
  event: HookEvent;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  filePath?: string;
  message?: string;
  timestamp: number;
}

export interface HookResult {
  hookCommand: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  blocked: boolean;    // true if blocking hook returned non-zero
}

export interface HooksConfig {
  hooks: HookConfig[];
}
