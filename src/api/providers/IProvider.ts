import type { ChatMessage, StreamResult, ProviderRequestOptions } from '../types.js';

export interface ModelCapabilities {
    vision: boolean;           // 이미지 첨부 지원
    streamUsage: boolean;      // stream_options.include_usage 지원
    toolCallsToXml: boolean;   // tool_calls→XML 변환 필요 (minimax)
    thinkingBlocks: boolean;   // <think> 블록 방출 (qwen3, gemini)
    contextWindow: number;     // 최대 컨텍스트 토큰
}

export interface ModelDefaults {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
}

export interface IProvider {
    readonly id: string;
    readonly name: string;
    canHandle(model: string): boolean;
    getCapabilities(model: string): ModelCapabilities;
    getDefaults(model: string): ModelDefaults;
    streamChat(model: string, messages: ChatMessage[], options?: ProviderRequestOptions): StreamResult;
    chat(model: string, messages: ChatMessage[], options?: ProviderRequestOptions): Promise<string>;
    codeComplete(model: string, prefix: string, suffix: string, language: string): Promise<string>;
    preprocessMessages(model: string, messages: ChatMessage[]): ChatMessage[];
}
