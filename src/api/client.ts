import OpenAI from 'openai';
import { getSettings } from '../config/settings.js';

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

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
    const client = getClient();
    const settings = getSettings();

    const response = await client.chat.completions.create({
        model: settings.selectedModel,
        messages: messages,
    });

    return response.choices[0]?.message?.content || '';
}

export function streamChatCompletion(
    messages: ChatMessage[],
    abortSignal?: AbortSignal
): StreamResult {
    const client = getClient();
    const settings = getSettings();

    let usageResolver: ((value: TokenUsage | null) => void) | null = null;
    const usagePromise = new Promise<TokenUsage | null>((resolve) => {
        usageResolver = resolve;
    });

    const contentGenerator = async function* () {
        const stream = await client.chat.completions.create({
            model: settings.selectedModel,
            messages: messages,
            stream: true,
            stream_options: { include_usage: true }, // Request usage info in stream
        }, {
            signal: abortSignal,
        });

        let lastChunk = '';
        let usage: TokenUsage | null = null;
        const toolCallsAccum: { index: number; id?: string; name?: string; args: string }[] = [];

        for await (const chunk of stream) {
            if (abortSignal?.aborted) {
                break;
            }

            // Extract usage info if available (usually in the last chunk)
            if (chunk.usage) {
                usage = {
                    promptTokens: chunk.usage.prompt_tokens || 0,
                    completionTokens: chunk.usage.completion_tokens || 0,
                    totalTokens: chunk.usage.total_tokens || 0,
                };
            }

            const delta = chunk.choices[0]?.delta;
            const content = delta?.content;
            if (content) {
                if (content === lastChunk) continue;
                lastChunk = content;
                yield content;
            }

            // 수집: tool_calls (minimax 등에서 content 대신 tool_calls로 내려주는 경우)
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

        // 스트림 종료 후 수집된 tool_calls가 있으면 XML 형태로 yield (Cline 스타일: write_to_file / replace_in_file / edit)
        if (toolCallsAccum.length > 0) {
            for (const t of toolCallsAccum) {
                const name = t.name;
                if (!name || !['edit', 'write_to_file', 'replace_in_file', 'prepend', 'append'].includes(name)) continue;
                try {
                    const parsed = JSON.parse(t.args) as Record<string, string>;
                    const path = parsed.path ?? '';
                    // path가 없는 호출은 무시 (단, LLM에 따라 경로를 다르게 전달할 수도 있지만, 현재는 path 필수)
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

        // Resolve usage promise when stream ends
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
    const client = getClient();
    const settings = getSettings();

    const prompt = `You are a code completion assistant. Complete the code at the cursor position marked with <CURSOR>.
Only output the completion code, nothing else. Do not include any explanation or markdown formatting.

Language: ${language}

Code before cursor:
${prefix}<CURSOR>

Code after cursor:
${suffix}

Complete the code at <CURSOR>:`;

    const response = await client.chat.completions.create({
        model: settings.selectedModel,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.2,
    });

    return response.choices[0]?.message?.content?.trim() || '';
}