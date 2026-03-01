/**
 * F10: Streaming Diff Display
 *
 * Incremental parser for FILE_OPERATION blocks during streaming.
 * Handles chunks that may split across markers (e.g., "<<<FILE_OP" in one
 * chunk and "ERATION>>>" in the next).
 *
 * Pure module — no vscode imports.
 */

export interface PartialOperation {
    state: 'detecting' | 'type' | 'path' | 'description' | 'content' | 'complete';
    type?: string;
    path?: string;
    description?: string;
    contentSoFar: string;
    isComplete: boolean;
}

export interface FeedResult {
    /** Non-null when a file operation is being parsed */
    operation: PartialOperation | null;
    /** Text content outside of file operations (pass-through to UI) */
    textContent: string;
}

const START_MARKER = '<<<FILE_OPERATION>>>';
const END_MARKER = '<<<END_OPERATION>>>';

// Maximum prefix of a marker we need to retain in the buffer to handle
// cross-chunk splits.  Length of the longer marker minus one.
const MARKER_HOLD_BACK = Math.max(START_MARKER.length, END_MARKER.length) - 1;

export class StreamingDiffParser {
    private buffer: string = '';
    private currentOp: PartialOperation | null = null;
    private insideOperation: boolean = false;

    /**
     * Feed a streaming chunk into the parser.
     * Returns text content to display and any partial operation being parsed.
     */
    feed(chunk: string): FeedResult {
        this.buffer += chunk;

        if (!this.insideOperation) {
            return this.parseOutsideOperation();
        }
        return this.parseInsideOperation();
    }

    /**
     * Reset parser state for a new stream.
     */
    reset(): void {
        this.buffer = '';
        this.currentOp = null;
        this.insideOperation = false;
    }

    /**
     * Get current partial operation if any.
     */
    getCurrentOperation(): PartialOperation | null {
        return this.currentOp ? { ...this.currentOp } : null;
    }

    // ─── Private helpers ────────────────────────────────────────────────

    private parseOutsideOperation(): FeedResult {
        const markerIdx = this.buffer.indexOf(START_MARKER);

        if (markerIdx >= 0) {
            // Found the start marker — everything before it is plain text.
            const textContent = this.buffer.slice(0, markerIdx);
            this.buffer = this.buffer.slice(markerIdx + START_MARKER.length);
            this.insideOperation = true;
            this.currentOp = {
                state: 'detecting',
                contentSoFar: '',
                isComplete: false,
            };
            // Continue parsing the remainder that is now inside the operation.
            const inner = this.parseInsideOperation();
            return {
                textContent: textContent + inner.textContent,
                operation: inner.operation,
            };
        }

        // No marker found yet.  Flush the buffer except for a tail that could
        // contain a partially-received marker.
        if (this.buffer.length > MARKER_HOLD_BACK) {
            const safeLength = this.buffer.length - MARKER_HOLD_BACK;
            const textContent = this.buffer.slice(0, safeLength);
            this.buffer = this.buffer.slice(safeLength);
            return { textContent, operation: null };
        }

        // Buffer is short enough that we must wait for more data.
        return { textContent: '', operation: null };
    }

    private parseInsideOperation(): FeedResult {
        // Check for the end marker first.
        const endIdx = this.buffer.indexOf(END_MARKER);
        if (endIdx >= 0) {
            // Process whatever is left in the buffer before the end marker.
            const remaining = this.buffer.slice(0, endIdx);
            this.buffer = this.buffer.slice(endIdx + END_MARKER.length);
            this.consumeOperationLines(remaining);

            if (this.currentOp) {
                this.currentOp.state = 'complete';
                this.currentOp.isComplete = true;
                // Trim trailing code-fence from accumulated content.
                this.currentOp.contentSoFar = this.trimTrailingCodeFence(
                    this.currentOp.contentSoFar,
                );
            }

            const completedOp = this.currentOp;
            this.insideOperation = false;
            this.currentOp = null;

            return { textContent: '', operation: completedOp };
        }

        // No end marker yet — process available complete lines but hold back
        // enough to detect a split marker.
        if (this.buffer.length > MARKER_HOLD_BACK) {
            const safeLength = this.buffer.length - MARKER_HOLD_BACK;
            const safe = this.buffer.slice(0, safeLength);
            this.buffer = this.buffer.slice(safeLength);
            this.consumeOperationLines(safe);
        }

        return { textContent: '', operation: this.currentOp ? { ...this.currentOp } : null };
    }

    /**
     * Parse raw text inside a FILE_OPERATION block line-by-line and update
     * `this.currentOp` progressively.
     */
    private consumeOperationLines(text: string): void {
        if (!this.currentOp) {
            return;
        }

        const lines = text.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // Skip blank lines while still detecting metadata fields.
            if (
                trimmed === '' &&
                this.currentOp.state !== 'content'
            ) {
                continue;
            }

            // ── Metadata fields ─────────────────────────────────────────
            const typeMatch = trimmed.match(
                /^TYPE:\s*(create|edit|delete|read|write_full|replace|prepend|append)/i,
            );
            if (typeMatch) {
                this.currentOp.type = typeMatch[1].toLowerCase();
                this.currentOp.state = 'type';
                continue;
            }

            const pathMatch = trimmed.match(/^PATH:\s*[`'"]?([^`'"\n\r]+)[`'"]?/i);
            if (pathMatch && this.currentOp.state !== 'content') {
                this.currentOp.path = pathMatch[1].trim();
                this.currentOp.state = 'path';
                continue;
            }

            const descMatch = trimmed.match(/^DESCRIPTION:\s*(.*)/i);
            if (descMatch && this.currentOp.state !== 'content') {
                this.currentOp.description = descMatch[1].trim();
                this.currentOp.state = 'description';
                continue;
            }

            // ── Content boundary ────────────────────────────────────────
            if (/^CONTENT:\s*$/i.test(trimmed) || /^CONTENT:\s*```/i.test(trimmed)) {
                this.currentOp.state = 'content';
                // If the CONTENT: line also starts the code fence, skip past it.
                continue;
            }

            // Skip the opening code-fence line (e.g., ```typescript).
            if (
                this.currentOp.state === 'content' &&
                this.currentOp.contentSoFar === '' &&
                /^```/.test(trimmed)
            ) {
                continue;
            }

            // ── Accumulate content ──────────────────────────────────────
            if (this.currentOp.state === 'content') {
                if (this.currentOp.contentSoFar.length > 0) {
                    this.currentOp.contentSoFar += '\n';
                }
                this.currentOp.contentSoFar += line;
            }
        }
    }

    /**
     * Strip a trailing ``` (code-fence) from content, handling the common
     * pattern where the AI closes the fence on its own line.
     */
    private trimTrailingCodeFence(content: string): string {
        return content.replace(/\n*```+\s*$/, '').trimEnd();
    }
}
