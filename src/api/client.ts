import { getSettings } from '../config/settings.js';
import { getRegistry } from './providers/ProviderRegistry.js';
import type { ChatMessage as _ChatMessage, StreamResult as _StreamResult } from './types.js';

// ─── Re-export shared types (backward-compatible) ─────────────────────────────

export type { ChatMessage, TokenUsage, StreamResult } from './types.js';
export { getClient, resetClient } from './providers/BaseProvider.js';

// ─── Public API (thin facade) ─────────────────────────────────────────────────

export function isVisionCapable(model: string): boolean {
    return getRegistry().resolve(model).getCapabilities(model).vision;
}

export function streamChatCompletion(
    messages: _ChatMessage[],
    abortSignal?: AbortSignal,
    overrideModel?: string,
): _StreamResult {
    const model = overrideModel || getSettings().selectedModel;
    return getRegistry().resolve(model).streamChat(model, messages, { abortSignal });
}

export async function chatCompletion(messages: _ChatMessage[]): Promise<string> {
    const model = getSettings().selectedModel;
    return getRegistry().resolve(model).chat(model, messages);
}

export async function codeCompletion(prefix: string, suffix: string, language: string): Promise<string> {
    const model = getSettings().selectedModel;
    return getRegistry().resolve(model).codeComplete(model, prefix, suffix, language);
}
