/**
 * Tree-sitter WASM parser singleton service.
 *
 * Uses dynamic import for web-tree-sitter to handle cases where the
 * package may not be installed or the WASM files are unavailable.
 * Degrades gracefully — returns null when tree-sitter is not available.
 *
 * Compatible with web-tree-sitter v0.20.x (tree-sitter.wasm) and
 * v0.22+ (web-tree-sitter.wasm).
 */

import * as path from 'path';
import * as fs from 'fs';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class TreeSitterService {
    private static instance: TreeSitterService | null = null;
    /** Absolute path to the directory containing .wasm files (set by extension on activation). */
    private static wasmDir: string = '';

    private ParserClass: any = null;
    private LanguageClass: any = null;
    private parser: any = null;
    private languages: Map<string, any> = new Map();
    private initialized: boolean = false;

    static getInstance(): TreeSitterService {
        if (!TreeSitterService.instance) {
            TreeSitterService.instance = new TreeSitterService();
        }
        return TreeSitterService.instance;
    }

    /**
     * Call once during extension activation to tell the service where the
     * WASM files live (e.g. `path.join(context.extensionPath, 'parsers')`).
     */
    static setWasmDir(dir: string): void {
        TreeSitterService.wasmDir = dir;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        if (!TreeSitterService.wasmDir) {
            return;
        }
        try {
            const mod = await import('web-tree-sitter');

            // Resolve Parser class (structure varies by version)
            //  v0.20.x: mod.default = Parser class, Parser.Language available after init()
            //  v0.22+:  mod = { Parser, Language, ... } or mod.default = { Parser, Language }
            const raw: any = mod.default ?? mod;
            if (typeof raw === 'function' && typeof raw.init === 'function') {
                // v0.20.x style: default export IS the Parser constructor
                this.ParserClass = raw;
            } else if (raw.Parser) {
                // v0.22+ style: named exports
                this.ParserClass = raw.Parser;
            } else {
                return; // unknown module shape
            }

            // Locate the core WASM runtime (name varies by version)
            const wasmDir = TreeSitterService.wasmDir;
            const coreWasm = ['tree-sitter.wasm', 'web-tree-sitter.wasm']
                .map(name => path.join(wasmDir, name))
                .find(p => fs.existsSync(p));

            if (!coreWasm) {
                return;
            }

            await this.ParserClass.init({
                locateFile() {
                    return coreWasm;
                },
            });

            // Language class becomes available AFTER init() in v0.20.x
            this.LanguageClass = raw.Language ?? this.ParserClass.Language;
            if (!this.LanguageClass) {
                return;
            }

            this.parser = new this.ParserClass();
            this.initialized = true;
        } catch {
            // web-tree-sitter not available — degrade gracefully
            this.initialized = false;
            this.parser = null;
            this.ParserClass = null;
            this.LanguageClass = null;
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    async getParser(language: string): Promise<any | null> {
        if (!this.initialized || !this.parser || !this.LanguageClass) {
            return null;
        }

        const supported = ['typescript', 'javascript', 'python', 'go'];
        if (!supported.includes(language)) {
            return null;
        }

        if (!this.languages.has(language)) {
            try {
                const wasmPath = path.join(
                    TreeSitterService.wasmDir,
                    `tree-sitter-${language}.wasm`,
                );
                const lang = await this.LanguageClass.load(wasmPath);
                this.languages.set(language, lang);
            } catch {
                return null;
            }
        }

        const lang = this.languages.get(language);
        if (lang) {
            this.parser.setLanguage(lang);
            return this.parser;
        }

        return null;
    }

    async parse(code: string, language: string): Promise<any | null> {
        const parser = await this.getParser(language);
        if (!parser) {
            return null;
        }
        return parser.parse(code);
    }

    getLanguageFromExtension(ext: string): string | null {
        const map: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.go': 'go',
        };
        return map[ext] ?? null;
    }

    dispose(): void {
        if (this.parser) {
            try { this.parser.delete(); } catch { /* ignore */ }
            this.parser = null;
        }
        this.languages.clear();
        this.initialized = false;
        this.ParserClass = null;
        this.LanguageClass = null;
        TreeSitterService.instance = null;
    }
}
