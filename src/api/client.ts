import OpenAI from 'openai';
import { getSettings } from '../config/settings.js';
import { logger } from '../utils/logger.js';

// ─── Client Instance ──────────────────────────────────────────────────────────

let clientInstance: OpenAI | null = null;

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

export function resetClient(): void {
    clientInstance = null;
    lastApiKey = '';
    lastBaseUrl = '';
}

// ─── Model Capability Detection ───────────────────────────────────────────────

/**
 * 모델 이름에 따라 vision(이미지 첨부) 지원 여부를 판별합니다.
 * 알 수 없는 모델은 기본적으로 미지원으로 처리합니다.
 *
 * 지원 모델:
 *  - GPT-4o, GPT-4 Turbo (OpenAI)
 *  - Claude 3+ (Anthropic)
 *  - Qwen-VL 시리즈
 *  - GLM-4V 시리즈 (V가 붙은 것만 — glm-4.7은 미지원)
 */
export function isVisionCapable(model: string): boolean {
    const m = model.toLowerCase();
    return (
        // OpenAI vision models
        m.startsWith('gpt-4o') ||
        m === 'gpt-4-turbo' ||
        m === 'gpt-4-turbo-preview' ||
        m.startsWith('gpt-4-vision') ||
        // Anthropic Claude 3+
        /^claude-3/.test(m) ||
        /^claude-3\.5/.test(m) ||
        // Qwen VL (vision language)
        /qwen.*vl/i.test(m) ||
        // GLM-4V only (4V 붙은 것만 vision — glm-4.7은 텍스트 전용)
        /glm-4v/i.test(m) ||
        // Generic vision/visual suffix
        /\bvision\b|\bvisual\b|\bvl\b/.test(m)
    );
}

/**
 * stream_options.include_usage 를 지원하는 모델인지 판별합니다.
 * OpenAI 공식 모델만 지원합니다. 비-OpenAI 엔드포인트에서 이 옵션을 보내면
 * 400 Bad Request 오류가 발생하는 경우가 많습니다.
 */
function supportsStreamOptions(model: string): boolean {
    const m = model.toLowerCase();
    return m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3');
}

// ─── Message Preprocessing ────────────────────────────────────────────────────

/**
 * vision을 지원하지 않는 모델에 메시지를 보낼 때, image_url 파트를 제거합니다.
 * 이미지가 제거된 경우 "[N개 이미지 첨부됨 — 이 모델은 vision을 지원하지 않습니다]"
 * 라는 안내 텍스트를 추가합니다.
 */
function stripImagesForNonVisionModel(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(msg => {
        if (!Array.isArray(msg.content)) return msg;

        const imageParts = msg.content.filter((p: any) => p.type === 'image_url');
        if (imageParts.length === 0) return msg;

        const textParts = msg.content.filter((p: any) => p.type === 'text');
        const textContent = textParts.map((p: any) => p.text ?? '').join('\n').trim();
        const notice = `[${imageParts.length}개의 이미지가 첨부되었지만 현재 모델(${getSettings().selectedModel})은 vision을 지원하지 않습니다. 이미지는 전송되지 않았습니다.]`;

        return { ...msg, content: textContent ? `${textContent}\n\n${notice}` : notice };
    });
}

// ─── Retry Logic ──────────────────────────────────────────────────────────────

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES  = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']);

/**
 * 일시적 오류(Rate Limit, 서버 오류 등)에 대해 최대 maxRetries회 재시도합니다.
 * AbortError는 재시도하지 않습니다.
 */
async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // AbortError는 재시도하지 않음 (사용자가 취소한 것)
            if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
                throw error;
            }

            const status = error?.status ?? error?.response?.status;
            const code   = error?.code;
            const isRetryable =
                RETRYABLE_STATUS_CODES.has(status) ||
                RETRYABLE_ERROR_CODES.has(code);

            if (!isRetryable || attempt === maxRetries - 1) throw error;

            const waitMs = Math.pow(2, attempt) * 1000; // 1s → 2s → 4s
            logger.warn('[Client]', `Request failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${waitMs}ms — ${error?.message ?? status}`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }

    throw lastError;
}

