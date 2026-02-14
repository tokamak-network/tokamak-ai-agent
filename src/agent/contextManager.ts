import * as vscode from 'vscode';
import { FileMetadata } from './searcher.js';
import { Executor } from './executor.js';
import { Summarizer } from './summarizer.js';

export interface ContextItem {
    path: string;
    content: string;
    type: 'file' | 'summary' | 'diagnostic';
}

export class ContextManager {
    private executor: Executor;
    private summarizer: Summarizer = new Summarizer();
    private readonly MAX_TOKENS = 12000;
    private readonly SUMMARY_THRESHOLD = 4000; // 이 글자 수보다 크면 요약 시도

    constructor(executor: Executor) {
        this.executor = executor;
    }

    /**
     * 검색된 파일들을 바탕으로 AI에게 전달할 최적화된 컨텍스트를 조립합니다.
     * 중요도가 높지만 큰 파일은 요약본을 사용합니다.
     */
    public async assembleContext(files: FileMetadata[]): Promise<string> {
        let contextParts: string[] = [];
        let currentEstimatedTokens = 0;

        for (const file of files) {
            try {
                const content = await this.executor.readFile(file.path);
                const estimatedTokens = content.length / 4;

                // 예산이 충분하고 파일이 작으면 전체 내용 포함
                if (currentEstimatedTokens + estimatedTokens < this.MAX_TOKENS && content.length < this.SUMMARY_THRESHOLD) {
                    contextParts.push(`--- FILE: \${file.path} (Full, Score: \${file.score}) ---\n\${content}\n`);
                    currentEstimatedTokens += estimatedTokens;
                } else if (currentEstimatedTokens < this.MAX_TOKENS) {
                    // 크기가 크거나 예산이 아슬아슬하면 요약본 포함
                    console.log(`[ContextManager] Summarizing heavy file: \${file.path}`);
                    const summary = await this.summarizer.summarize(file.path, content);
                    contextParts.push(`--- FILE: \${file.path} (Summary, Score: \${file.score}) ---\n\${summary}\n`);
                    currentEstimatedTokens += (summary.length / 4);
                } else {
                    contextParts.push(`--- FILE: \${file.path} (Skipped, Score: \${file.score}) ---\n`);
                }
            } catch (error) {
                console.warn(`Failed to read file for context: \${file.path}`);
            }
        }

        return contextParts.join('\n');
    }
}
