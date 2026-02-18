import * as vscode from 'vscode';
import { AgentAction, MultiWritePayload, MultiFileOperation } from './types.js';

export class Executor {
    /**
     * 정의된 액션을 VS Code 환경에서 실제로 실행합니다.
     */
    public async execute(action: AgentAction): Promise<string> {
        console.log(`[Executor] Executing action: ${action.type}`, action.payload);

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

        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
        const edit = new vscode.WorkspaceEdit();

        try {
            // SEARCH/REPLACE 로직 처리 (Diff-like updates)
            if (content.includes('<<<<<<< SEARCH')) {
                const existingData = await vscode.workspace.fs.readFile(fileUri);
                let currentContent = Buffer.from(existingData).toString('utf8');

                const blocks = content.split(/>>>>>>> REPLACE\s*/);
                let anyApplied = false;

                for (const block of blocks) {
                    if (!block.includes('<<<<<<< SEARCH')) continue;

                    const parts = block.split(/=======/);
                    if (parts.length !== 2) continue;

                    const searchPart = parts[0].split(/<<<<<<< SEARCH\s*/)[1];
                    const replacePart = parts[1];

                    if (searchPart && replacePart) {
                        const trimmedSearch = searchPart.trim();
                        if (currentContent.includes(trimmedSearch)) {
                            currentContent = currentContent.replace(trimmedSearch, replacePart.trim());
                            anyApplied = true;
                        }
                    }
                }

                if (anyApplied) {
                    // 문서 전체 범위를 잡기 위해 기존 내용을 읽어 라인 수 계산
                    const docLines = currentContent.split('\n').length;
                    edit.replace(fileUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(docLines + 1, 0)), currentContent);

                    const success = await vscode.workspace.applyEdit(edit);
                    if (success) {
                        // 파일 명시적으로 저장
                        try {
                            const doc = await vscode.workspace.openTextDocument(fileUri);
                            await doc.save();
                        } catch {
                            // 파일이 아직 열리지 않았으면 무시
                        }
                        return `Successfully updated ${path} via WorkspaceEdit.`;
                    } else {
                        // applyEdit 실패 시 FileSystem API로 폴백
                        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(currentContent, 'utf8'));
                        return `Updated ${path} via FileSystem (WorkspaceEdit fallback).`;
                    }
                } else {
                    throw new Error(`Search/Replace failed: No matching blocks found in ${path}.`);
                }
            } else {
                // 전체 덮어쓰기: 더 안전한 방식 사용
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
                    // 파일 명시적으로 저장
                    try {
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        await doc.save();
                    } catch {
                        // 파일이 아직 열리지 않았으면 무시
                    }
                    return `Successfully wrote to ${path}`;
                } else {
                    // 최종 폴백
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
                    return `Wrote to ${path} via FileSystem API.`;
                }
            }
        } catch (error) {
            // 파일이 없는 경우 새로 생성 후 쓰기
            const newFileEdit = new vscode.WorkspaceEdit();
            newFileEdit.createFile(fileUri, { overwrite: true });
            newFileEdit.insert(fileUri, new vscode.Position(0, 0), content);
            const success = await vscode.workspace.applyEdit(newFileEdit);
            if (success) {
                // 파일 명시적으로 저장
                try {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    await doc.save();
                } catch {
                    // 파일이 아직 열리지 않았으면 무시
                }
            }
            return `Successfully created ${path}`;
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
                // VS Code 터미널 생성 또는 재사용
                const terminalName = 'Tokamak Agent';
                let terminal = vscode.window.terminals.find(t => t.name === terminalName);
                
                if (!terminal) {
                    terminal = vscode.window.createTerminal({
                        name: terminalName,
                        cwd: workspaceFolder.uri.fsPath
                    });
                }

                // 터미널 표시
                terminal.show(true);

                // 명령 실행 및 출력 캡처
                const { exec } = require('child_process');
                const cwd = workspaceFolder.uri.fsPath;

                // 터미널에 명령 표시
                terminal.sendText(`echo "[Tokamak Agent] Executing: ${command}"`);
                terminal.sendText(command);

                // 출력 캡처 (child_process로 실행하여 결과 반환)
                exec(command, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (error: any, stdout: string, stderr: string) => {
                    let result = '';

                    if (stdout) {
                        result += `[STDOUT]\n${stdout}\n`;
                    }

                    if (stderr) {
                        result += `[STDERR]\n${stderr}\n`;
                    }

                    if (error) {
                        result += `[ERROR] Exit code: ${error.code}\n${error.message}\n`;
                        // 에러가 있어도 결과는 반환 (Agent가 판단하도록)
                    }

                    if (!result) {
                        result = '(Command executed with no output)';
                    }

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

        // Atomic 모드: 모든 작업을 준비한 후 한 번에 적용
        if (atomic) {
            return await this.executeAtomicMultiWrite(operations, workspaceFolder);
        } else {
            // Non-atomic 모드: 순차적으로 실행 (실패해도 중단하지 않음)
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
        const backupMap = new Map<string, string>(); // 롤백을 위한 백업

        try {
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
                        // SEARCH/REPLACE 처리
                        if (op.content.includes('<<<<<<< SEARCH')) {
                            const existingContent = backupMap.get(op.path) || '';
                            let currentContent = existingContent;

                            const blocks = op.content.split(/>>>>>>> REPLACE\s*/);
                            let anyApplied = false;

                            for (const block of blocks) {
                                if (!block.includes('<<<<<<< SEARCH')) continue;
                                const parts = block.split(/=======/);
                                if (parts.length !== 2) continue;

                                const searchPart = parts[0].split(/<<<<<<< SEARCH\s*/)[1];
                                const replacePart = parts[1];

                                if (searchPart && replacePart) {
                                    const trimmedSearch = searchPart.trim();
                                    if (currentContent.includes(trimmedSearch)) {
                                        currentContent = currentContent.replace(trimmedSearch, replacePart.trim());
                                        anyApplied = true;
                                    }
                                }
                            }

                            if (anyApplied) {
                                const docLines = currentContent.split('\n').length;
                                edit.replace(
                                    fileUri,
                                    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(docLines + 1, 0)),
                                    currentContent
                                );
                            } else {
                                throw new Error(`Search/Replace failed for ${op.path}: No matching blocks found.`);
                            }
                        } else {
                            // 전체 덮어쓰기
                            try {
                                const doc = await vscode.workspace.openTextDocument(fileUri);
                                const fullRange = new vscode.Range(
                                    doc.positionAt(0),
                                    doc.positionAt(doc.getText().length)
                                );
                                edit.replace(fileUri, fullRange, op.content);
                            } catch {
                                // 파일이 없는 경우 생성
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
                // 수정된 파일들을 명시적으로 저장
                for (const op of operations) {
                    if (op.operation === 'create' || op.operation === 'edit') {
                        try {
                            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, op.path);
                            const doc = await vscode.workspace.openTextDocument(fileUri);
                            await doc.save();
                        } catch {
                            // 파일이 아직 열리지 않았으면 무시 (이미 저장됨)
                        }
                    }
                }

                const fileList = operations.map(op => op.path).join(', ');
                return `Successfully applied ${operations.length} file operation(s) atomically: ${fileList}`;
            } else {
                // 실패 시 백업으로 롤백 (필요한 경우)
                throw new Error('WorkspaceEdit.applyEdit failed. Changes were not applied.');
            }
        } catch (error) {
            // 롤백 시도 (백업이 있는 경우)
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
                    } catch {
                        // 롤백 실패는 무시
                    }
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
