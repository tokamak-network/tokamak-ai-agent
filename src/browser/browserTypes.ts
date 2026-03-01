/**
 * F12: Browser Automation — Type Definitions
 *
 * Pure types file — no runtime dependencies.
 */

export type BrowserAction =
    | { type: 'navigate'; url: string }
    | { type: 'screenshot'; selector?: string }
    | { type: 'click'; selector: string }
    | { type: 'type'; selector: string; text: string }
    | { type: 'evaluate'; script: string }
    | { type: 'close' };

export interface BrowserResult {
    success: boolean;
    action: string;        // action type for logging
    data?: string;         // screenshot base64, evaluate result, etc.
    error?: string;
    url?: string;          // current URL after action
    title?: string;        // current page title
}

export interface BrowserConfig {
    enabled: boolean;
    executablePath?: string;  // path to Chrome/Chromium
    headless: boolean;
    defaultTimeout: number;   // ms
    viewport: { width: number; height: number };
}
