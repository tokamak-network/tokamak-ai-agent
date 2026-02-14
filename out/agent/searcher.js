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
            // 파일명 매칭 (강한 가중치)
            const nameMatches = await vscode.workspace.findFiles(`**/*${keyword}*`, '**/node_modules/**', 10);
            for (const uri of nameMatches) {
                const relPath = vscode.workspace.asRelativePath(uri);
                this.updateScore(results, relPath, 10, `Name match: ${keyword}`);
            }
            // [Phase 4 고도화] 확장자 기반 중요도 필터링 (.ts, .js, .md 선호)
            for (const [path, meta] of results) {
                if (path.endsWith('.ts') || path.endsWith('.tsx'))
                    meta.score += 5;
                if (path.endsWith('README.md') || path.endsWith('architecture.md'))
                    meta.score += 8;
            }
        }
        // 3. 점수 순 정렬 및 상위 결과 반환
        return Array.from(results.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 15);
    }
    updateScore(results, path, weight, reason) {
        const existing = results.get(path);
        if (existing) {
            existing.score += weight;
        }
        else {
            results.set(path, { path, score: weight, reason });
        }
    }
    extractKeywords(query) {
        // 단순 키워드 추출 (불용어 제외 등 로직 고도화 가능)
        return query.split(/\s+/)
            .filter(w => w.length > 2)
            .map(w => w.replace(/[^a-zA-Z0-9가-힣]/g, ''))
            .filter(w => w.length > 0);
    }
}
exports.Searcher = Searcher;
//# sourceMappingURL=searcher.js.map