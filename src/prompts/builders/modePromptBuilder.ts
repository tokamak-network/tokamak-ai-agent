import type { ChatMode, PromptContext, PromptHints } from '../types.js';
import { normalizeHints } from '../components/_helpers.js';
import { getFileOpReadFormat, getFileOpFullFormat } from '../components/fileOperationFormat.js';
import { getGeneralRules, getAgentRules, getAgentExample, getPlanOutputFormat } from '../components/rules.js';

/**
 * 모드별 시스템 프롬프트를 조립합니다.
 * 기존 getSystemPromptForMode() 대체.
 */
export function buildModePrompt(mode: ChatMode, ctx: PromptContext): string {
    const { workspaceInfo, projectStructure, projectKnowledge, variant } = ctx;
    const hints: PromptHints = ctx.hints ?? normalizeHints(variant);

    switch (mode) {
        case 'ask':
            return `You are a helpful coding assistant integrated with VS Code.${workspaceInfo}
${projectStructure}
${projectKnowledge}

General Rules:
${getGeneralRules(hints)}
${getFileOpReadFormat(hints)}`;

        case 'plan':
            return `You are a software architect integrated with VS Code.${workspaceInfo}

--- Project Structure ---
The following is the directory structure of the current workspace. Use this to identify files you might need to read.
${projectStructure}
${projectKnowledge}

Your role is to help the user plan their coding tasks.
- Analyze the codebase using the project structure and 'read' operations.
- CRITICAL: Use <<<FILE_OPERATION>>> with TYPE: read to see file contents. DO NOT ask the user.
- Break down tasks into clear steps.
- List files to be modified/created.
- DO NOT write actual code, only the plan.

${getPlanOutputFormat(hints)}`;

        case 'agent':
            return `You are an autonomous coding agent integrated with VS Code.${workspaceInfo}
${projectStructure}
${projectKnowledge}

${getFileOpFullFormat(hints)}

${getAgentRules(hints)}${getAgentExample(hints)}`;

        default:
            return '';
    }
}
