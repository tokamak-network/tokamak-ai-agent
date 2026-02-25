import * as vscode from 'vscode';
import { AgentAction, MultiWritePayload, MultiFileOperation } from './types.js';
import {
    removeAutoExecutionCode,
    removeTrailingBackticks,
    removeControlCharacterArtifacts,
    unescapeHtmlEntities,
    removeLeadingPipeArtifact,
} from '../utils/contentUtils.js';
import { logger } from '../utils/logger.js';

// ─── SEARCH/REPLACE Matching Helpers (adapted from Cline diff.ts) ─────────────

/**
 * Attempts a line-trimmed fallback match for the given search content in the original content.
 * Lines are matched by trimming leading/trailing whitespace and ensuring they are identical.
 * Returns [matchIndexStart, matchIndexEnd] if found, or false if not found.
 */
function lineTrimmedFallbackMatch(
    originalContent: string,
    searchContent: string,
    startIndex: number
): [number, number] | false {
    const originalLines = originalContent.split('\n');
    const searchLines = searchContent.split('\n');

    // Trim trailing empty line if exists (from the trailing \n in searchContent)
    if (searchLines[searchLines.length - 1] === '') {
        searchLines.pop();
    }

    // Find the line number where startIndex falls
    let startLineNum = 0;
    let currentIndex = 0;
    while (currentIndex < startIndex && startLineNum < originalLines.length) {
        currentIndex += originalLines[startLineNum].length + 1; // +1 for \n
        startLineNum++;
    }

    for (let i = startLineNum; i <= originalLines.length - searchLines.length; i++) {
        let matches = true;
        for (let j = 0; j < searchLines.length; j++) {
            if (originalLines[i + j].trim() !== searchLines[j].trim()) {
                matches = false;
                break;
            }
        }

        if (matches) {
            let matchStartIndex = 0;
            for (let k = 0; k < i; k++) {
                matchStartIndex += originalLines[k].length + 1;
            }
            let matchEndIndex = matchStartIndex;
            for (let k = 0; k < searchLines.length; k++) {
                matchEndIndex += originalLines[i + k].length + 1;
            }
            return [matchStartIndex, matchEndIndex];
        }
    }

    return false;
}

/**
 * Attempts to match blocks of code by using the first and last lines as anchors.
 * Only works for blocks of 3 or more lines to avoid false positives.
 * Returns [matchIndexStart, matchIndexEnd] if found, or false if not found.
 */
function blockAnchorFallbackMatch(
    originalContent: string,
    searchContent: string,
    startIndex: number
): [number, number] | false {
    const originalLines = originalContent.split('\n');
    const searchLines = searchContent.split('\n');

    // Only use this approach for blocks of 3+ lines
    if (searchLines.length < 3) {
        return false;
    }

    // Trim trailing empty line if exists
    if (searchLines[searchLines.length - 1] === '') {
        searchLines.pop();
    }

    const firstLineSearch = searchLines[0].trim();
    const lastLineSearch = searchLines[searchLines.length - 1].trim();
    const searchBlockSize = searchLines.length;

    // Find the line number where startIndex falls
    let startLineNum = 0;
    let currentIndex = 0;
    while (currentIndex < startIndex && startLineNum < originalLines.length) {
        currentIndex += originalLines[startLineNum].length + 1;
        startLineNum++;
    }

    for (let i = startLineNum; i <= originalLines.length - searchBlockSize; i++) {
        if (originalLines[i].trim() !== firstLineSearch) continue;
        if (originalLines[i + searchBlockSize - 1].trim() !== lastLineSearch) continue;

        let matchStartIndex = 0;
        for (let k = 0; k < i; k++) {
            matchStartIndex += originalLines[k].length + 1;
        }
        let matchEndIndex = matchStartIndex;
        for (let k = 0; k < searchBlockSize; k++) {
            matchEndIndex += originalLines[i + k].length + 1;
        }
        return [matchStartIndex, matchEndIndex];
    }

    return false;
}

// Flexible marker patterns — supports 3+ chars (e.g. <<<< or <<<<<<<)
const SEARCH_BLOCK_START_REGEX = /^[<]{3,} SEARCH\s*$/;
const SEARCH_BLOCK_END_REGEX   = /^[=]{3,}\s*$/;
const REPLACE_BLOCK_END_REGEX  = /^[>]{3,} REPLACE\s*$/;

