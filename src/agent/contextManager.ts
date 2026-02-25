import * as vscode from 'vscode';
import { FileMetadata } from './searcher.js';
import { Executor } from './executor.js';
import { Summarizer } from './summarizer.js';
import { logger } from '../utils/logger.js';

export interface ContextItem {
    path: string;
    content: string;
    type: 'file' | 'summary' | 'diagnostic';
}

export class ContextManager {
    private executor: Executor;
    private summarizer: Summarizer = new Summarizer();
    /** 기본 토큰 예산 (AgentContext.tokenBudget이 제공되지 않을 때 fallback) */
    private readonly DEFAULT_MAX_TOKENS = 12000;
    private readonly SUMMARY_THRESHOLD = 4000; // 이 글자 수보다 크면 요약 시도

    constructor(executor: Executor) {
        this.executor = executor;
    }

    /**
     * 검색된 파일들을 바탕으로 AI에게 전달할 최적화된 컨텍스트를 조립합니다.
     * 중요도가 높지만 큰 파일은 요약본을 사용합니다.
     *
     * @param files 검색된 파일 메타데이터 목록
     * @param tokenBudget 컨텍스트에 사용할 최대 토큰 수 (기본값: 12000)
     */
    public async assembleContext(files: FileMetadata[], tokenBudget?: number): Promise<string> {
        const maxTokens = tokenBudget ?? this.DEFAULT_MAX_TOKENS;
        const contextParts: string[] = [];
        let currentEstimatedTokens = 0;

        for (const file of files) {
            try {
                const content = await this.executor.readFile(file.path);
                // 토큰 추정: ASCII ~0.25 토큰/글자, 한국어·중국어 등 비ASCII ~1.5 토큰/글자
                const nonAscii = (content.match(/[^\x00-\x7F]/g) ?? []).length;
                const ascii = content.length - nonAscii;
                const estimatedTokens = Math.ceil(ascii * 0.25 + nonAscii * 1.5);

                if (currentEstimatedTokens + estimatedTokens < maxTokens && content.length < this.SUMMARY_THRESHOLD) {
                    // 예산이 충분하고 파일이 작으면 전체 내용 포함
                    contextParts.push(`--- FILE: ${file.path} (Full, Score: ${file.score}) ---\n${content}\n`);
                    currentEstimatedTokens += estimatedTokens;
                } else if (currentEstimatedTokens < maxTokens) {
                    // 크기가 크거나 예산이 아슬아슬하면 요약본 포함
                    logger.info('[ContextManager]', `Summarizing heavy file: ${file.path}`);
                    const summary = await this.summarizer.summarize(file.path, content);
                    contextParts.push(`--- FILE: ${file.path} (Summary, Score: ${file.score}) ---\n${summary}\n`);
                    currentEstimatedTokens += summary.length / 3;
                } else {
                    logger.warn('[ContextManager]', `Token budget exhausted (${Math.round(currentEstimatedTokens)}/${maxTokens}), skipping: ${file.path}`);
                    contextParts.push(`--- FILE: ${file.path} (Skipped — token budget exhausted, Score: ${file.score}) ---\n`);
                }
            } catch (error) {
                logger.warn('[ContextManager]', `Failed to read file for context: ${file.path}`);
            }
        }

        logger.info('[ContextManager]', `Context assembled: ~${Math.round(currentEstimatedTokens)} tokens (budget: ${maxTokens})`);
        return contextParts.join('\n');
    }
}
