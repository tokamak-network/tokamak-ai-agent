import { spawn } from 'child_process';
import type { HookConfig, HookInput, HookResult } from './hookTypes.js';

export class HookRunner {
  /**
   * Run all hooks for a given event.
   * Hooks are executed sequentially (order matters for blocking hooks).
   * Returns combined results and whether the operation is allowed to proceed.
   */
  async runHooks(
    hooks: HookConfig[],
    input: HookInput,
  ): Promise<{ allowed: boolean; results: HookResult[] }> {
    const results: HookResult[] = [];
    let allowed = true;

    for (const hook of hooks) {
      const result = await this.runSingleHook(hook, input);
      results.push(result);

      if (result.blocked) {
        allowed = false;
        // Stop executing further hooks once a blocking hook rejects
        break;
      }
    }

    return { allowed, results };
  }

  /**
   * Run a single hook command.
   * Spawns a child process with shell: true, pipes JSON input to stdin,
   * collects stdout/stderr, and enforces a timeout.
   */
  private async runSingleHook(
    hook: HookConfig,
    input: HookInput,
  ): Promise<HookResult> {
    const startTime = Date.now();

    return new Promise<HookResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      let settled = false;

      const settle = (exitCode: number) => {
        if (settled) { return; }
        settled = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        const duration = Date.now() - startTime;
        const blocked = hook.blocking && exitCode !== 0;

        resolve({
          hookCommand: hook.command,
          exitCode,
          stdout,
          stderr,
          duration,
          blocked,
        });
      };

      let child;
      try {
        child = spawn(hook.command, {
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        settle(1);
        stderr = `Failed to spawn hook process: ${message}`;
        return;
      }

      // Set up timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        try {
          child.kill('SIGKILL');
        } catch {
          // Process may have already exited
        }
      }, hook.timeout);

      // Collect stdout
      if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
      }

      // Collect stderr
      if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      // Write JSON input to stdin
      if (child.stdin) {
        const inputJson = JSON.stringify(input);
        child.stdin.write(inputJson, () => {
          child.stdin!.end();
        });
        child.stdin.on('error', () => {
          // stdin may error if process exits before we finish writing
        });
      }

      child.on('close', (code: number | null) => {
        if (killed) {
          stderr += '\nHook timed out and was killed.';
          settle(124); // 124 is the conventional exit code for timeout
        } else {
          settle(code ?? 1);
        }
      });

      child.on('error', (err: Error) => {
        stderr += `\nProcess error: ${err.message}`;
        settle(1);
      });
    });
  }
}
