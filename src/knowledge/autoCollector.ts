/**
 * F11: Project Knowledge Auto-Collection
 *
 * Auto-collect project information from standard config files.
 * Pure module — no vscode imports; takes file contents as strings.
 */

export interface ProjectFact {
    category: 'framework' | 'language' | 'testing' | 'build' | 'dependencies' | 'structure';
    source: string;       // e.g., "package.json"
    content: string;      // the fact text
    priority: number;     // higher = more important
}

/** Rough token estimate: ~4 chars per token. */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export class AutoCollector {
    /**
     * Collect facts from package.json content.
     */
    collectFromPackageJson(content: string): ProjectFact[] {
        const facts: ProjectFact[] = [];
        let pkg: Record<string, any>;

        try {
            pkg = JSON.parse(content);
        } catch {
            return facts;
        }

        const source = 'package.json';

        // Name & description
        if (pkg.name) {
            facts.push({
                category: 'structure',
                source,
                content: `Project name: ${pkg.name}`,
                priority: 10,
            });
        }
        if (pkg.description) {
            facts.push({
                category: 'structure',
                source,
                content: `Description: ${pkg.description}`,
                priority: 10,
            });
        }

        // Module type
        if (pkg.type) {
            facts.push({
                category: 'language',
                source,
                content: `Module type: ${pkg.type}`,
                priority: 7,
            });
        }

        // Scripts
        if (pkg.scripts && typeof pkg.scripts === 'object') {
            const scriptEntries = Object.entries(pkg.scripts)
                .map(([k, v]) => `  ${k}: ${v}`)
                .join('\n');
            facts.push({
                category: 'build',
                source,
                content: `Scripts:\n${scriptEntries}`,
                priority: 10,
            });
        }

        // Dependencies (top 10)
        if (pkg.dependencies && typeof pkg.dependencies === 'object') {
            const deps = Object.entries(pkg.dependencies).slice(0, 10);
            const depList = deps.map(([k, v]) => `${k}@${v}`).join(', ');
            facts.push({
                category: 'dependencies',
                source,
                content: `Main dependencies: ${depList}`,
                priority: 8,
            });
        }

        // DevDependencies — focus on testing/build tools
        if (pkg.devDependencies && typeof pkg.devDependencies === 'object') {
            const testBuildKeywords = [
                'test', 'jest', 'vitest', 'mocha', 'chai', 'karma',
                'webpack', 'esbuild', 'rollup', 'vite', 'parcel',
                'eslint', 'prettier', 'typescript', 'ts-', 'babel',
            ];
            const relevant = Object.entries(pkg.devDependencies).filter(([k]) =>
                testBuildKeywords.some(kw => k.toLowerCase().includes(kw)),
            );
            if (relevant.length > 0) {
                const depList = relevant
                    .slice(0, 10)
                    .map(([k, v]) => `${k}@${v}`)
                    .join(', ');
                facts.push({
                    category: 'testing',
                    source,
                    content: `Dev/build tools: ${depList}`,
                    priority: 8,
                });
            }
        }

        // Engines
        if (pkg.engines && typeof pkg.engines === 'object') {
            const engineStr = Object.entries(pkg.engines)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ');
            facts.push({
                category: 'language',
                source,
                content: `Engines: ${engineStr}`,
                priority: 5,
            });
        }

        return facts;
    }

    /**
     * Collect facts from tsconfig.json content.
     */
    collectFromTsConfig(content: string): ProjectFact[] {
        const facts: ProjectFact[] = [];
        let tsconfig: Record<string, any>;

        try {
            // Strip single-line comments (tsconfig allows them).
            const cleaned = content.replace(/\/\/.*$/gm, '');
            tsconfig = JSON.parse(cleaned);
        } catch {
            return facts;
        }

        const source = 'tsconfig.json';
        const co = tsconfig.compilerOptions ?? {};
        const parts: string[] = [];

        if (co.target) parts.push(`target: ${co.target}`);
        if (co.module) parts.push(`module: ${co.module}`);
        if (co.strict !== undefined) parts.push(`strict: ${co.strict}`);
        if (co.jsx) parts.push(`jsx: ${co.jsx}`);
        if (co.outDir) parts.push(`outDir: ${co.outDir}`);
        if (co.paths) {
            const pathKeys = Object.keys(co.paths).join(', ');
            parts.push(`paths: ${pathKeys}`);
        }

        if (parts.length > 0) {
            facts.push({
                category: 'language',
                source,
                content: `TypeScript config: ${parts.join(', ')}`,
                priority: 7,
            });
        }

        return facts;
    }

    /**
     * Collect facts from README content (first 500 chars).
     */
    collectFromReadme(content: string): ProjectFact[] {
        const facts: ProjectFact[] = [];
        if (!content.trim()) {
            return facts;
        }

        const snippet = content.slice(0, 500).trim();
        facts.push({
            category: 'structure',
            source: 'README',
            content: `Project overview: ${snippet}`,
            priority: 6,
        });

        return facts;
    }

    /**
     * Collect facts from Dockerfile content.
     */
    collectFromDockerfile(content: string): ProjectFact[] {
        const facts: ProjectFact[] = [];
        if (!content.trim()) {
            return facts;
        }

        const source = 'Dockerfile';
        const parts: string[] = [];

        // Base image(s)
        const fromMatches = content.match(/^FROM\s+(\S+)/gim);
        if (fromMatches) {
            const images = fromMatches.map(m => m.replace(/^FROM\s+/i, '').trim());
            parts.push(`base image: ${images.join(', ')}`);
        }

        // Exposed ports
        const exposeMatches = content.match(/^EXPOSE\s+(.+)/gim);
        if (exposeMatches) {
            const ports = exposeMatches.map(m => m.replace(/^EXPOSE\s+/i, '').trim());
            parts.push(`ports: ${ports.join(', ')}`);
        }

        // Entry point
        const entrypointMatch = content.match(/^(?:ENTRYPOINT|CMD)\s+(.+)/im);
        if (entrypointMatch) {
            parts.push(`entrypoint: ${entrypointMatch[1].trim()}`);
        }

        if (parts.length > 0) {
            facts.push({
                category: 'build',
                source,
                content: `Docker: ${parts.join('; ')}`,
                priority: 4,
            });
        }

        return facts;
    }

    /**
     * Collect from pyproject.toml content.
     */
    collectFromPyproject(content: string): ProjectFact[] {
        const facts: ProjectFact[] = [];
        if (!content.trim()) {
            return facts;
        }

        const source = 'pyproject.toml';

        // Project name
        const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
        if (nameMatch) {
            facts.push({
                category: 'structure',
                source,
                content: `Python project: ${nameMatch[1]}`,
                priority: 8,
            });
        }

        // python-requires
        const pyReqMatch = content.match(/^\s*requires-python\s*=\s*"([^"]+)"/m);
        if (pyReqMatch) {
            facts.push({
                category: 'language',
                source,
                content: `Python requires: ${pyReqMatch[1]}`,
                priority: 8,
            });
        }

        // Dependencies — capture the TOML array.
        const depsMatch = content.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
        if (depsMatch) {
            const deps = depsMatch[1]
                .split('\n')
                .map(line => {
                    const m = line.match(/"([^"]+)"/);
                    return m ? m[1] : null;
                })
                .filter(Boolean)
                .slice(0, 10);
            if (deps.length > 0) {
                facts.push({
                    category: 'dependencies',
                    source,
                    content: `Python dependencies: ${deps.join(', ')}`,
                    priority: 8,
                });
            }
        }

        return facts;
    }

    /**
     * Collect all facts from provided file map.
     * @param files Map of filename to content
     */
    collectAll(files: Map<string, string>): ProjectFact[] {
        const allFacts: ProjectFact[] = [];

        const dispatchers: Array<[string | RegExp, (content: string) => ProjectFact[]]> = [
            ['package.json', (c) => this.collectFromPackageJson(c)],
            ['tsconfig.json', (c) => this.collectFromTsConfig(c)],
            ['Dockerfile', (c) => this.collectFromDockerfile(c)],
            ['pyproject.toml', (c) => this.collectFromPyproject(c)],
            [/^readme/i, (c) => this.collectFromReadme(c)],
        ];

        for (const [filename, content] of files) {
            for (const [pattern, collector] of dispatchers) {
                const matches =
                    typeof pattern === 'string'
                        ? filename === pattern
                        : pattern.test(filename);
                if (matches) {
                    allFacts.push(...collector(content));
                    break; // one collector per file
                }
            }
        }

        // Sort by priority descending.
        allFacts.sort((a, b) => b.priority - a.priority);

        // Deduplicate by content.
        const seen = new Set<string>();
        return allFacts.filter(fact => {
            if (seen.has(fact.content)) return false;
            seen.add(fact.content);
            return true;
        });
    }

    /**
     * Format facts for prompt injection with token budget.
     */
    formatForPrompt(facts: ProjectFact[], maxTokens: number): string {
        const header = '## Auto-detected Project Information\n';
        let result = header;
        let usedTokens = estimateTokens(header);

        // Facts should already be sorted by priority, but sort again to be safe.
        const sorted = [...facts].sort((a, b) => b.priority - a.priority);

        for (const fact of sorted) {
            const line = `- [${fact.category}] (${fact.source}): ${fact.content}\n`;
            const lineTokens = estimateTokens(line);
            if (usedTokens + lineTokens > maxTokens) {
                break;
            }
            result += line;
            usedTokens += lineTokens;
        }

        return result;
    }
}
