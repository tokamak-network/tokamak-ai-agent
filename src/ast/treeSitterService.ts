/**
 * Tree-sitter WASM parser singleton service.
 *
 * Uses dynamic import for web-tree-sitter to handle cases where the
 * package may not be installed or the WASM files are unavailable.
 * Degrades gracefully — returns null when tree-sitter is not available.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export class TreeSitterService {
    private static instance: TreeSitterService | null = null;
    private ParserClass: any = null;
    private parser: any = null;
    private languages: Map<string, any> = new Map();
    private initialized: boolean = false;

    static getInstance(): TreeSitterService {
        if (!TreeSitterService.instance) {
            TreeSitterService.instance = new TreeSitterService();
        }
        return TreeSitterService.instance;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        try {
            const mod = await import('web-tree-sitter');
            this.ParserClass = mod.default ?? mod;
            await this.ParserClass.init();
            this.parser = new this.ParserClass();
            this.initialized = true;
        } catch {
            // web-tree-sitter not available — degrade gracefully
            this.initialized = false;
            this.parser = null;
            this.ParserClass = null;
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    async getParser(language: string): Promise<any | null> {
        if (!this.initialized || !this.parser || !this.ParserClass) {
            return null;
        }

        const supported = ['typescript', 'javascript', 'python', 'go'];
        if (!supported.includes(language)) {
            return null;
        }

        if (!this.languages.has(language)) {
            try {
                const lang = await this.ParserClass.Language.load(`tree-sitter-${language}.wasm`);
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
        TreeSitterService.instance = null;
    }
}