/**
 * Applies SEARCH/REPLACE blocks from diffContent onto originalContent.
 *
 * 4-tier matching strategy (adapted from Cline):
 *   1. Exact match
 *   2. Line-trimmed match  (ignores leading/trailing whitespace per line)
 *   3. Block anchor match  (uses first/last lines as anchors, 3+ line blocks only)
 *   4. Full-file search    (handles out-of-order blocks)
 *
 * Throws if any SEARCH block cannot be matched.
 */
function applySearchReplaceBlocks(
    originalContent: string,
    diffContent: string,
    filePath: string
): string {
    let currentSearchContent = '';
    let currentReplaceContent = '';
    let inSearch = false;
    let inReplace = false;
    let searchMatchIndex = -1;
    let searchEndIndex = -1;
    let lastProcessedIndex = 0;
    const replacements: Array<{ start: number; end: number; content: string }> = [];
    let pendingOutOfOrderReplacement = false;

    const lines = diffContent.split('\n');

    for (const line of lines) {
        // ── SEARCH block start ──────────────────────────────────────────────
        if (SEARCH_BLOCK_START_REGEX.test(line)) {
            inSearch = true;
            inReplace = false;
            currentSearchContent = '';
            currentReplaceContent = '';
            searchMatchIndex = -1;
            searchEndIndex = -1;
            pendingOutOfOrderReplacement = false;
            continue;
        }

        // ── SEARCH/REPLACE separator (=======) ─────────────────────────────
        if (SEARCH_BLOCK_END_REGEX.test(line) && inSearch) {
            inSearch = false;
            inReplace = true;

            if (!currentSearchContent) {
                // Empty SEARCH block
                if (originalContent.length === 0) {
                    // New file: pure insertion
                    searchMatchIndex = 0;
                    searchEndIndex = 0;
                } else {
                    throw new Error(`Empty SEARCH block with non-empty file in ${filePath}`);
                }
            } else {
                // Tier 1: exact match
                const exactIndex = originalContent.indexOf(currentSearchContent, lastProcessedIndex);
                if (exactIndex !== -1) {
                    searchMatchIndex = exactIndex;
                    searchEndIndex = exactIndex + currentSearchContent.length;
                } else {
                    // Tier 2: line-trimmed fallback
                    const lineMatch = lineTrimmedFallbackMatch(originalContent, currentSearchContent, lastProcessedIndex);
                    if (lineMatch) {
                        [searchMatchIndex, searchEndIndex] = lineMatch;
                    } else {
                        // Tier 3: block anchor fallback
                        const blockMatch = blockAnchorFallbackMatch(originalContent, currentSearchContent, lastProcessedIndex);
                        if (blockMatch) {
                            [searchMatchIndex, searchEndIndex] = blockMatch;
                        } else {
                            // Tier 4: full-file search (handles out-of-order blocks)
                            const fullFileIndex = originalContent.indexOf(currentSearchContent, 0);
                            if (fullFileIndex !== -1) {
                                searchMatchIndex = fullFileIndex;
                                searchEndIndex = fullFileIndex + currentSearchContent.length;
                                if (searchMatchIndex < lastProcessedIndex) {
                                    pendingOutOfOrderReplacement = true;
                                }
                            } else {
                                throw new Error(
                                    `Search/Replace failed in ${filePath}: SEARCH block does not match anything in the file.\n` +
                                    `Search content:\n${currentSearchContent.trimEnd()}`
                                );
                            }
                        }
                    }
                }
            }

            if (searchMatchIndex < lastProcessedIndex) {
                pendingOutOfOrderReplacement = true;
            }
            continue;
        }

        // ── REPLACE block end ───────────────────────────────────────────────
        if (REPLACE_BLOCK_END_REGEX.test(line) && inReplace) {
            // Suspicious deletion check (kept from original safety logic)
            const searchLineCount = currentSearchContent.split('\n').filter(l => l.trim()).length;
            const replaceLineCount = currentReplaceContent.split('\n').filter(l => l.trim()).length;
            const suspicious =
                (currentReplaceContent.trim() === '' && searchLineCount > 3) ||
                (currentSearchContent.length > 100 && currentReplaceContent.length < currentSearchContent.length * 0.3);

            if (suspicious) {
                logger.warn(
                    '[Executor]',
                    `Suspicious deletion in ${filePath}: ${searchLineCount} → ${replaceLineCount} lines. Skipping.`
                );
            } else if (searchMatchIndex !== -1) {
                // Skip if SEARCH === REPLACE (no-op)
                if (currentSearchContent !== currentReplaceContent) {
                    replacements.push({
                        start: searchMatchIndex,
                        end: searchEndIndex,
                        content: currentReplaceContent,
                    });
                    if (!pendingOutOfOrderReplacement) {
                        lastProcessedIndex = searchEndIndex;
                    }
                }
            }

            inSearch = false;
            inReplace = false;
            currentSearchContent = '';
            currentReplaceContent = '';
            searchMatchIndex = -1;
            searchEndIndex = -1;
            pendingOutOfOrderReplacement = false;
            continue;
        }

        // ── Accumulate content ──────────────────────────────────────────────
        if (inSearch) {
            currentSearchContent += line + '\n';
        } else if (inReplace) {
            currentReplaceContent += line + '\n';
        }
    }

    if (replacements.length === 0) {
        throw new Error(`Search/Replace failed in ${filePath}: No valid SEARCH/REPLACE blocks were matched.`);
    }

    // Sort by position and apply all replacements at once
    replacements.sort((a, b) => a.start - b.start);

    let result = '';
    let currentPos = 0;
    for (const r of replacements) {
        result += originalContent.slice(currentPos, r.start);
        result += r.content;
        currentPos = r.end;
    }
    result += originalContent.slice(currentPos);
    return result;
}

