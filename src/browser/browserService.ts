/**
 * F12: Browser Automation — Service
 *
 * Browser lifecycle management.
 * puppeteer-core is marked as --external in esbuild and resolved from
 * node_modules at runtime via require().
 */

import type { BrowserAction, BrowserConfig, BrowserResult } from './browserTypes.js';
import * as path from 'path';
import * as fs from 'fs';

const DEFAULT_CONFIG: BrowserConfig = {
    enabled: true,
    headless: true,
    defaultTimeout: 30_000,
    viewport: { width: 1280, height: 720 },
};

/**
 * Auto-detect a Chrome/Chromium executable on the system.
 * Returns the first existing path, or undefined if none found.
 */
function findChromeExecutable(): string | undefined {
    const candidates: string[] = [];

    if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
        );
    } else if (process.platform === 'win32') {
        const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
        const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
        const localAppData = process.env['LOCALAPPDATA'] || '';
        candidates.push(
            path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        );
    } else {
        // Linux
        candidates.push(
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
        );
    }

    return candidates.find(p => {
        try { return fs.existsSync(p); } catch { return false; }
    });
}

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

        // require() works in the CJS bundle because puppeteer-core is
        // marked --external in esbuild and shipped in node_modules.
        let puppeteer: any;
        try {
            puppeteer = require('puppeteer-core');
        } catch (err: any) {
            throw new Error(
                `puppeteer-core is not installed. ` +
                `Run "npm install puppeteer-core" in the extension directory. ` +
                `(${err?.message ?? err})`
            );
        }
        const launchFn = puppeteer.default?.launch ?? puppeteer.launch;

        // Determine Chrome executable path
        const executablePath = this.config.executablePath || findChromeExecutable();
        if (!executablePath) {
            throw new Error(
                `Could not find Chrome/Chromium on your system. ` +
                `Please install Google Chrome or set "tokamak.browserExecutablePath" in VS Code settings.`
            );
        }

        const launchOptions: Record<string, any> = {
            headless: this.config.headless,
            defaultViewport: this.config.viewport,
            executablePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        };

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
