"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClient = getClient;
exports.resetClient = resetClient;
exports.chatCompletion = chatCompletion;
exports.streamChatCompletion = streamChatCompletion;
exports.codeCompletion = codeCompletion;
const openai_1 = __importDefault(require("openai"));
const settings_js_1 = require("../config/settings.js");
let clientInstance = null;
function getClient() {
    const settings = (0, settings_js_1.getSettings)();
    if (!clientInstance || needsRecreation(settings)) {
        clientInstance = new openai_1.default({
            apiKey: settings.apiKey,
            baseURL: settings.baseUrl,
        });
    }
    return clientInstance;
}
let lastApiKey = '';
let lastBaseUrl = '';
function needsRecreation(settings) {
    const needsNew = settings.apiKey !== lastApiKey || settings.baseUrl !== lastBaseUrl;
    if (needsNew) {
        lastApiKey = settings.apiKey;
        lastBaseUrl = settings.baseUrl;
    }
    return needsNew;
}
function resetClient() {
    clientInstance = null;
    lastApiKey = '';
    lastBaseUrl = '';
}
async function chatCompletion(messages) {
    const client = getClient();
    const settings = (0, settings_js_1.getSettings)();
    const response = await client.chat.completions.create({
        model: settings.selectedModel,
        messages: messages,
    });
    return response.choices[0]?.message?.content || '';
}
function streamChatCompletion(messages, abortSignal) {
    const client = getClient();
    const settings = (0, settings_js_1.getSettings)();
    let usageResolver = null;
    const usagePromise = new Promise((resolve) => {
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
        let usage = null;
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
async function codeCompletion(prefix, suffix, language) {
    const client = getClient();
    const settings = (0, settings_js_1.getSettings)();
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
//# sourceMappingURL=client.js.map