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
exports.Observer = void 0;
const vscode = __importStar(require("vscode"));
class Observer {
    /**
     * 프로젝트 내의 진단 정보(Diagnostics)를 수집합니다.
     * @param targetFiles 특정 파일들만 검사하고 싶을 때 사용 (비어있으면 전체)
     */
    async getDiagnostics(targetFiles) {
        const diagnostics = vscode.languages.getDiagnostics();
        const result = [];
        for (const [uri, fileDiagnostics] of diagnostics) {
            const filePath = uri.fsPath;
            // 특정 파일 필터링 (필요 시)
            if (targetFiles && targetFiles.length > 0) {
                const isTarget = targetFiles.some(f => filePath.endsWith(f));
                if (!isTarget)
                    continue;
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
                        code: codeValue
                    });
                }
            }
        }
        return result;
    }
    /**
     * 에러 요약 메시지를 생성합니다.
     */
    formatDiagnostics(diags) {
        if (diags.length === 0)
            return 'No issues detected.';
        return diags.map(d => `[${d.severity}] ${d.file}:${d.line} - ${d.message}${d.code ? ` (${d.code})` : ''}`).join('\n');
    }
}
exports.Observer = Observer;
//# sourceMappingURL=observer.js.map