// ─── Public Types ─────────────────────────────────────────────────────────────

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

// ─── API Functions ────────────────────────────────────────────────────────────

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
    const client   = getClient();
    const settings = getSettings();

    const processedMessages = isVisionCapable(settings.selectedModel)
        ? messages
        : stripImagesForNonVisionModel(messages);

    const response = await withRetry(() =>
        client.chat.completions.create({
            model: settings.selectedModel,
            messages: processedMessages as any,
        })
    );

    return response.choices[0]?.message?.content || '';
}

export function streamChatCompletion(
    messages: ChatMessage[],
    abortSignal?: AbortSignal,
    overrideModel?: string
): StreamResult {
    const client   = getClient();
    const settings = getSettings();
    const model = overrideModel || settings.selectedModel;

    // Vision 미지원 모델이면 image_url 파트를 텍스트 안내로 대체
    const processedMessages = isVisionCapable(model)
        ? messages
        : stripImagesForNonVisionModel(messages);

    let usageResolver: ((value: TokenUsage | null) => void) | null = null;
    const usagePromise = new Promise<TokenUsage | null>((resolve) => {
        usageResolver = resolve;
    });

    const contentGenerator = async function* () {
        // stream_options는 OpenAI 공식 모델만 지원
        const extraOptions = supportsStreamOptions(model)
            ? { stream_options: { include_usage: true } }
            : {};

        // withRetry: 연결 오류나 5xx에 재시도 (429 Rate Limit 포함)
        const stream = await withRetry(() =>
            client.chat.completions.create(
                {
                    model: model,
                    messages: processedMessages as any,
                    stream: true,
                    ...extraOptions,
                },
                { signal: abortSignal }
            )
        );

        let usage: TokenUsage | null = null;
        const toolCallsAccum: { index: number; id?: string; name?: string; args: string }[] = [];

        for await (const chunk of stream) {
            if (abortSignal?.aborted) {
                break;
            }

            // usage 정보 수집 (stream_options 지원 모델의 마지막 청크)
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

            // tool_calls 수집 (minimax 등에서 content 대신 tool_calls로 내려주는 경우)
            const tc = delta?.tool_calls;
            if (tc?.length) {
                for (const t of tc) {
                    const idx = t.index ?? toolCallsAccum.length;
                    if (!toolCallsAccum[idx]) {
                        toolCallsAccum[idx] = { index: idx, id: t.id, name: t.function?.name, args: '' };
                    }
                    if (t.function?.arguments) {
                        toolCallsAccum[idx].args += t.function.arguments;
                    }
                }
            }
        }

        // 수집된 tool_calls를 XML 형태로 yield (Cline 스타일)
        if (toolCallsAccum.length > 0) {
            for (const t of toolCallsAccum) {
                const name = t.name;
                if (!name || !['edit', 'write_to_file', 'replace_in_file', 'prepend', 'append'].includes(name)) continue;
                try {
                    const parsed = JSON.parse(t.args) as Record<string, string>;
                    const path = parsed.path ?? '';
                    if (!path) continue;

                    const xmlLines = [`<invoke name="${name}">`];
                    for (const [key, value] of Object.entries(parsed)) {
                        xmlLines.push(`<parameter name="${key}">${value}</parameter>`);
                    }
                    xmlLines.push('</invoke>');

                    yield '\n' + xmlLines.join('\n');
                } catch {
                    // arguments가 JSON이 아니면 무시
                }
            }
        }

        if (usageResolver) {
            usageResolver(usage);
        }
    };

    return {
        content: contentGenerator(),
        usage: usagePromise,
    };
}

export async function codeCompletion(prefix: string, suffix: string, language: string): Promise<string> {
    const client   = getClient();
    const settings = getSettings();

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
            model: settings.selectedModel,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150,
            temperature: 0.2,
        })
    );

    return response.choices[0]?.message?.content?.trim() || '';
}
