import { describe, it, expect } from 'vitest';
import { AutoCollector } from '../knowledge/autoCollector.js';

const samplePackageJson = JSON.stringify({
    name: 'my-app',
    version: '1.0.0',
    scripts: {
        test: 'vitest',
        build: 'tsc',
    },
    dependencies: {
        express: '^4.18.0',
    },
    devDependencies: {
        typescript: '^5.0.0',
    },
});

const sampleTsConfig = JSON.stringify({
    compilerOptions: {
        target: 'ES2022',
        module: 'Node16',
        strict: true,
        outDir: './out',
    },
});

describe('AutoCollector', () => {
    const collector = new AutoCollector();

    // ── collectFromPackageJson ──────────────────────────────────────────

    describe('collectFromPackageJson', () => {
        it('extracts the project name', () => {
            const facts = collector.collectFromPackageJson(samplePackageJson);
            const nameFact = facts.find(f => f.content.includes('Project name:'));
            expect(nameFact).toBeDefined();
            expect(nameFact!.content).toContain('my-app');
        });

        it('extracts scripts', () => {
            const facts = collector.collectFromPackageJson(samplePackageJson);
            const scriptFact = facts.find(f => f.content.includes('Scripts:'));
            expect(scriptFact).toBeDefined();
            expect(scriptFact!.content).toContain('test: vitest');
            expect(scriptFact!.content).toContain('build: tsc');
        });

        it('extracts dependencies', () => {
            const facts = collector.collectFromPackageJson(samplePackageJson);
            const depFact = facts.find(f => f.content.includes('Main dependencies:'));
            expect(depFact).toBeDefined();
            expect(depFact!.content).toContain('express');
        });

        it('returns empty array for invalid JSON', () => {
            const facts = collector.collectFromPackageJson('not valid json {{{');
            expect(facts).toEqual([]);
        });
    });

    // ── collectFromTsConfig ────────────────────────────────────────────

    describe('collectFromTsConfig', () => {
        it('extracts compiler options', () => {
            const facts = collector.collectFromTsConfig(sampleTsConfig);
            expect(facts.length).toBeGreaterThan(0);
            const configFact = facts.find(f => f.content.includes('TypeScript config:'));
            expect(configFact).toBeDefined();
            expect(configFact!.content).toContain('target: ES2022');
            expect(configFact!.content).toContain('module: Node16');
            expect(configFact!.content).toContain('strict: true');
        });

        it('returns empty array for invalid JSON', () => {
            const facts = collector.collectFromTsConfig('{ invalid }');
            expect(facts).toEqual([]);
        });
    });

    // ── collectFromReadme ──────────────────────────────────────────────

    describe('collectFromReadme', () => {
        it('extracts the first 500 characters', () => {
            const longReadme = 'A'.repeat(1000);
            const facts = collector.collectFromReadme(longReadme);
            expect(facts.length).toBe(1);
            expect(facts[0].content).toContain('Project overview:');
            // The content portion should be at most 500 chars of the original
            const overview = facts[0].content.replace('Project overview: ', '');
            expect(overview.length).toBeLessThanOrEqual(500);
        });

        it('returns empty array for empty readme', () => {
            const facts = collector.collectFromReadme('');
            expect(facts).toEqual([]);
        });
    });

    // ── collectFromDockerfile ──────────────────────────────────────────

    describe('collectFromDockerfile', () => {
        it('extracts the base image', () => {
            const dockerfile = 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nEXPOSE 3000\nCMD ["node", "server.js"]';
            const facts = collector.collectFromDockerfile(dockerfile);
            expect(facts.length).toBeGreaterThan(0);
            const dockerFact = facts[0];
            expect(dockerFact.content).toContain('node:20-alpine');
            expect(dockerFact.source).toBe('Dockerfile');
        });
    });

    // ── collectAll ─────────────────────────────────────────────────────

    describe('collectAll', () => {
        it('combines facts from multiple files', () => {
            const files = new Map<string, string>();
            files.set('package.json', samplePackageJson);
            files.set('tsconfig.json', sampleTsConfig);
            files.set('README.md', '# My App\nA sample application.');

            const facts = collector.collectAll(files);
            expect(facts.length).toBeGreaterThan(0);

            // Should have facts from each source
            const sources = new Set(facts.map(f => f.source));
            expect(sources.has('package.json')).toBe(true);
            expect(sources.has('tsconfig.json')).toBe(true);
            expect(sources.has('README')).toBe(true);

            // Should be sorted by priority descending
            for (let i = 1; i < facts.length; i++) {
                expect(facts[i - 1].priority).toBeGreaterThanOrEqual(facts[i].priority);
            }
        });
    });

    // ── formatForPrompt ────────────────────────────────────────────────

    describe('formatForPrompt', () => {
        it('respects the token budget', () => {
            const files = new Map<string, string>();
            files.set('package.json', samplePackageJson);
            files.set('tsconfig.json', sampleTsConfig);
            files.set('README.md', '# My App\nA sample application with a reasonably long description to generate content.');

            const facts = collector.collectAll(files);
            // Very small budget — should truncate early
            const result = collector.formatForPrompt(facts, 30);
            // 30 tokens ~ 120 chars; the header alone is ~42 chars (about 11 tokens)
            // so at most one or two items should fit
            expect(result.length).toBeLessThan(500);
            expect(result).toContain('## Auto-detected Project Information');
        });

        it('sorts facts by priority descending', () => {
            const facts = collector.collectAll(
                new Map([
                    ['package.json', samplePackageJson],
                    ['tsconfig.json', sampleTsConfig],
                ]),
            );

            const result = collector.formatForPrompt(facts, 5000);
            // Priority 10 items (Project name, Scripts) should appear before priority 7 (tsconfig)
            const nameIdx = result.indexOf('Project name:');
            const tsIdx = result.indexOf('TypeScript config:');
            expect(nameIdx).toBeLessThan(tsIdx);
        });
    });
});
