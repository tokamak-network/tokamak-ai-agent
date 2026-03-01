/**
 * F12: Browser Automation — Action Parsing & Formatting
 *
 * Parse and format browser actions from/for AI responses.
 * Pure module — no vscode imports.
 */

import type { BrowserAction, BrowserResult } from './browserTypes.js';

const VALID_ACTION_TYPES = new Set([
    'navigate', 'screenshot', 'click', 'type', 'evaluate', 'close',
]);

/**
 * Parse a browser action from an agent action payload.
 * Returns null if the payload is invalid or missing required fields.
 */
export function parseBrowserAction(payload: any): BrowserAction | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const { type } = payload;
    if (!type || !VALID_ACTION_TYPES.has(type)) {
        return null;
    }

    switch (type) {
        case 'navigate': {
            if (typeof payload.url !== 'string' || !payload.url.trim()) {
                return null;
            }
            return { type: 'navigate', url: payload.url.trim() };
        }

        case 'screenshot': {
            const action: BrowserAction = { type: 'screenshot' };
            if (typeof payload.selector === 'string' && payload.selector.trim()) {
                (action as Extract<BrowserAction, { type: 'screenshot' }>).selector =
                    payload.selector.trim();
            }
            return action;
        }

        case 'click': {
            if (typeof payload.selector !== 'string' || !payload.selector.trim()) {
                return null;
            }
            return { type: 'click', selector: payload.selector.trim() };
        }

        case 'type': {
            if (
                typeof payload.selector !== 'string' ||
                !payload.selector.trim() ||
                typeof payload.text !== 'string'
            ) {
                return null;
            }
            return {
                type: 'type',
                selector: payload.selector.trim(),
                text: payload.text,
            };
        }

        case 'evaluate': {
            if (typeof payload.script !== 'string' || !payload.script.trim()) {
                return null;
            }
            return { type: 'evaluate', script: payload.script.trim() };
        }

        case 'close': {
            return { type: 'close' };
        }

        default:
            return null;
    }
}

/**
 * Format a browser result as structured text for AI context.
 */
export function formatBrowserResult(result: BrowserResult): string {
    const lines: string[] = [];

    lines.push(`[Browser] action: ${result.action}`);

    if (result.url) {
        lines.push(`URL: ${result.url}`);
    }
    if (result.title) {
        lines.push(`Title: ${result.title}`);
    }

    lines.push(`Result: ${result.success ? 'success' : 'error'}`);

    if (result.error) {
        lines.push(`Error: ${result.error}`);
    }
    if (result.data) {
        // Truncate long data for prompt context (e.g., base64 screenshots).
        const maxDataLength = 500;
        if (result.data.length > maxDataLength) {
            lines.push(`Data: [${result.data.length} chars, truncated]`);
            lines.push(result.data.slice(0, maxDataLength) + '...');
        } else {
            lines.push(`Data: ${result.data}`);
        }
    }

    return lines.join('\n');
}

/**
 * Get browser action documentation for system prompt injection.
 * Describes the available actions and their JSON format for the AI model.
 */
export function getBrowserActionDocs(): string {
    return `## Browser Automation

You can control a headless browser to navigate web pages, take screenshots, click elements, type text, and run JavaScript.

### Available Actions

Send a browser action as a JSON object with a "type" field:

1. **navigate** — Go to a URL
   \`\`\`json
   { "type": "navigate", "url": "https://example.com" }
   \`\`\`

2. **screenshot** — Capture the page or a specific element
   \`\`\`json
   { "type": "screenshot" }
   { "type": "screenshot", "selector": "#main-content" }
   \`\`\`

3. **click** — Click an element by CSS selector
   \`\`\`json
   { "type": "click", "selector": "button.submit" }
   \`\`\`

4. **type** — Type text into an input element
   \`\`\`json
   { "type": "type", "selector": "input[name='search']", "text": "hello world" }
   \`\`\`

5. **evaluate** — Run JavaScript in the page context
   \`\`\`json
   { "type": "evaluate", "script": "document.title" }
   \`\`\`

6. **close** — Close the browser
   \`\`\`json
   { "type": "close" }
   \`\`\`

### Tips
- Always **navigate** to a URL before performing other actions.
- Use **screenshot** to visually verify page state.
- CSS selectors should be specific enough to uniquely identify elements.
- The **evaluate** action returns the result of the last expression in the script.`;
}
