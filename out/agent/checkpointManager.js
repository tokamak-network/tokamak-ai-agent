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
exports.CheckpointManager = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
/**
 * 워크스페이스 체크포인트를 관리하는 클래스
 */
class CheckpointManager {
    context;
    checkpoints = [];
    storagePath;
    constructor(context) {
        this.context = context;
        // Extension storage 경로 설정
        const storageUri = context.globalStorageUri || context.storageUri;
        this.storagePath = path.join(storageUri.fsPath, 'checkpoints');
    }
    /**
     * 현재 워크스페이스의 스냅샷을 생성합니다.
     */
    async createCheckpoint(stepDescription, stepId, planSnapshot, metadata) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }
        const checkpointId = `checkpoint-${Date.now()}`;
        const files = [];
        try {
            // 워크스페이스의 모든 파일 찾기 (일부 제외)
            const allFiles = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,.tokamak,dist,build,.next,out}/**', 1000 // 최대 1000개 파일로 제한
            );
            // 각 파일의 내용 읽기
            for (const fileUri of allFiles) {
                try {
                    const relPath = vscode.workspace.asRelativePath(fileUri);
                    const stat = await vscode.workspace.fs.stat(fileUri);
                    if (stat.type === vscode.FileType.File) {
                        // 파일 크기 제한 (10MB)
                        if (stat.size > 10 * 1024 * 1024) {
                            continue;
                        }
                        const content = await vscode.workspace.fs.readFile(fileUri);
                        files.push({
                            path: relPath,
                            content: Buffer.from(content).toString('utf8'),
                            exists: true,
                        });
                    }
                }
                catch (error) {
                    // 파일 읽기 실패는 무시하고 계속 진행
                    console.warn(`Failed to snapshot file: ${fileUri.fsPath}`, error);
                }
            }
            const checkpoint = {
                id: checkpointId,
                timestamp: Date.now(),
                stepDescription,
                stepId,
                planSnapshot,
                workspaceSnapshot: { files },
                metadata,
            };
            this.checkpoints.push(checkpoint);
            // 디스크에 저장
            await this.saveCheckpoints();
            console.log(`[CheckpointManager] Created checkpoint: ${checkpointId} (${files.length} files)`);
            return checkpointId;
        }
        catch (error) {
            console.error('[CheckpointManager] Failed to create checkpoint:', error);
            throw error;
        }
    }
    /**
     * 체크포인트를 복원합니다.
     */
    async restoreCheckpoint(checkpointId, restoreWorkspace = true) {
        const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);
        if (!checkpoint) {
            throw new Error(`Checkpoint not found: ${checkpointId}`);
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }
        if (!restoreWorkspace) {
            return; // 워크스페이스 복원 없이 메타데이터만 반환
        }
        const edit = new vscode.WorkspaceEdit();
        try {
            // 현재 파일 목록 가져오기
            const currentFiles = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,.tokamak,dist,build,.next,out}/**', 1000);
            const currentFilePaths = new Set(currentFiles.map(uri => vscode.workspace.asRelativePath(uri)));
            // 스냅샷에 있는 파일들 복원
            const snapshotFilePaths = new Set(checkpoint.workspaceSnapshot.files.map(f => f.path));
            // 삭제된 파일 처리
            for (const currentPath of currentFilePaths) {
                if (!snapshotFilePaths.has(currentPath)) {
                    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, currentPath);
                    edit.deleteFile(fileUri, { ignoreIfNotExists: true });
                }
            }
            // 파일 복원/생성
            for (const fileSnapshot of checkpoint.workspaceSnapshot.files) {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, fileSnapshot.path);
                if (fileSnapshot.exists) {
                    try {
                        // 파일이 존재하는지 확인
                        await vscode.workspace.fs.stat(fileUri);
                        // 존재하면 내용 교체
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                        edit.replace(fileUri, fullRange, fileSnapshot.content);
                    }
                    catch {
                        // 파일이 없으면 생성
                        edit.createFile(fileUri, { overwrite: true });
                        edit.insert(fileUri, new vscode.Position(0, 0), fileSnapshot.content);
                    }
                }
                else {
                    // 스냅샷에서 파일이 없었으면 삭제
                    edit.deleteFile(fileUri, { ignoreIfNotExists: true });
                }
            }
            const success = await vscode.workspace.applyEdit(edit);
            if (!success) {
                throw new Error('Failed to apply workspace edit');
            }
            console.log(`[CheckpointManager] Restored checkpoint: ${checkpointId}`);
        }
        catch (error) {
            console.error('[CheckpointManager] Failed to restore checkpoint:', error);
            throw error;
        }
    }
    /**
     * 체크포인트와 현재 워크스페이스의 diff를 생성합니다.
     */
    async compareWithCurrent(checkpointId) {
        const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);
        if (!checkpoint) {
            throw new Error(`Checkpoint not found: ${checkpointId}`);
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }
        const diffs = [];
        const snapshotFiles = new Map(checkpoint.workspaceSnapshot.files.map(f => [f.path, f]));
        // 현재 파일들 가져오기
        const currentFiles = await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,.tokamak,dist,build,.next,out}/**', 1000);
        const currentFilePaths = new Set(currentFiles.map(uri => vscode.workspace.asRelativePath(uri)));
        // 모든 파일 경로 수집
        const allPaths = new Set([
            ...snapshotFiles.keys(),
            ...currentFilePaths,
        ]);
        for (const filePath of allPaths) {
            const snapshot = snapshotFiles.get(filePath);
            let currentContent = null;
            let currentExists = false;
            try {
                const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
                const stat = await vscode.workspace.fs.stat(fileUri);
                if (stat.type === vscode.FileType.File && stat.size < 10 * 1024 * 1024) {
                    const content = await vscode.workspace.fs.readFile(fileUri);
                    currentContent = Buffer.from(content).toString('utf8');
                    currentExists = true;
                }
            }
            catch {
                currentExists = false;
            }
            const snapshotExists = snapshot?.exists ?? false;
            const snapshotContent = snapshot?.content ?? '';
            if (snapshotExists !== currentExists) {
                diffs.push({
                    path: filePath,
                    type: currentExists ? 'created' : 'deleted',
                    snapshotContent: snapshotContent,
                    currentContent: currentContent || '',
                });
            }
            else if (snapshotExists && snapshotContent !== currentContent) {
                diffs.push({
                    path: filePath,
                    type: 'modified',
                    snapshotContent: snapshotContent,
                    currentContent: currentContent || '',
                });
            }
        }
        return diffs;
    }
    /**
     * 모든 체크포인트 목록을 반환합니다.
     */
    getCheckpoints() {
        return [...this.checkpoints];
    }
    /**
     * 체크포인트를 삭제합니다.
     */
    async deleteCheckpoint(checkpointId) {
        this.checkpoints = this.checkpoints.filter(cp => cp.id !== checkpointId);
        await this.saveCheckpoints();
    }
    /**
     * 모든 체크포인트를 삭제합니다.
     */
    async clearCheckpoints() {
        this.checkpoints = [];
        await this.saveCheckpoints();
    }
    /**
     * 체크포인트를 디스크에 저장합니다.
     */
    async saveCheckpoints() {
        try {
            // 디렉토리 생성
            await fs.mkdir(this.storagePath, { recursive: true });
            // 체크포인트를 JSON으로 저장 (파일 내용은 별도 저장)
            const metadataPath = path.join(this.storagePath, 'checkpoints.json');
            const metadata = this.checkpoints.map(cp => ({
                id: cp.id,
                timestamp: cp.timestamp,
                stepDescription: cp.stepDescription,
                stepId: cp.stepId,
                planSnapshot: cp.planSnapshot,
                metadata: cp.metadata,
                fileCount: cp.workspaceSnapshot.files.length,
            }));
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
            // 각 체크포인트의 파일 스냅샷을 별도로 저장
            for (const checkpoint of this.checkpoints) {
                const checkpointDir = path.join(this.storagePath, checkpoint.id);
                await fs.mkdir(checkpointDir, { recursive: true });
                const snapshotPath = path.join(checkpointDir, 'snapshot.json');
                await fs.writeFile(snapshotPath, JSON.stringify(checkpoint.workspaceSnapshot, null, 2), 'utf8');
            }
        }
        catch (error) {
            console.error('[CheckpointManager] Failed to save checkpoints:', error);
        }
    }
    /**
     * 디스크에서 체크포인트를 로드합니다.
     */
    async loadCheckpoints() {
        try {
            const metadataPath = path.join(this.storagePath, 'checkpoints.json');
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const metadata = JSON.parse(metadataContent);
            this.checkpoints = [];
            for (const meta of metadata) {
                const checkpointDir = path.join(this.storagePath, meta.id);
                const snapshotPath = path.join(checkpointDir, 'snapshot.json');
                try {
                    const snapshotContent = await fs.readFile(snapshotPath, 'utf8');
                    const workspaceSnapshot = JSON.parse(snapshotContent);
                    this.checkpoints.push({
                        id: meta.id,
                        timestamp: meta.timestamp,
                        stepDescription: meta.stepDescription,
                        stepId: meta.stepId,
                        planSnapshot: meta.planSnapshot,
                        metadata: meta.metadata,
                        workspaceSnapshot,
                    });
                }
                catch (error) {
                    console.warn(`[CheckpointManager] Failed to load checkpoint ${meta.id}:`, error);
                }
            }
            // 타임스탬프 순으로 정렬 (최신순)
            this.checkpoints.sort((a, b) => b.timestamp - a.timestamp);
            console.log(`[CheckpointManager] Loaded ${this.checkpoints.length} checkpoints`);
        }
        catch (error) {
            // 파일이 없으면 빈 배열로 시작
            this.checkpoints = [];
        }
    }
}
exports.CheckpointManager = CheckpointManager;
//# sourceMappingURL=checkpointManager.js.map