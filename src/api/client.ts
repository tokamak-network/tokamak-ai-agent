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
    content: string;
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

export async function* streamChatCompletion(
    messages: ChatMessage[],
    abortSignal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
    const client = getClient();
    const settings = getSettings();

    const stream = await client.chat.completions.create({
        model: settings.selectedModel,
        messages: messages,
        stream: true,
    }, {
        signal: abortSignal,
    });

    let lastChunk = '';
    for await (const chunk of stream) {
        if (abortSignal?.aborted) {
            break;
        }
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
            // Skip duplicate consecutive chunks (fixes double output issue)
            if (content === lastChunk) {
                continue;
            }
            lastChunk = content;
            yield content;
        }
    }
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