import { streamChatCompletion } from '../api/client.js';

export class Summarizer {
    /**
     * 코드 파일의 핵심 로직과 API 구조를 요약합니다.
     * 토큰 절약을 위해 전체 내용을 대신합니다.
     */
    public async summarize(path: string, content: string): Promise<string> {
        const prompt = `
다음 코드 파일(${path})의 내용을 요약해주세요.
핵심 클래스, 주요 함수 인터페이스, 그리고 이 파일의 전반적인 목적 위주로 설명해주세요.
답변은 가능한 한 짧고 명확하게(최대 5~10문장) 작성해주세요.

코드 내용:
${content.slice(0, 4000)} // 상위 일부만 사용하여 요약 요청 (토큰 절약)
`;

        try {
            let summary = '';
            const stream = streamChatCompletion([{ role: 'user', content: prompt }]);
            for await (const chunk of stream) {
                summary += chunk;
            }
            return summary.trim();
        } catch (error) {
            console.error(`[Summarizer] Failed to summarize ${path}:`, error);
            return `(Summary failed for ${path})`;
        }
    }
}
