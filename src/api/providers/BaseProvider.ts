import OpenAI from 'openai';
import { getSettings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';
import type { ChatMessage, TokenUsage, StreamResult, ProviderRequestOptions } from '../types.js';
import type { IProvider, ModelCapabilities, ModelDefaults } from './IProvider.js';

// ─── Client Instance ──────────────────────────────────────────────────────────

let clientInstance: OpenAI | null = null;
let lastApiKey = '';
let lastBaseUrl = '';

function needsRecreation(settings: { apiKey: string; baseUrl: string }): boolean {
    const needsNew = settings.apiKey !== lastApiKey || settings.baseUrl !== lastBaseUrl;
    if (needsNew) {
        lastApiKey = settings.apiKey;
        lastBaseUrl = settings.baseUrl;
    }
    return needsNew;
}

export function getClient(): OpenAI {
    const settings = getSettings();

    if (!clientInstance || needsRecreation(settings)) {
        clientInstance = new OpenAI({
            apiKey: settings.apiKey,
            baseURL: settings.baseUrl,
        });
    }

    return clientInstance;
}

export function resetClient(): void {
    clientInstance = null;
    lastApiKey = '';
    lastBaseUrl = '';
}

// ─── Retry Logic ──────────────────────────────────────────────────────────────

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES  = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']);

export async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
                throw error;
            }

            const status = error?.status ?? error?.response?.status;
            const code   = error?.code;
            const isRetryable =
                RETRYABLE_STATUS_CODES.has(status) ||
                RETRYABLE_ERROR_CODES.has(code);

            if (!isRetryable || attempt === maxRetries - 1) throw error;

            const waitMs = Math.pow(2, attempt) * 1000;
            logger.warn('[Client]', `Request failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${waitMs}ms — ${error?.message ?? status}`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }

    throw lastError;
}

// ─── BaseProvider ─────────────────────────────────────────────────────────────

export abstract class BaseProvider implements IProvider {
    abstract readonly id: string;
    abstract readonly name: string;
    abstract canHandle(model: string): boolean;
    abstract getCapabilities(model: string): ModelCapabilities;
    abstract getDefaults(model: string): ModelDefaults;

    preprocessMessages(model: string, messages: ChatMessage[]): ChatMessage[] {
        const caps = this.getCapabilities(model);
        if (caps.vision) {
            return messages;
        }
        return stripImagesForNonVisionModel(model, messages);
    }

    streamChat(model: string, messages: ChatMessage[], options?: ProviderRequestOptions): StreamResult {
        const client = getClient();
        const processedMessages = this.preprocessMessages(model, messages);
        const caps = this.getCapabilities(model);

        let usageResolver: ((value: TokenUsage | null) => void) | null = null;
        const usagePromise = new Promise<TokenUsage | null>((resolve) => {
            usageResolver = resolve;
        });

        const self = this;
        const contentGenerator = async function* () {
            const extraOptions = caps.streamUsage
                ? { stream_options: { include_usage: true } }
                : {};

            const stream = await withRetry(() =>
                client.chat.completions.create(
                    {
                        model: model,
                        messages: processedMessages as any,
                        stream: true,
                        ...extraOptions,
                    },
                    { signal: options?.abortSignal }
                )
            );

            yield* self.processStream(stream, options?.abortSignal, usageResolver);
        };

        return {
            content: contentGenerator(),
            usage: usagePromise,
        };
    }

    protected async *processStream(
        stream: AsyncIterable<any>,
        abortSignal?: AbortSignal,
        usageResolver?: ((value: TokenUsage | null) => void) | null,
    ): AsyncGenerator<string, void, unknown> {
        let usage: TokenUsage | null = null;

        for await (const chunk of stream) {
            if (abortSignal?.aborted) {
                break;
            }

            if (chunk.usage) {
                usage = {
                    promptTokens: chunk.usage.prompt_tokens || 0,
                    completionTokens: chunk.usage.completion_tokens || 0,
                    totalTokens: chunk.usage.total_tokens || 0,
                };
            }

            const delta   = chunk.choices[0]?.delta;
            const content = delta?.content;
            if (content) {
                yield content;
            }
        }

        if (usageResolver) {
            usageResolver(usage);
        }
    }

    async chat(model: string, messages: ChatMessage[], _options?: ProviderRequestOptions): Promise<string> {
        const client = getClient();
        const processedMessages = this.preprocessMessages(model, messages);

        const response = await withRetry(() =>
            client.chat.completions.create({
                model: model,
                messages: processedMessages as any,
            })
        );

        return response.choices[0]?.message?.content || '';
    }

    async codeComplete(model: string, prefix: string, suffix: string, language: string): Promise<string> {
        const client = getClient();

        const prompt = `You are a code completion assistant. Complete the code at the cursor position marked with <CURSOR>.
Only output the completion code, nothing else. Do not include any explanation or markdown formatting.

Language: ${language}

Code before cursor:
${prefix}<CURSOR>

Code after cursor:
${suffix}

Complete the code at <CURSOR>:`;

        const response = await withRetry(() =>
            client.chat.completions.create({
                model: model,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 150,
                temperature: 0.2,
            })
        );

        return response.choices[0]?.message?.content?.trim() || '';
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripImagesForNonVisionModel(model: string, messages: ChatMessage[]): ChatMessage[] {
    return messages.map(msg => {
        if (!Array.isArray(msg.content)) return msg;

        const imageParts = msg.content.filter((p: any) => p.type === 'image_url');
        if (imageParts.length === 0) return msg;

        const textParts = msg.content.filter((p: any) => p.type === 'text');
        const textContent = textParts.map((p: any) => p.text ?? '').join('\n').trim();
        const notice = `[${imageParts.length}개의 이미지가 첨부되었지만 현재 모델(${model})은 vision을 지원하지 않습니다. 이미지는 전송되지 않았습니다.]`;

        return { ...msg, content: textContent ? `${textContent}\n\n${notice}` : notice };
    });
}
