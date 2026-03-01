/**
 * Context-window auto-compression.
 *
 * When a conversation grows close to the model's context-window limit this
 * module summarises the oldest messages, keeping the system prompt and the
 * most recent exchanges intact.  The summarisation itself is performed by a
 * caller-supplied function (`summarizeFn`) so that this module stays free of
 * VS Code and network dependencies and can be unit-tested in isolation.
 */

import {
    estimateTokenCount,
    estimateMessageTokens,
    estimateTotalTokens,
} from '../utils/tokenEstimator.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Tuning knobs for the compression algorithm. */
export interface CompressionConfig {
    /** Trigger compression when token usage reaches this fraction of the
     *  context window.  Default `0.75` (75 %). */
    compressionThreshold: number;

    /** Number of most-recent messages to preserve verbatim.  Default `6`. */
    preserveRecentCount: number;

    /** Minimum total messages (excluding system) before compression is
     *  considered.  Default `10`. */
    minMessagesForCompression: number;

    /** Target upper-bound for the summary that replaces the old messages.
     *  Default `1000` tokens. */
    maxSummaryTokens: number;
}

/** Value returned by {@link compressMessages}. */
export interface CompressionResult {
    /** The new message array after compression. */
    messages: Array<{ role: string; content: string | any[] }>;

    /** Number of messages in the original array. */
    originalCount: number;

    /** Number of messages in the compressed array. */
    compressedCount: number;

    /** Estimated tokens saved by the compression. */
    estimatedTokensSaved: number;

    /** Whether a summary message was inserted. */
    summaryInserted: boolean;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CompressionConfig = {
    compressionThreshold: 0.75,
    preserveRecentCount: 6,
    minMessagesForCompression: 10,
    maxSummaryTokens: 1000,
};

/** Return a fresh copy of the default compression config. */
export function getDefaultCompressionConfig(): CompressionConfig {
    return { ...DEFAULT_CONFIG };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mergeConfig(partial?: Partial<CompressionConfig>): CompressionConfig {
    return { ...DEFAULT_CONFIG, ...partial };
}

/**
 * Render the text content of a message for inclusion in a summary prompt.
 * Array-style content is flattened to its text parts only.
 */
function messageToText(message: { role: string; content: string | any[] }): string {
    if (typeof message.content === 'string') {
        return message.content;
    }
    if (Array.isArray(message.content)) {
        return message.content
            .filter((p: any) => p && typeof p === 'object' && typeof p.text === 'string')
            .map((p: any) => p.text as string)
            .join('\n');
    }
    return '';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Determine whether the current message list should be compressed.
 *
 * Returns `true` when **all** of the following hold:
 * 1. There are enough conversation messages (>= `minMessagesForCompression`).
 * 2. Estimated token usage exceeds `compressionThreshold` * `contextWindowSize`.
 */
export function needsCompression(
    messages: Array<{ role: string; content: string | any[] }>,
    contextWindowSize: number,
    config?: Partial<CompressionConfig>,
): boolean {
    const cfg = mergeConfig(config);

    // Conversation messages = everything after the system message at index 0.
    const conversationCount = messages.length > 0 ? messages.length - 1 : 0;
    if (conversationCount < cfg.minMessagesForCompression) {
        return false;
    }

    const totalTokens = estimateTotalTokens(messages);
    return totalTokens >= contextWindowSize * cfg.compressionThreshold;
}

/**
 * Build a prompt that asks the LLM to summarise a batch of older messages.
 *
 * The returned string is intended to be passed directly to `summarizeFn`.
 */
export function buildSummaryPrompt(
    messagesToSummarize: Array<{ role: string; content: string | any[] }>,
    maxSummaryTokens: number,
): string {
    const lines: string[] = [];

    for (const msg of messagesToSummarize) {
        const text = messageToText(msg);
        if (text) {
            lines.push(`[${msg.role}]: ${text}`);
        }
    }

    const conversation = lines.join('\n\n');

    return [
        'You are a conversation summariser. Condense the following conversation into a concise summary.',
        `Keep the summary under ${maxSummaryTokens} tokens.`,
        'Focus on:',
        '- Key decisions and conclusions',
        '- Important code changes, file paths, and technical details',
        '- Unresolved questions or pending tasks',
        'Do NOT include greetings, filler, or redundant context.',
        '',
        '--- CONVERSATION ---',
        conversation,
        '--- END CONVERSATION ---',
        '',
        'Provide ONLY the summary, no preamble.',
    ].join('\n');
}

/**
 * Compress a message list by summarising older messages with the help of an
 * LLM.
 *
 * High-level algorithm:
 * 1. Separate the system message (index 0) from the rest.
 * 2. Preserve the last `preserveRecentCount` conversation messages.
 * 3. Summarise the middle messages via `summarizeFn`.
 * 4. Return `[systemMessage, summaryMessage, ...recentMessages]`.
 *
 * If compression is not needed (too few messages, or already within budget)
 * the original messages are returned unchanged.
 *
 * @param messages         Full message array (system + conversation).
 * @param contextWindowSize Model's context-window size in tokens.
 * @param summarizeFn      Dependency-injected function that sends a prompt to
 *                         the LLM and returns the summary text.
 * @param config           Optional overrides for {@link CompressionConfig}.
 */
export async function compressMessages(
    messages: Array<{ role: string; content: string | any[] }>,
    contextWindowSize: number,
    summarizeFn: (prompt: string) => Promise<string>,
    config?: Partial<CompressionConfig>,
): Promise<CompressionResult> {
    const cfg = mergeConfig(config);

    // ── Guard: nothing to do ────────────────────────────────────────────────
    if (!needsCompression(messages, contextWindowSize, cfg)) {
        return {
            messages,
            originalCount: messages.length,
            compressedCount: messages.length,
            estimatedTokensSaved: 0,
            summaryInserted: false,
        };
    }

    // ── Separate system message from conversation ───────────────────────────
    const systemMessage = messages[0];
    const conversationMessages = messages.slice(1);

    // How many recent messages to keep verbatim.
    const preserveCount = Math.min(cfg.preserveRecentCount, conversationMessages.length);
    const recentMessages = conversationMessages.slice(conversationMessages.length - preserveCount);
    const oldMessages = conversationMessages.slice(0, conversationMessages.length - preserveCount);

    // If there are no old messages to summarise, bail out.
    if (oldMessages.length === 0) {
        return {
            messages,
            originalCount: messages.length,
            compressedCount: messages.length,
            estimatedTokensSaved: 0,
            summaryInserted: false,
        };
    }

    // ── Summarise old messages ──────────────────────────────────────────────
    const tokensBefore = estimateTotalTokens(messages);

    const summaryPrompt = buildSummaryPrompt(oldMessages, cfg.maxSummaryTokens);
    const summaryText = await summarizeFn(summaryPrompt);

    const summaryMessage: { role: string; content: string } = {
        role: 'system',
        content: `[Conversation Summary]\n${summaryText}`,
    };

    const compressedMessages = [systemMessage, summaryMessage, ...recentMessages];
    const tokensAfter = estimateTotalTokens(compressedMessages);

    return {
        messages: compressedMessages,
        originalCount: messages.length,
        compressedCount: compressedMessages.length,
        estimatedTokensSaved: Math.max(0, tokensBefore - tokensAfter),
        summaryInserted: true,
    };
}
