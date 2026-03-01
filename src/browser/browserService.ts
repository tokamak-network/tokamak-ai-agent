/**
 * F12: Browser Automation — Service
 *
 * Browser lifecycle management.
 * Uses puppeteer-core via dynamic import so the extension does not hard-depend
 * on it at compile time.
 */

import type { BrowserAction, BrowserConfig, BrowserResult } from './browserTypes.js';

const DEFAULT_CONFIG: BrowserConfig = {
    enabled: true,
    headless: true,
    defaultTimeout: 30_000,
    viewport: { width: 1280, height: 720 },
};

export class BrowserService {
    private browser: any = null;   // puppeteer Browser instance
    private page: any = null;      // puppeteer Page instance
    private config: BrowserConfig;

    constructor(config?: Partial<BrowserConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Launch the browser and create an initial page.
     */
    async launch(): Promise<void> {
        if (this.browser) {
            return; // already launched
        }

        // Dynamic import so puppeteer-core is only resolved at runtime.
        // The module name is constructed via a variable to prevent TypeScript
        // from attempting compile-time resolution (puppeteer-core is optional).
        const moduleName = 'puppeteer-core';
        const puppeteer = await import(/* webpackIgnore: true */ moduleName);
        const launchFn = puppeteer.default?.launch ?? puppeteer.launch;

        const launchOptions: Record<string, any> = {
            headless: this.config.headless,
            defaultViewport: this.config.viewport,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        };
        if (this.config.executablePath) {
            launchOptions.executablePath = this.config.executablePath;
        }

        this.browser = await launchFn(launchOptions);
        this.page = await this.browser.newPage();
        this.page.setDefaultTimeout(this.config.defaultTimeout);
    }

    /**
     * Execute a single browser action.
     */
    async execute(action: BrowserAction): Promise<BrowserResult> {
        if (!this.browser || !this.page) {
            return {
                success: false,
                action: action.type,
                error: 'Browser is not running. Call launch() first.',
            };
        }

        try {
            switch (action.type) {
                case 'navigate':
                    return await this.doNavigate(action.url);

                case 'screenshot':
                    return await this.doScreenshot(action.selector);

                case 'click':
                    return await this.doClick(action.selector);

                case 'type':
                    return await this.doType(action.selector, action.text);

                case 'evaluate':
                    return await this.doEvaluate(action.script);

                case 'close':
                    await this.close();
                    return { success: true, action: 'close' };

                default:
                    return {
                        success: false,
                        action: (action as any).type ?? 'unknown',
                        error: `Unknown action type: ${(action as any).type}`,
                    };
            }
        } catch (err: any) {
            return {
                success: false,
                action: action.type,
                error: err?.message ?? String(err),
            };
        }
    }

    /**
     * Close the browser and clean up resources.
     */
    async close(): Promise<void> {
        if (this.browser) {
            try {
                await this.browser.close();
            } catch {
                // Ignore close errors (e.g., already closed).
            }
            this.browser = null;
            this.page = null;
        }
    }

    /**
     * Whether a browser instance is currently running.
     */
    isRunning(): boolean {
        return this.browser !== null;
    }

    // ─── Private action implementations ─────────────────────────────────

    private async doNavigate(url: string): Promise<BrowserResult> {
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
        return {
            success: true,
            action: 'navigate',
            url: this.page.url(),
            title: await this.page.title(),
        };
    }

    private async doScreenshot(selector?: string): Promise<BrowserResult> {
        let screenshotBuffer: Buffer;

        if (selector) {
            const element = await this.page.$(selector);
            if (!element) {
                return {
                    success: false,
                    action: 'screenshot',
                    error: `Element not found: ${selector}`,
                };
            }
            screenshotBuffer = await element.screenshot({ encoding: 'binary' });
        } else {
            screenshotBuffer = await this.page.screenshot({ encoding: 'binary' });
        }

        const base64 = Buffer.from(screenshotBuffer).toString('base64');
        return {
            success: true,
            action: 'screenshot',
            data: base64,
            url: this.page.url(),
            title: await this.page.title(),
        };
    }

    private async doClick(selector: string): Promise<BrowserResult> {
        await this.page.click(selector);
        return {
            success: true,
            action: 'click',
            url: this.page.url(),
            title: await this.page.title(),
        };
    }

    private async doType(selector: string, text: string): Promise<BrowserResult> {
        await this.page.type(selector, text);
        return {
            success: true,
            action: 'type',
            url: this.page.url(),
            title: await this.page.title(),
        };
    }

    private async doEvaluate(script: string): Promise<BrowserResult> {
        const result = await this.page.evaluate(script);
        const data = typeof result === 'string' ? result : JSON.stringify(result);
        return {
            success: true,
            action: 'evaluate',
            data,
            url: this.page.url(),
            title: await this.page.title(),
        };
    }
}