// ─── AsyncMutex ────────────────────────────────────────────────────────────────

/**
 * Promise 기반 비동기 뮤텍스.
 * 동일 파일에 대한 동시 쓰기 작업을 직렬화합니다.
 * Cline의 stateMutex 패턴을 단순화하여 적용.
 */
class AsyncMutex {
    private locked = false;
    private readonly queue: Array<() => void> = [];

    /** 락을 획득하고, 해제 함수를 반환합니다. finally 블록에서 반드시 호출하세요. */
    acquire(): Promise<() => void> {
        return new Promise((resolve) => {
            const tryAcquire = () => {
                if (!this.locked) {
                    this.locked = true;
                    resolve(() => this.release());
                } else {
                    this.queue.push(tryAcquire);
                }
            };
            tryAcquire();
        });
    }

    private release(): void {
        this.locked = false;
        const next = this.queue.shift();
        if (next) next();
    }
}

// ─── Executor Class ────────────────────────────────────────────────────────────

export class Executor {
    /** 파일 쓰기/삭제 직렬화용 뮤텍스 — 동시 접근으로 인한 충돌 방지 */
    private readonly writeMutex = new AsyncMutex();

    /**
     * 정의된 액션을 VS Code 환경에서 실제로 실행합니다.
     */
    public async execute(action: AgentAction): Promise<string> {
        logger.info('[Executor]', `Executing action: ${action.type}`, action.payload);

        switch (action.type) {
            case 'write':
                return await this.writeFile(action.payload.path, action.payload.content);
            case 'multi_write':
                return await this.multiWrite(action.payload as MultiWritePayload);
            case 'read':
                return await this.readFile(action.payload.path);
            case 'run':
                return await this.runTerminal(action.payload.command);
            case 'delete':
                return await this.deleteFile(action.payload.path);
            default:
                throw new Error(`Unsupported action type: ${action.type}`);
        }
    }

