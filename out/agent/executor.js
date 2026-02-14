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
exports.Executor = void 0;
const vscode = __importStar(require("vscode"));
class Executor {
    /**
     * 정의된 액션을 VS Code 환경에서 실제로 실행합니다.
     */
    async execute(action) {
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
    async writeFile(path, content) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder)
            throw new Error('No workspace folder open');
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
                    if (!block.includes('<<<<<<< SEARCH'))
                        continue;
                    const parts = block.split(/=======/);
                    if (parts.length !== 2)
                        continue;
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
                        return `Successfully updated ${path} via WorkspaceEdit.`;
                    }
                    else {
                        // applyEdit 실패 시 FileSystem API로 폴백
                        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(currentContent, 'utf8'));
                        return `Updated ${path} via FileSystem (WorkspaceEdit fallback).`;
                    }
                }
                else {
                    throw new Error(`Search/Replace failed: No matching blocks found in ${path}.`);
                }
            }
            else {
                // 전체 덮어쓰기: 더 안전한 방식 사용
                try {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                    edit.replace(fileUri, fullRange, content);
                }
                catch {
                    // 파일이 없는 경우
                    edit.createFile(fileUri, { overwrite: true });
                    edit.insert(fileUri, new vscode.Position(0, 0), content);
                }
                const success = await vscode.workspace.applyEdit(edit);
                if (success) {
                    return `Successfully wrote to ${path}`;
                }
                else {
                    // 최종 폴백
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
                    return `Wrote to ${path} via FileSystem API.`;
                }
            }
        }
        catch (error) {
            // 파일이 없는 경우 새로 생성 후 쓰기
            const newFileEdit = new vscode.WorkspaceEdit();
            newFileEdit.createFile(fileUri, { overwrite: true });
            newFileEdit.insert(fileUri, new vscode.Position(0, 0), content);
            await vscode.workspace.applyEdit(newFileEdit);
            return `Successfully created ${path}`;
        }
    }
    async readFile(path) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder)
            throw new Error('No workspace folder open');
        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
        const data = await vscode.workspace.fs.readFile(fileUri);
        return Buffer.from(data).toString('utf8');
    }
    async deleteFile(path) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder)
            throw new Error('No workspace folder open');
        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path);
        await vscode.workspace.fs.delete(fileUri);
        return `Successfully deleted ${path}`;
    }
    async runTerminal(command) {
        // [Phase 3] 터미널 결과를 캡처하는 로직 고도화 예정
        const terminal = vscode.window.createTerminal('Tokamak Executor');
        terminal.show();
        terminal.sendText(command);
        return `Command sent to terminal: ${command}`;
    }
}
exports.Executor = Executor;
//# sourceMappingURL=executor.js.map