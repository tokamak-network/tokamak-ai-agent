import { describe, it, expect } from 'vitest';
import { estimateTokenCount, estimateMessageTokens, estimateTotalTokens } from '../utils/tokenEstimator.js';
import { needsCompression, buildSummaryPrompt, compressMessages, getDefaultCompressionConfig } from '../context/contextCompressor.js';

// ---------------------------------------------------------------------------
// estimateTokenCount
// ---------------------------------------------------------------------------

describe('estimateTokenCount', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('estimates tokens for ASCII text', () => {
    const text = 'Hello world, this is a test.';
    const count = estimateTokenCount(text);
    expect(count).toBeGreaterThan(0);
    // ASCII at ~0.25 tokens/char → 27 chars → ~7 tokens (ceil)
    expect(count).toBe(Math.ceil(text.length * 0.25));
  });

  it('produces a higher count for CJK text', () => {
    const ascii = 'hello';
    const cjk = '\u4f60\u597d\u4e16\u754c\u5440'; // 5 CJK characters
    // CJK chars should produce a higher per-character estimate
    expect(estimateTokenCount(cjk)).toBeGreaterThan(estimateTokenCount(ascii));
  });
});

// ---------------------------------------------------------------------------
// estimateMessageTokens
// ---------------------------------------------------------------------------

describe('estimateMessageTokens', () => {
  it('estimates tokens for a message with string content (includes overhead)', () => {
    const msg = { role: 'user', content: 'Hello' };
    const tokens = estimateMessageTokens(msg);
    // estimateTokenCount('Hello') + 4 overhead
    expect(tokens).toBe(estimateTokenCount('Hello') + 4);
  });

  it('estimates tokens for a message with array content containing text parts', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: 'Part one' },
        { type: 'text', text: 'Part two' },
      ],
    };
    const tokens = estimateMessageTokens(msg);
    const expectedContent = estimateTokenCount('Part one') + estimateTokenCount('Part two');
    expect(tokens).toBe(expectedContent + 4);
  });
});

// ---------------------------------------------------------------------------
// needsCompression
// ---------------------------------------------------------------------------

describe('needsCompression', () => {
  /** Build a message array with n conversation messages (plus 1 system). */
  function buildMessages(n: number, contentPerMsg = 'x'.repeat(100)): Array<{ role: string; content: string }> {
    const msgs: Array<{ role: string; content: string }> = [
      { role: 'system', content: 'You are a helpful assistant.' },
    ];
    for (let i = 0; i < n; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: contentPerMsg });
    }
    return msgs;
  }

  it('returns false when there are too few messages', () => {
    // Default minMessagesForCompression = 10; we only have 3 conversation msgs
    const msgs = buildMessages(3);
    expect(needsCompression(msgs, 100_000)).toBe(false);
  });

  it('returns false when token usage is under the threshold', () => {
    // 12 messages but very small content, huge context window
    const msgs = buildMessages(12, 'hi');
    expect(needsCompression(msgs, 1_000_000)).toBe(false);
  });

  it('returns true when token usage exceeds the threshold', () => {
    // 15 conversation messages with large content, small context window
    const msgs = buildMessages(15, 'x'.repeat(2000));
    const totalTokens = estimateTotalTokens(msgs);
    // Set context window so that 75% is below total tokens
    const contextWindow = Math.floor(totalTokens / 0.75) - 1;
    expect(needsCompression(msgs, contextWindow)).toBe(true);
  });

  it('respects custom minMessagesForCompression override', () => {
    const msgs = buildMessages(5, 'x'.repeat(2000));
    const totalTokens = estimateTotalTokens(msgs);
    const smallWindow = Math.floor(totalTokens / 0.75) - 1;
    // With default minMessagesForCompression=10, 5 conversation msgs → false
    expect(needsCompression(msgs, smallWindow)).toBe(false);
    // With custom minMessagesForCompression=3 → true
    expect(needsCompression(msgs, smallWindow, { minMessagesForCompression: 3 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSummaryPrompt
// ---------------------------------------------------------------------------

describe('buildSummaryPrompt', () => {
  it('includes the content of the provided messages', () => {
    const messages = [
      { role: 'user', content: 'Please refactor the login module.' },
      { role: 'assistant', content: 'Sure, I will extract the auth logic.' },
    ];
    const prompt = buildSummaryPrompt(messages, 1000);
    expect(prompt).toContain('[user]: Please refactor the login module.');
    expect(prompt).toContain('[assistant]: Sure, I will extract the auth logic.');
  });

  it('includes the maxSummaryTokens value in the prompt instructions', () => {
    const prompt = buildSummaryPrompt(
      [{ role: 'user', content: 'hello' }],
      500,
    );
    expect(prompt).toContain('500');
    expect(prompt).toContain('tokens');
  });
});

// ---------------------------------------------------------------------------
// compressMessages
// ---------------------------------------------------------------------------

describe('compressMessages', () => {
  const mockSummarizeFn = async (_prompt: string): Promise<string> =>
    'Summary of conversation';

  /** Build a message array with n conversation messages (plus 1 system). */
  function buildMessages(n: number, contentPerMsg = 'x'.repeat(100)): Array<{ role: string; content: string }> {
    const msgs: Array<{ role: string; content: string }> = [
      { role: 'system', content: 'You are a helpful assistant.' },
    ];
    for (let i = 0; i < n; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: contentPerMsg });
    }
    return msgs;
  }

  it('returns original messages unchanged when compression is not needed', async () => {
    const msgs = buildMessages(3, 'short');
    const result = await compressMessages(msgs, 1_000_000, mockSummarizeFn);
    expect(result.summaryInserted).toBe(false);
    expect(result.messages).toBe(msgs); // same reference
    expect(result.originalCount).toBe(msgs.length);
    expect(result.compressedCount).toBe(msgs.length);
    expect(result.estimatedTokensSaved).toBe(0);
  });

  it('compresses messages and inserts a summary when threshold is exceeded', async () => {
    const msgs = buildMessages(15, 'x'.repeat(2000));
    const totalTokens = estimateTotalTokens(msgs);
    const tightWindow = Math.floor(totalTokens / 0.75) - 1;

    const result = await compressMessages(msgs, tightWindow, mockSummarizeFn);
    expect(result.summaryInserted).toBe(true);
    expect(result.compressedCount).toBeLessThan(result.originalCount);
    expect(result.estimatedTokensSaved).toBeGreaterThan(0);
    // Summary message should contain our mock text
    expect(result.messages.some((m) => typeof m.content === 'string' && m.content.includes('Summary of conversation'))).toBe(true);
  });

  it('preserves the system message as the first message', async () => {
    const msgs = buildMessages(15, 'x'.repeat(2000));
    const totalTokens = estimateTotalTokens(msgs);
    const tightWindow = Math.floor(totalTokens / 0.75) - 1;

    const result = await compressMessages(msgs, tightWindow, mockSummarizeFn);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('You are a helpful assistant.');
  });

  it('preserves the most recent messages verbatim', async () => {
    const msgs = buildMessages(15, 'x'.repeat(2000));
    const totalTokens = estimateTotalTokens(msgs);
    const tightWindow = Math.floor(totalTokens / 0.75) - 1;

    const result = await compressMessages(msgs, tightWindow, mockSummarizeFn, {
      preserveRecentCount: 4,
    });
    // The last 4 conversation messages from the original should appear at the end
    const originalLast4 = msgs.slice(-4);
    const compressedLast4 = result.messages.slice(-4);
    expect(compressedLast4).toEqual(originalLast4);
  });
});
