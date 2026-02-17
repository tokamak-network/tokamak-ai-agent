"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Searcher = void 0;
const vscode = __importStar(require("vscode"));
class Searcher {
    /**
     * 질문과 관련된 주요 파일들을 검색하고 가중치를 기반으로 순위를 매깁니다.
     */
    async searchRelevantFiles(query) {
        const results = new Map();
        // 1. 현재 맥락 가중치 (최우선)
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const relPath = vscode.workspace.asRelativePath(activeEditor.document.uri);
            results.set(relPath, { path: relPath, score: 20, reason: 'Active context' });
        }
        // 2. 검색 키워드 기반 (다각도 검색)
        const keywords = this.extractKeywords(query);
        for (const keyword of keywords) {
            // 2-1. 파일명 매칭 (강한 가중치)
            const nameMatches = await vscode.workspace.findFiles(`**/*${keyword}*`, '**/node_modules/**', 10);
            for (const uri of nameMatches) {
                const relPath = vscode.workspace.asRelativePath(uri);
                this.updateScore(results, relPath, 10, `Name match: ${keyword}`);
            }
            // 2-2. 파일 내용 검색 (함수명, 클래스명, 변수명 등)
            await this.searchInFileContents(keyword, results);
        }
        // 3. 확장자 기반 중요도 필터링 (.ts, .js, .md 선호)
        for (const [filePath, meta] of results) {
            if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
                meta.score += 5;
            }
            if (filePath.endsWith('README.md') || filePath.endsWith('architecture.md')) {
                meta.score += 8;
            }
        }
        // 4. 점수 순 정렬 및 상위 결과 반환 (성능을 위해 15개로 제한)
        return Array.from(results.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 15);
    }
    /**
     * 파일 내용에서 키워드를 검색합니다.
     */
    async searchInFileContents(keyword, results) {
        try {
            // 코드 파일들을 찾아서 검색
            const codeFiles = await vscode.workspace.findFiles('**/*.{ts,tsx,js,jsx,py,go,java,cpp,c,h}', '**/node_modules/**', 30 // 성능을 위해 최대 30개 파일로 제한
            );
            for (const uri of codeFiles) {
                try {
                    // 파일 크기 확인 (너무 큰 파일은 스킵)
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.size > 500000) { // 500KB 이상은 스킵
                        continue;
                    }
                    // 파일 내용 읽기
                    const content = await vscode.workspace.fs.readFile(uri);
                    const text = Buffer.from(content).toString('utf8');
                    // 키워드 검색 (대소문자 구분 없이)
                    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                    if (regex.test(text)) {
                        const relPath = vscode.workspace.asRelativePath(uri);
                        // 파일 내용 매칭은 파일명 매칭보다 훨씬 낮은 가중치 (3점)
                        // 파일명 매칭(10점)이 우선되도록 함
                        this.updateScore(results, relPath, 3, `Content match: ${keyword}`);
                    }
                }
                catch (fileError) {
                    // 개별 파일 읽기 실패는 무시하고 계속 진행
                    continue;
                }
            }
        }
        catch (error) {
            // 파일 검색 실패해도 계속 진행 (파일명 검색 결과는 유지)
            console.warn(`[Searcher] Content search failed for keyword "${keyword}":`, error);
        }
    }
    updateScore(results, path, weight, reason) {
        const existing = results.get(path);
        if (existing) {
            existing.score += weight;
            // 이유를 누적 (중복 제거)
            if (existing.reason && !existing.reason.includes(reason)) {
                existing.reason += `, ${reason}`;
            }
        }
        else {
            results.set(path, { path, score: weight, reason });
        }
    }
    extractKeywords(query) {
        // 단순 키워드 추출 (불용어 제외 등 로직 고도화 가능)
        return query.split(/\s+/)
            .filter(w => w.length > 2)
            .map(w => w.replace(/[^a-zA-Z0-9가-힣_]/g, '')) // 언더스코어 포함
            .filter(w => w.length > 0)
            .slice(0, 5); // 성능을 위해 최대 5개 키워드로 제한
    }
}
exports.Searcher = Searcher;
//# sourceMappingURL=searcher.js.map