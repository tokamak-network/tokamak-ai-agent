import * as vscode from 'vscode';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Structured logger backed by a VS Code Output Channel.
 * Replace console.log/warn/error with this for better diagnostics.
 *
 * Usage:
 *   import { logger } from '../utils/logger.js';
 *   logger.info('[AgentEngine]', 'Planning started');
 *   logger.error('[Executor]', 'Write failed', error);
 */
class Logger {
    private channel: vscode.OutputChannel | null = null;
    private minLevel: LogLevel = 'INFO';

    private readonly LEVELS: Record<LogLevel, number> = {
        DEBUG: 0,
        INFO:  1,
        WARN:  2,
        ERROR: 3,
    };

    /** Call once during extension activation: logger.init(context) */
    init(context: vscode.ExtensionContext): void {
        this.channel = vscode.window.createOutputChannel('Tokamak Agent');
        context.subscriptions.push(this.channel);
    }

    setMinLevel(level: LogLevel): void {
        this.minLevel = level;
    }

    debug(tag: string, message: string, data?: unknown): void {
        this.log('DEBUG', tag, message, data);
    }

    info(tag: string, message: string, data?: unknown): void {
        this.log('INFO', tag, message, data);
    }

    warn(tag: string, message: string, data?: unknown): void {
        this.log('WARN', tag, message, data);
    }

    error(tag: string, message: string, data?: unknown): void {
        this.log('ERROR', tag, message, data);
    }

    private log(level: LogLevel, tag: string, message: string, data?: unknown): void {
        if (this.LEVELS[level] < this.LEVELS[this.minLevel]) return;

        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 23);
        const dataStr = data !== undefined ? ' ' + this.formatData(data) : '';
        const line = `[${timestamp}] [${level}] ${tag} ${message}${dataStr}`;

        // Always write to output channel
        if (this.channel) {
            this.channel.appendLine(line);
        }

        // Mirror to console for development/debugging
        switch (level) {
            case 'DEBUG':
            case 'INFO':
                console.log(line);
                break;
            case 'WARN':
                console.warn(line);
                break;
            case 'ERROR':
                console.error(line);
                break;
        }
    }

    private formatData(data: unknown): string {
        if (data instanceof Error) {
            return data.message + (data.stack ? '\n' + data.stack : '');
        }
        if (typeof data === 'string') return data;
        try {
            return JSON.stringify(data);
        } catch {
            return String(data);
        }
    }
}

/** Singleton logger instance shared across the extension. */
export const logger = new Logger();
