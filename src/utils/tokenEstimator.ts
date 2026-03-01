/**
 * Token estimation utilities.
 *
 * Provides fast, heuristic-based token counting without requiring a full
 * tokenizer dependency.  The estimates are intentionally conservative so
 * that compression triggers a little early rather than too late.
 *
 * Pure functions only -- no VS Code or Node-specific imports.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Average tokens-per-character for plain ASCII / Latin text. */
const ASCII_TOKENS_PER_CHAR = 0.25;

/** Average tokens-per-character for CJK / non-ASCII text. */
const NON_ASCII_TOKENS_PER_CHAR = 1.5;

/**
 * Overhead tokens per message to account for role tags, separators, and other
 * framing that the model's tokenizer adds around each message.
 */
const MESSAGE_OVERHEAD_TOKENS = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return `true` when a character is outside the basic ASCII range (0x00-0x7F).
 * This is a rough proxy for CJK / emoji / accented characters that typically
 * consume more tokens.
 */
function isNonAscii(charCode: number): boolean {
    return charCode > 0x7f;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Estimate the token count for a plain string.
 *
 * The heuristic walks the string once and classifies each character as either
 * ASCII (~0.25 tokens/char) or non-ASCII (~1.5 tokens/char).  The result is
 * rounded up so the caller always gets a safe upper-bound integer.
 */
export function estimateTokenCount(text: string): number {
    if (!text) {
        return 0;
    }

    let asciiCount = 0;
    let nonAsciiCount = 0;

    for (let i = 0; i < text.length; i++) {
        if (isNonAscii(text.charCodeAt(i))) {
            nonAsciiCount++;
        } else {
            asciiCount++;
        }
    }

    return Math.ceil(
        asciiCount * ASCII_TOKENS_PER_CHAR +
        nonAsciiCount * NON_ASCII_TOKENS_PER_CHAR,
    );
}

/**
 * Estimate the token count for a single {@link ChatMessage}.
 *
 * Handles both plain-string content and the OpenAI-style array content format
 * (e.g. `[{ type: "text", text: "..." }, { type: "image_url", ... }]`).
 * Non-text parts (images, etc.) are counted with a small fixed overhead.
 */
export function estimateMessageTokens(
    message: { role: string; content: string | any[] },
): number {
    let contentTokens: number;

    if (typeof message.content === 'string') {
        contentTokens = estimateTokenCount(message.content);
    } else if (Array.isArray(message.content)) {
        contentTokens = 0;
        for (const part of message.content) {
            if (part && typeof part === 'object' && typeof part.text === 'string') {
                contentTokens += estimateTokenCount(part.text);
            } else {
                // Non-text parts (image_url, etc.) -- use a small fixed estimate.
                contentTokens += 85;
            }
        }
    } else {
        contentTokens = 0;
    }

    // Add overhead for role tag / message framing.
    return contentTokens + MESSAGE_OVERHEAD_TOKENS;
}

/**
 * Estimate the total token count across an array of messages.
 */
export function estimateTotalTokens(
    messages: Array<{ role: string; content: string | any[] }>,
): number {
    let total = 0;
    for (const msg of messages) {
        total += estimateMessageTokens(msg);
    }
    return total;
}
