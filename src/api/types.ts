// ─── Shared API Types ────────────────────────────────────────────────────────

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | any[];
}

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface StreamResult {
    content: AsyncGenerator<string, void, unknown>;
    usage: Promise<TokenUsage | null>;
}

export interface ProviderRequestOptions {
    abortSignal?: AbortSignal;
    temperature?: number;
    maxTokens?: number;
}
