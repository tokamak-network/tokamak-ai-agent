import * as vscode from 'vscode';

export interface DiagnosticInfo {
    file: string;
    line: number;
    message: string;
    severity: string;
    code?: string | number;
}

export class Observer {
    /**
     * 프로젝트 내의 진단 정보(Diagnostics)를 수집합니다.
     * @param targetFiles 특정 파일들만 검사하고 싶을 때 사용 (비어있으면 전체)
     */
    public async getDiagnostics(targetFiles?: string[]): Promise<DiagnosticInfo[]> {
        const diagnostics = vscode.languages.getDiagnostics();
        const result: DiagnosticInfo[] = [];

        for (const [uri, fileDiagnostics] of diagnostics) {
            const filePath = uri.fsPath;

            // 특정 파일 필터링 (필요 시)
            if (targetFiles && targetFiles.length > 0) {
                const isTarget = targetFiles.some(f => filePath.endsWith(f));
                if (!isTarget) continue;
            }

            for (const diag of fileDiagnostics) {
                // 에러(Error)와 경고(Warning)만 수집
                if (diag.severity === vscode.DiagnosticSeverity.Error ||
                    diag.severity === vscode.DiagnosticSeverity.Warning) {

                    let codeValue = diag.code;
                    if (codeValue && typeof codeValue === 'object') {
                        codeValue = codeValue.value;
                    }

                    result.push({
                        file: vscode.workspace.asRelativePath(uri),
                        line: diag.range.start.line + 1,
                        message: diag.message,
                        severity: diag.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning',
                        code: codeValue as string | number
                    });
                }
            }
        }

        return result;
    }

    /**
     * 에러 요약 메시지를 생성합니다.
     */
    public formatDiagnostics(diags: DiagnosticInfo[]): string {
        if (diags.length === 0) return 'No issues detected.';

        return diags.map(d =>
            `[${d.severity}] ${d.file}:${d.line} - ${d.message}${d.code ? ` (${d.code})` : ''}`
        ).join('\n');
    }
}