    private async writeFile(path: string, content: string): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) throw new Error('No workspace folder open');

        // 동시 파일 쓰기 직렬화 — 사용자가 편집 중인 파일과 에이전트가 충돌하는 경우 방지
        const release = await this.writeMutex.acquire();
        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
        const edit = new vscode.WorkspaceEdit();

        try {
            // 자동 실행 코드 제거, 백틱 정리, 제어문자 표기 제거, HTML entity 복원
            content = removeLeadingPipeArtifact(content);
            content = removeAutoExecutionCode(content, path);
            content = removeTrailingBackticks(content);
            content = removeControlCharacterArtifacts(content);
            content = unescapeHtmlEntities(content, path);

            if (content.includes('<<<<<<< SEARCH')) {
                // ── SEARCH/REPLACE mode (Cline 4-tier matching) ─────────────
                const existingData = await vscode.workspace.fs.readFile(fileUri);
                const currentContent = Buffer.from(existingData).toString('utf8');
                const newContent = applySearchReplaceBlocks(currentContent, content, path);

                try {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                    edit.replace(fileUri, fullRange, newContent);
                } catch {
                    edit.insert(fileUri, new vscode.Position(0, 0), newContent);
                }

                const success = await vscode.workspace.applyEdit(edit);
                if (success) {
                    try {
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        await doc.save();
                    } catch { /* 파일이 아직 열리지 않았으면 무시 */ }
                    return `Successfully updated ${path} via WorkspaceEdit.`;
                } else {
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(newContent, 'utf8'));
                    return `Updated ${path} via FileSystem (WorkspaceEdit fallback).`;
                }
            } else {
                // ── Full overwrite mode ──────────────────────────────────────
                try {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                    edit.replace(fileUri, fullRange, content);
                } catch {
                    // 파일이 없는 경우
                    edit.createFile(fileUri, { overwrite: true });
                    edit.insert(fileUri, new vscode.Position(0, 0), content);
                }

                const success = await vscode.workspace.applyEdit(edit);
                if (success) {
                    try {
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        await doc.save();
                    } catch { /* 파일이 아직 열리지 않았으면 무시 */ }
                    return `Successfully wrote to ${path}`;
                } else {
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
                    return `Wrote to ${path} via FileSystem API.`;
                }
            }
        } catch (error) {
            // SEARCH/REPLACE 매칭 실패 → 파일을 garbage로 덮어쓰지 않고 오류를 상위로 전파
            // (에이전트가 Fixing 단계에서 올바른 SEARCH 블록으로 재시도하게 함)
            if (content.includes('<<<<<<< SEARCH')) {
                throw error;
            }

            // 파일이 없는 경우(새 파일 생성 요청) 새로 생성 후 쓰기
            const newFileEdit = new vscode.WorkspaceEdit();
            newFileEdit.createFile(fileUri, { overwrite: true });
            newFileEdit.insert(fileUri, new vscode.Position(0, 0), content);
            const success = await vscode.workspace.applyEdit(newFileEdit);
            if (success) {
                try {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    await doc.save();
                } catch { /* 무시 */ }
            }
            return `Successfully created ${path}`;
        } finally {
            release(); // 뮤텍스 해제 — 성공/실패/예외 모든 경우에 반드시 실행
        }
    }

    public async readFile(path: string): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) throw new Error('No workspace folder open');

        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
        const data = await vscode.workspace.fs.readFile(fileUri);
        return Buffer.from(data).toString('utf8');
    }

    private async deleteFile(path: string): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) throw new Error('No workspace folder open');

        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
        await vscode.workspace.fs.delete(fileUri);
        return `Successfully deleted ${path}`;
    }

    private async runTerminal(command: string): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }

        return new Promise(async (resolve, reject) => {
            try {
                const terminalName = 'Tokamak Agent';
                let terminal = vscode.window.terminals.find(t => t.name === terminalName);

                if (!terminal) {
                    terminal = vscode.window.createTerminal({
                        name: terminalName,
                        cwd: workspaceFolder.uri.fsPath
                    });
                }

                terminal.show(true);

                const { exec } = require('child_process');
                const cwd = workspaceFolder.uri.fsPath;

                terminal.sendText(`echo "[Tokamak Agent] Executing: ${command}"`);
                terminal.sendText(command);

                exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
                    let result = '';

                    if (stdout) result += `[STDOUT]\n${stdout}\n`;
                    if (stderr) result += `[STDERR]\n${stderr}\n`;
                    if (error)  result += `[ERROR] Exit code: ${error.code}\n${error.message}\n`;
                    if (!result) result = '(Command executed with no output)';

                    resolve(result);
                });
            } catch (error) {
                reject(error instanceof Error ? error : new Error('Unknown error'));
            }
        });
    }

    /**
     * 여러 파일을 동시에 처리합니다 (Atomic 트랜잭션 지원).
     */
    private async multiWrite(payload: MultiWritePayload): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) throw new Error('No workspace folder open');

        const operations = payload.operations || [];
        const atomic = payload.atomic !== false; // 기본값: true

        if (operations.length === 0) {
            return 'No operations to execute.';
        }

        if (atomic) {
            return await this.executeAtomicMultiWrite(operations, workspaceFolder);
        } else {
            return await this.executeNonAtomicMultiWrite(operations, workspaceFolder);
        }
    }

    /**
     * Atomic 트랜잭션: 모든 작업이 성공해야 적용, 하나라도 실패하면 롤백.
     */
    private async executeAtomicMultiWrite(
        operations: MultiFileOperation[],
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<string> {
        const edit = new vscode.WorkspaceEdit();
        const backupMap = new Map<string, string>();

        try {
            // 0. 전처리
            for (const op of operations) {
                if (op.content && (op.operation === 'create' || op.operation === 'edit')) {
                    op.content = removeLeadingPipeArtifact(op.content);
                    op.content = removeAutoExecutionCode(op.content, op.path);
                    op.content = removeTrailingBackticks(op.content);
                    op.content = removeControlCharacterArtifacts(op.content);
                }
            }

            // 1. 백업 생성 (기존 파일들)
            for (const op of operations) {
                if (op.operation === 'edit' || op.operation === 'delete') {
                    try {
                        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, op.path);
                        const content = await vscode.workspace.fs.readFile(fileUri);
                        backupMap.set(op.path, Buffer.from(content).toString('utf8'));
                    } catch {
                        // 파일이 없으면 백업 불필요
                    }
                }
            }

            // 2. 모든 작업을 WorkspaceEdit에 준비
            for (const op of operations) {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, op.path);

                switch (op.operation) {
                    case 'create':
                        edit.createFile(fileUri, { overwrite: true, ignoreIfExists: false });
                        edit.insert(fileUri, new vscode.Position(0, 0), op.content);
                        break;

                    case 'edit':
                        if (op.content.includes('<<<<<<< SEARCH')) {
                            // ── SEARCH/REPLACE mode (Cline 4-tier matching) ──
                            const existingContent = backupMap.get(op.path) || '';
                            const newContent = applySearchReplaceBlocks(existingContent, op.content, op.path);
                            const docLines = newContent.split('\n').length;
                            edit.replace(
                                fileUri,
                                new vscode.Range(new vscode.Position(0, 0), new vscode.Position(docLines + 1, 0)),
                                newContent
                            );
                        } else {
                            // ── Full overwrite ───────────────────────────────
                            try {
                                const doc = await vscode.workspace.openTextDocument(fileUri);
                                const fullRange = new vscode.Range(
                                    doc.positionAt(0),
                                    doc.positionAt(doc.getText().length)
                                );
                                edit.replace(fileUri, fullRange, op.content);
                            } catch {
                                edit.createFile(fileUri, { overwrite: true });
                                edit.insert(fileUri, new vscode.Position(0, 0), op.content);
                            }
                        }
                        break;

                    case 'delete':
                        edit.deleteFile(fileUri, { ignoreIfNotExists: true });
                        break;
                }
            }

            // 3. 모든 작업을 한 번에 적용 및 저장
            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                for (const op of operations) {
                    if (op.operation === 'create' || op.operation === 'edit') {
                        try {
                            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, op.path);
                            const doc = await vscode.workspace.openTextDocument(fileUri);
                            await doc.save();
                        } catch { /* 무시 */ }
                    }
                }

                const fileList = operations.map(op => op.path).join(', ');
                return `Successfully applied ${operations.length} file operation(s) atomically: ${fileList}`;
            } else {
                throw new Error('WorkspaceEdit.applyEdit failed. Changes were not applied.');
            }
        } catch (error) {
            // 롤백 시도
            if (backupMap.size > 0) {
                const rollbackEdit = new vscode.WorkspaceEdit();
                for (const [path, content] of backupMap) {
                    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
                    try {
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        const fullRange = new vscode.Range(
                            doc.positionAt(0),
                            doc.positionAt(doc.getText().length)
                        );
                        rollbackEdit.replace(fileUri, fullRange, content);
                    } catch { /* 롤백 실패는 무시 */ }
                }
                await vscode.workspace.applyEdit(rollbackEdit);
            }

            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Atomic multi-write failed: ${errorMsg}. All changes have been rolled back.`);
        }
    }

    /**
     * Non-atomic 모드: 순차적으로 실행, 실패해도 계속 진행.
     */
    private async executeNonAtomicMultiWrite(
        operations: MultiFileOperation[],
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<string> {
        for (const op of operations) {
            if (op.content && (op.operation === 'create' || op.operation === 'edit')) {
                op.content = removeLeadingPipeArtifact(op.content);
                op.content = removeAutoExecutionCode(op.content, op.path);
                op.content = removeTrailingBackticks(op.content);
                op.content = removeControlCharacterArtifacts(op.content);
            }
        }

        const results: string[] = [];
        let successCount = 0;
        let failCount = 0;

        for (const op of operations) {
            try {
                let result: string;
                switch (op.operation) {
                    case 'create':
                    case 'edit':
                        result = await this.writeFile(op.path, op.content);
                        break;
                    case 'delete':
                        result = await this.deleteFile(op.path);
                        break;
                    default:
                        result = `Unknown operation: ${op.operation}`;
                        failCount++;
                        continue;
                }
                results.push(`✓ ${op.path}: ${result}`);
                successCount++;
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                results.push(`✗ ${op.path}: ${errorMsg}`);
                failCount++;
            }
        }

        const summary = `Completed ${operations.length} operation(s): ${successCount} succeeded, ${failCount} failed.`;
        return `${summary}\n${results.join('\n')}`;
    }

}
