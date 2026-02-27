import {
    removeAutoExecutionCode,
    removeTrailingBackticks,
    removeControlCharacterArtifacts,
} from '../utils/contentUtils.js';

/** Cline 스타일 + prepend/append: 처음/끝에만 추가할 때 다른 코드 건드리지 않음 */
export interface FileOperation {
    type: 'create' | 'edit' | 'delete' | 'read' | 'write_full' | 'replace' | 'prepend' | 'append';
    path: string;
    content?: string;
    description: string;
    search?: string;
    replace?: string;
}

export function parseFileOperations(response: string): FileOperation[] {
    const operations: FileOperation[] = [];

    // HTML 이스케이프 복원 (웹뷰 등에서 &lt; &gt; 로 올 수 있음)
    let raw = response.replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    // minimax 등 tool_call: write_to_file (전체 쓰기), replace_in_file (부분 수정), edit (하위 호환)
    const param = (name: string) => new RegExp(`<parameter\\s+name=["']${name}["']\\s*[^>]*>([\\s\\S]*?)<\\/parameter>`, 'i');
    const parseInvoke = (inner: string, toolType: 'write_full' | 'replace' | 'edit' | 'prepend' | 'append') => {
        const pathMatch = inner.match(param('path'));
        const descMatch = inner.match(param('description'));
        const contentMatch = inner.match(param('CONTENT')) ?? inner.match(param('content'));
        const diffMatch = inner.match(param('diff'));
        const body = contentMatch?.[1]?.trim() ?? diffMatch?.[1]?.trim();

        const searchMatch = inner.match(param('search')) ?? inner.match(param('search_text'));
        const replaceMatch = inner.match(param('replace')) ?? inner.match(param('replace_text'));
        const searchCode = searchMatch?.[1]?.trim();
        const replaceCode = replaceMatch?.[1]?.trim();

        if (pathMatch && (body || (searchCode && replaceCode))) {
            const path = pathMatch[1].replace(/<[^>]+>/g, '').trim();
            const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
            operations.push({
                type: toolType,
                path,
                description,
                content: body,
                search: searchCode,
                replace: replaceCode
            });
        }
    };
    // invoke 파서가 <<<FILE_OPERATION>>> 블록 내부를 이중 파싱하지 않도록
    // FILE_OPERATION 블록을 제거한 사본으로만 invoke를 파싱
    const rawForInvoke = raw.replace(/<<<FILE_OPERATION>>>[\s\S]*?(?:<<<END_OPERATION>>>|(?=<<<FILE_OPERATION>>>)|$)/gi, '');
    const invokeNames: [RegExp, 'write_full' | 'replace' | 'edit' | 'prepend' | 'append'][] = [
        [/<invoke\s+name=["']write_to_file["']\s*>/gi, 'write_full'],
        [/<invoke\s+name=["']replace_in_file["']\s*>/gi, 'replace'],
        [/<invoke\s+name=["']prepend["']\s*>/gi, 'prepend'],
        [/<invoke\s+name=["']append["']\s*>/gi, 'append'],
        [/<invoke\s+name=["']edit["']\s*>/gi, 'edit'],
    ];
    for (const [invokeRe, toolType] of invokeNames) {
        let m: RegExpExecArray | null;
        while ((m = invokeRe.exec(rawForInvoke)) !== null) {
            const afterInvoke = rawForInvoke.slice(m.index + m[0].length);
            const closeIdx = afterInvoke.search(/<\s*\/\s*invoke\s*>/i);
            const inner = closeIdx >= 0 ? afterInvoke.slice(0, closeIdx) : afterInvoke;
            parseInvoke(inner, toolType);
        }
    }

    // 위에서 못 찾았고, 응답이 ```...``` 블록 하나로 감싸진 경우 한 번 더 시도
    if (operations.length === 0 && /<invoke\s+name=["']edit["']/i.test(raw)) {
        const m = raw.match(/```\w*\s*\n([\s\S]*?)```/);
        if (m && /<parameter\s+name=["']path["']/i.test(m[1])) {
            const innerRaw = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            const inv = /<invoke\s+name=["']edit["']\s*>/gi.exec(innerRaw);
            if (inv) {
                const afterInvoke = innerRaw.slice(inv.index + inv[0].length);
                const closeIdx = afterInvoke.search(/<\s*\/\s*invoke\s*>/i);
                const inner = closeIdx >= 0 ? afterInvoke.slice(0, closeIdx) : afterInvoke;
                const paramLocal = (name: string) => new RegExp(`<parameter\\s+name=["']${name}["']\\s*[^>]*>([\\s\\S]*?)<\\/parameter>`, 'i');
                const pathMatch = inner.match(paramLocal('path'));
                const descMatch = inner.match(paramLocal('description'));
                const contentMatch = inner.match(paramLocal('CONTENT')) ?? inner.match(paramLocal('content'));
                const searchMatch = inner.match(paramLocal('search')) ?? inner.match(paramLocal('search_text'));
                const replaceMatch = inner.match(paramLocal('replace')) ?? inner.match(paramLocal('replace_text'));

                const body = contentMatch?.[1]?.trim();
                const searchCode = searchMatch?.[1]?.trim();
                const replaceCode = replaceMatch?.[1]?.trim();

                if (pathMatch && (body || (searchCode && replaceCode))) {
                    const path = pathMatch[1].replace(/<[^>]+>/g, '').trim();
                    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
                    operations.push({
                        type: 'edit',
                        path,
                        description,
                        content: body,
                        search: searchCode,
                        replace: replaceCode
                    });
                }
            }
        }
    }

    // 개선된 파싱: FILE_OPERATION 블록을 더 정확하게 찾기
    // END_OPERATION 태그를 명시적으로 찾되, 없으면 다음 FILE_OPERATION 전까지 또는 문자열 끝까지
    const startPositions: number[] = [];
    const startRegex = /<<<FILE_OPERATION>>>/gi;
    let match;
    while ((match = startRegex.exec(raw)) !== null) {
        startPositions.push(match.index);
    }

    // 각 시작 위치에서 블록 파싱
    for (let i = 0; i < startPositions.length; i++) {
        const blockStart = startPositions[i] + '<<<FILE_OPERATION>>>'.length;

        // 다음 FILE_OPERATION 위치 찾기
        const nextStartPos = i < startPositions.length - 1 ? startPositions[i + 1] : raw.length;

        // END_OPERATION 태그 찾기 (blockStart부터 nextStartPos 전까지)
        const searchEnd = Math.min(nextStartPos, raw.length);
        const searchText = raw.substring(blockStart, searchEnd);
        const endRegex = /<<<END_OPERATION>>>/gi;
        const endMatch = endRegex.exec(searchText);

        let blockEnd: number;
        if (endMatch) {
            // END_OPERATION 태그가 있으면 그 전까지 (blockStart 기준으로 인덱스 조정)
            blockEnd = blockStart + endMatch.index;
        } else {
            // END_OPERATION이 없으면 다음 FILE_OPERATION 전까지 또는 문자열 끝까지
            blockEnd = nextStartPos;
        }

        const block = raw.substring(blockStart, blockEnd);

        const typeMatch = block.match(/TYPE:\s*(create|edit|delete|read|write_full|replace|prepend|append)/i);
        const pathMatch = block.match(/PATH:\s*[`'"]?([^`'"\n\r]+)[`'"]?/i);
        const descMatch = block.match(/DESCRIPTION:\s*(.+?)(?:\nCONTENT:|$)/is);

        const extractField = (fieldName: string): string | undefined => {
            const startMatch = block.match(new RegExp(`${fieldName}:\\s*`, 'i'));
            if (!startMatch) return undefined;

            const startIdx = startMatch.index! + startMatch[0].length;
            // Find next possible field marker or end of block
            let endIdx = block.length;
            const nextFieldMatch = block.substring(startIdx).match(/\n(CONTENT|SEARCH|REPLACE|DESCRIPTION|PATH|TYPE):\s*/i);
            if (nextFieldMatch) {
                endIdx = startIdx + nextFieldMatch.index!;
            }

            let text = block.substring(startIdx, endIdx).trim();

            if (text.startsWith('```')) {
                const firstNewline = text.indexOf('\n');
                if (firstNewline > 0) {
                    text = text.substring(firstNewline + 1);
                } else {
                    text = text.substring(3).trim();
                }

                let lastBacktickIndex = -1;
                const lines = text.split('\n');
                for (let i = lines.length - 1; i >= 0; i--) {
                    const trimmedLine = lines[i].trim();
                    if (trimmedLine === '```' || trimmedLine.startsWith('```')) {
                        lastBacktickIndex = text.lastIndexOf('\n' + lines[i]);
                        if (lastBacktickIndex === -1) {
                            lastBacktickIndex = text.indexOf(lines[i]);
                        }
                        break;
                    }
                }

                if (lastBacktickIndex >= 0) {
                    text = text.substring(0, lastBacktickIndex).trim();
                } else {
                    text = text.trim();
                    text = text.replace(/\n*```+\s*$/m, '').replace(/```+\s*$/m, '');
                }
                text = text.replace(/\n*```+\s*$/m, '').trimEnd();
            } else {
                text = text.trim();
            }

            return text;
        };

        const content = extractField('CONTENT');
        const search = extractField('SEARCH');
        const replace = extractField('REPLACE');

        if (typeMatch && pathMatch) {
            const type = typeMatch[1].toLowerCase() as FileOperation['type'];
            operations.push({
                type: type,
                path: pathMatch[1].trim(),
                description: descMatch ? descMatch[1].trim() : '',
                content: content,
                search: search,
                replace: replace
            });
        }
    }

    // 자동 실행 코드 제거, 백틱 정리, 제어문자 표기 제거
    for (const op of operations) {
        if (op.content && (op.type === 'create' || op.type === 'edit' || op.type === 'write_full' || op.type === 'replace' || op.type === 'prepend' || op.type === 'append')) {
            op.content = removeAutoExecutionCode(op.content, op.path);
            op.content = removeTrailingBackticks(op.content);
            op.content = removeControlCharacterArtifacts(op.content);
        }
    }

    // ── 1. 완전히 동일한 중복 제거 (path + type + content + search + replace 모두 같은 경우) ──
    const seen = new Set<string>();
    const deduped = operations.filter(op => {
        const key = `${op.type}|${op.path}|${op.content ?? ''}|${op.search ?? ''}|${op.replace ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // ── 2. 같은 파일에 write_full이 있으면 나머지 모두 제거 ──
    const writeFullPaths = new Set(
        deduped.filter(op => op.type === 'write_full').map(op => op.path)
    );
    const afterWriteFull = writeFullPaths.size > 0
        ? deduped.filter(op => op.type === 'write_full' || !writeFullPaths.has(op.path))
        : deduped;

    // ── 3. 같은 파일에 대한 복수의 replace/edit 작업을 하나로 병합 ──
    // Qwen3/GLM 등이 한 파일에 SEARCH/REPLACE 블록을 여러 개 생성할 때
    // 각각을 <<<<<<< SEARCH...>>>>>>> REPLACE 형식으로 연결해 단일 작업으로 만든다.
    const MERGE_TYPES = new Set<FileOperation['type']>(['replace', 'edit']);
    const mergeGroups = new Map<string, FileOperation[]>();
    const finalOps: FileOperation[] = [];

    for (const op of afterWriteFull) {
        if (MERGE_TYPES.has(op.type)) {
            const key = op.path;
            if (!mergeGroups.has(key)) mergeGroups.set(key, []);
            mergeGroups.get(key)!.push(op);
        } else {
            finalOps.push(op);
        }
    }

    for (const [, group] of mergeGroups) {
        if (group.length === 1) {
            finalOps.push(group[0]);
        } else {
            // 여러 SEARCH/REPLACE 쌍을 하나의 CONTENT 문자열로 병합
            const combinedContent = group.map(op => {
                const s = op.search ?? op.content ?? '';
                const r = op.replace ?? op.content ?? '';
                return `<<<<<<< SEARCH\n${s}\n=======\n${r}\n>>>>>>> REPLACE`;
            }).join('\n\n');

            finalOps.push({
                type: 'replace',
                path: group[0].path,
                description: group.map(o => o.description).filter(Boolean).join(' / '),
                content: combinedContent,
                search: undefined,
                replace: undefined,
            });
        }
    }

    return finalOps;
}
