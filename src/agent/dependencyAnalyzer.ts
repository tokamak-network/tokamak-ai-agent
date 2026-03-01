import * as vscode from 'vscode';
import { logger } from '../utils/logger.js';

export interface FileDependency {
    path: string;
    imports: string[]; // 이 파일이 import하는 파일들
    exports: string[]; // 이 파일이 export하는 항목들
    dependents: string[]; // 이 파일을 import하는 파일들 (역방향)
}

/**
 * 파일 간 의존성 관계를 분석합니다.
 */
export class DependencyAnalyzer {
    /**
     * 파일의 import/export 관계를 분석합니다.
     */
    public async analyzeFile(path: string): Promise<FileDependency> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { path, imports: [], exports: [], dependents: [] };
        }

        try {
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const text = Buffer.from(content).toString('utf8');

            // Try AST-based extraction first, fall back to regex
            let imports = await this.extractImportsWithAST(text, path);
            if (!imports) {
                imports = this.extractImports(text, path);
            }
            const exports = this.extractExports(text);

            return {
                path,
                imports,
                exports,
                dependents: [] // 역방향 의존성은 별도로 계산
            };
        } catch (error) {
            logger.warn('[DependencyAnalyzer]', `Failed to analyze ${path}`, error);
            return { path, imports: [], exports: [], dependents: [] };
        }
    }

    /**
     * 여러 파일의 의존성 그래프를 구축합니다.
     */
    public async buildDependencyGraph(filePaths: string[]): Promise<Map<string, FileDependency>> {
        const graph = new Map<string, FileDependency>();

        // 1. 각 파일의 기본 의존성 분석
        for (const path of filePaths) {
            const dep = await this.analyzeFile(path);
            graph.set(path, dep);
        }

        // 2. 역방향 의존성 계산 (dependents)
        for (const [path, dep] of graph) {
            for (const importedPath of dep.imports) {
                const resolvedPath = this.resolveImportPath(importedPath, path);
                if (graph.has(resolvedPath)) {
                    const importedDep = graph.get(resolvedPath)!;
                    if (!importedDep.dependents.includes(path)) {
                        importedDep.dependents.push(path);
                    }
                }
            }
        }

        return graph;
    }

    /**
     * Try to extract imports using tree-sitter AST (more accurate than regex).
     * Falls back to regex if tree-sitter is not available.
     */
    private async extractImportsWithAST(content: string, filePath: string): Promise<string[] | null> {
        try {
            const { TreeSitterService } = await import('../ast/treeSitterService.js');
            const { DefinitionExtractor } = await import('../ast/definitionExtractor.js');
            const service = TreeSitterService.getInstance();
            if (!service.isInitialized()) return null;
            const ext = '.' + filePath.split('.').pop();
            const language = service.getLanguageFromExtension(ext);
            if (!language) return null;
            const extractor = new DefinitionExtractor(service);
            const outline = await extractor.getFileOutline(content, filePath, language);
            const imports: string[] = [];
            for (const imp of outline.imports) {
                if (imp.module.startsWith('.')) {
                    imports.push(imp.module);
                }
            }
            return imports.length > 0 ? imports : null;
        } catch {
            return null;
        }
    }

    /**
     * 파일에서 import 문을 추출합니다.
     */
    private extractImports(content: string, currentPath: string): string[] {
        const imports: string[] = [];

        // TypeScript/JavaScript import 패턴들
        const importPatterns = [
            /import\s+.*?\s+from\s+['"](.+?)['"]/g,
            /import\s+['"](.+?)['"]/g,
            /require\s*\(\s*['"](.+?)['"]\s*\)/g,
            /import\(['"](.+?)['"]\)/g,
        ];

        for (const pattern of importPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const importPath = match[1];
                if (importPath && !importPath.startsWith('.') && !importPath.startsWith('/')) {
                    // 외부 패키지는 제외
                    continue;
                }
                imports.push(importPath);
            }
        }

        return imports;
    }

    /**
     * 파일에서 export 문을 추출합니다.
     */
    private extractExports(content: string): string[] {
        const exports: string[] = [];

        // export 패턴들
        const exportPatterns = [
            /export\s+(?:default\s+)?(?:class|interface|type|enum|const|function|let|var)\s+(\w+)/g,
            /export\s*\{\s*([^}]+)\s*\}/g,
        ];

        for (const pattern of exportPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1]) {
                    const items = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]);
                    exports.push(...items);
                }
            }
        }

        return exports;
    }

    /**
     * 상대 경로 import를 절대 경로로 변환합니다.
     */
    private resolveImportPath(importPath: string, fromPath: string): string {
        if (!importPath.startsWith('.')) {
            return importPath; // 절대 경로 또는 패키지명
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return importPath;
        }

        // 현재 파일의 디렉토리 경로
        const fromDir = fromPath.split('/').slice(0, -1).join('/');
        
        // 상대 경로 해석
        const parts = importPath.split('/');
        let resolved = fromDir;

        for (const part of parts) {
            if (part === '..') {
                const dirs = resolved.split('/').filter(d => d);
                if (dirs.length > 0) {
                    dirs.pop();
                    resolved = dirs.join('/');
                }
            } else if (part !== '.' && part !== '') {
                resolved = resolved ? `${resolved}/${part}` : part;
            }
        }

        // 확장자 추가 (없는 경우)
        if (!resolved.match(/\.\w+$/)) {
            // TypeScript/JavaScript 파일 우선 시도
            const extensions = ['.ts', '.tsx', '.js', '.jsx'];
            // 첫 번째 확장자로 반환 (실제 파일 존재 여부는 나중에 확인)
            return `${resolved}${extensions[0]}`;
        }

        return resolved;
    }

    /**
     * 파일 수정 시 영향을 받는 관련 파일들을 찾습니다.
     */
    public async findAffectedFiles(
        modifiedFiles: string[],
        allFiles: string[]
    ): Promise<string[]> {
        const graph = await this.buildDependencyGraph(allFiles);
        const affected = new Set<string>();

        // 직접 수정된 파일들
        for (const file of modifiedFiles) {
            affected.add(file);
        }

        // 의존성 전파: 수정된 파일을 import하는 파일들도 영향받음
        const queue = [...modifiedFiles];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);

            const dep = graph.get(current);
            if (dep) {
                for (const dependent of dep.dependents) {
                    if (!affected.has(dependent)) {
                        affected.add(dependent);
                        queue.push(dependent);
                    }
                }
            }
        }

        return Array.from(affected);
    }
}
