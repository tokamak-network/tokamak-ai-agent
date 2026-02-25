/**
 * Shared content processing utilities.
 * Extracted from executor.ts and chatPanel.ts to eliminate duplication.
 *
 * These functions clean AI-generated code before writing to disk or
 * displaying in the UI.
 */

/** 테스트 파일 등에서 자동 실행 코드(run(), main() 등) 제거 */
export function removeAutoExecutionCode(content: string, filePath: string): string {
    if (!content) return content;

    let cleaned = content;

    // JavaScript/TypeScript: run() 호출 제거
    cleaned = cleaned.replace(/^\s*run\(\)\s*;?\s*$/gm, '');
    cleaned = cleaned.replace(/\n\s*function\s+run\(\)\s*\{[\s\S]*?\}\s*\n\s*run\(\)\s*;?\s*$/m, '');
    cleaned = cleaned.replace(/\n\s*(const|let|var)\s+run\s*=\s*[^;]+;\s*\n\s*run\(\)\s*;?\s*$/m, '');

    // main() 호출 제거
    cleaned = cleaned.replace(/^\s*main\(\)\s*;?\s*$/gm, '');

    // Python: if __name__ == '__main__' 제거
    cleaned = cleaned.replace(/\n\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:\s*\n[\s\S]*$/m, '');

    // Node.js: if require.main === module 제거
    cleaned = cleaned.replace(/\n\s*if\s+require\.main\s*===\s*module\s*\{[\s\S]*?\}\s*$/m, '');

    // "All tests passed" 메시지와 함께 있는 run() 호출 제거
    cleaned = cleaned.replace(/\n\s*console\.log\(['"]All tests passed['"]\)\s*;?\s*\n\s*run\(\)\s*;?\s*$/m, '');
    cleaned = cleaned.replace(/\n\s*console\.log\(['"]All tests passed['"]\)\s*;?\s*$/m, '');

    cleaned = cleaned.replace(/\n{3,}$/, '\n\n');
    cleaned = cleaned.trimEnd();

    return cleaned;
}

/**
 * Qwen / GLM / MiniMax 등 비-Claude 모델이 코드에 HTML entity를 출력하는 문제를 수정합니다.
 * HTML/XML/SVG 파일은 entity가 의도적이므로 제외합니다.
 * Cline의 ModelContentProcessor 패턴 적용.
 */
export function unescapeHtmlEntities(content: string, filePath: string): string {
    if (!content) return content;
    if (/\.(html?|xml|svg|xhtml|xsl|rss)$/i.test(filePath)) return content;

    return content
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
}

/** 코드 끝에 남아있는 백틱(```) 제거 */
export function removeTrailingBackticks(content: string): string {
    if (!content) return content;
    let cleaned = content;
    cleaned = cleaned.replace(/\n*```+\s*$/m, '');
    cleaned = cleaned.replace(/```+\s*$/m, '');
    cleaned = cleaned.replace(/(\n```+\s*)+$/m, '');
    return cleaned.trimEnd();
}

/**
 * Qwen3-235b, DeepSeek-R1 등 추론 모델이 응답 앞에 붙이는
 * <think>...</think> / <thinking>...</thinking> 블록을 제거합니다.
 * JSON 추출, Reflection 키워드 매칭 전에 반드시 적용하세요.
 */
export function stripThinkingBlocks(text: string): string {
    if (!text) return text;
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        // minimax / 일부 모델이 사용하는 [TOOL_CALL]...[/TOOL_CALL] 블록 제거
        .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/gi, '')
        .trim();
}

/** AI 응답에 붙는 제어문자 표기(<ctrl46> 등) 및 실제 제어문자 제거 */
export function removeControlCharacterArtifacts(content: string): string {
    if (!content) return content;
    let cleaned = content;
    cleaned = cleaned.replace(/<ctrl\d+>/gi, '');
    cleaned = cleaned.replace(/\s*<ctrl\d+>\s*/gi, '');
    // 실제 ASCII 제어문자 제거 (줄바꿈\n, 탭\t, 캐리지리턴\r 제외)
    cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned.trimEnd();
}

/**
 * Qwen3 등 일부 모델이 파일 내용 맨 앞에 붙이는 파이프(|) 아티팩트를 제거합니다.
 * 패턴: "|\n실제내용" 또는 "| \n실제내용"
 * 마크다운 테이블의 파이프는 여러 개가 한 줄에 있으므로 단독 | 만 제거합니다.
 */
export function removeLeadingPipeArtifact(content: string): string {
    if (!content) return content;
    // 맨 앞에 단독 파이프(| 또는 |공백) + 줄바꿈이 있으면 제거
    return content.replace(/^\|[ \t]*\n/, '');
}
