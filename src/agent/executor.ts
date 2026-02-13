import * as vscode from 'vscode';
import { AgentAction } from './types.js';

export class Executor {
    /**
     * 정의된 액션을 VS Code 환경에서 실제로 실행합니다.
     */
    public async execute(action: AgentAction): Promise<string> {
        console.log(`[Executor] Executing action: ${action.type}`, action.payload);

        switch (action.type) {
            case 'write':
                return await this.writeFile(action.payload.path, action.payload.content);
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

        try {
            // SEARCH/REPLACE 로직 처리
            if (content.includes('<<<<<<< SEARCH')) {
                const existingData = await vscode.workspace.fs.readFile(fileUri);
                let currentContent = Buffer.from(existingData).toString('utf8');

                const blocks = content.split('>>>>>>> REPLACE');
                let anyApplied = false;

                for (const block of blocks) {
                    if (!block.trim()) continue;
                    const searchParts = block.split('=======');
                    if (searchParts.length !== 2) continue;

                    const searchContent = searchParts[0].split('<<<<<<< SEARCH')[1]?.trim();
                    const replaceContent = searchParts[1]?.trim();

                    if (searchContent !== undefined && replaceContent !== undefined) {
                        if (currentContent.includes(searchContent)) {
                            currentContent = currentContent.replace(searchContent, replaceContent);
                            anyApplied = true;
                        }
                    }
                }

                if (anyApplied) {
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(currentContent, 'utf8'));
                    return `Successfully updated (Search/Replace) ${path}`;
                } else {
                    throw new Error(`No search blocks matches in ${path}`);
                }
            } else {
                // 전체 덮어쓰기
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
                return `Successfully wrote to ${path}`;
            }
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                // 파일이 없으면 새로 생성
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
                return `Successfully created ${path}`;
            }
            throw error;
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
        // [Phase 3] 터미널 결과를 캡처하는 로직 고도화 예정
        const terminal = vscode.window.createTerminal('Tokamak Executor');
        terminal.show();
        terminal.sendText(command);
        return `Command sent to terminal: ${command}`;
    }
}
