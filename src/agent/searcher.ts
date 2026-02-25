import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export interface FileMetadata {
    path: string;
    score: number;
    reason?: string;
}

export class Searcher {
    /**
     * 질문과 관련된 주요 파일들을 검색하고 가중치를 기반으로 순위를 매깁니다.
     */
    public async searchRelevantFiles(query: string): Promise<FileMetadata[]> {
        const results: Map<string, FileMetadata> = new Map();

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
    private async searchInFileContents(keyword: string, results: Map<string, FileMetadata>): Promise<void> {
        try {
            // 코드 파일들을 찾아서 검색
            const codeFiles = await vscode.workspace.findFiles(
                '**/*.{ts,tsx,js,jsx,py,go,java,cpp,c,h}',
                '**/node_modules/**',
                30 // 성능을 위해 최대 30개 파일로 제한
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

                    // 키워드 검색 (대소문자 구분 없이) — 특수문자 이스케이프로 regex 인젝션 방지
                    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
                    if (regex.test(text)) {
                        const relPath = vscode.workspace.asRelativePath(uri);
                        // 파일 내용 매칭은 파일명 매칭보다 훨씬 낮은 가중치 (3점)
                        // 파일명 매칭(10점)이 우선되도록 함
                        this.updateScore(results, relPath, 3, `Content match: ${keyword}`);
                    }
                } catch (fileError) {
                    // 개별 파일 읽기 실패는 무시하고 계속 진행
                    continue;
                }
            }
        } catch (error) {
            // 파일 검색 실패해도 계속 진행 (파일명 검색 결과는 유지)
            logger.warn('[Searcher]', `Content search failed for keyword "${keyword}"`, error);
        }
    }

    private updateScore(results: Map<string, FileMetadata>, path: string, weight: number, reason: string): void {
        const existing = results.get(path);
        if (existing) {
            existing.score += weight;
            // 이유를 누적 (중복 제거)
            if (existing.reason && !existing.reason.includes(reason)) {
                existing.reason += `, ${reason}`;
            }
        } else {
            results.set(path, { path, score: weight, reason });
        }
    }

    private extractKeywords(query: string): string[] {
        // 단순 키워드 추출 (불용어 제외 등 로직 고도화 가능)
        return query.split(/\s+/)
            .filter(w => w.length > 2)
            .map(w => w.replace(/[^a-zA-Z0-9가-힣_]/g, '')) // 언더스코어 포함
            .filter(w => w.length > 0)
            .slice(0, 5); // 성능을 위해 최대 5개 키워드로 제한
    }
}
