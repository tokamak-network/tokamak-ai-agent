import * as vscode from 'vscode';

export interface SlashCommand {
    name: string;
    description: string;
    prompt: string;
    isBuiltin: boolean;
}

// 기본 내장 스킬 (파일이 없을 때 사용)
export const BUILTIN_SKILLS: SlashCommand[] = [
    {
        name: '/explain',
        description: 'Explain the selected code in detail',
        prompt: 'Please explain this code in detail. Include:\n1. What it does\n2. How it works\n3. Key concepts used\n4. Potential improvements',
        isBuiltin: true,
    },
    {
        name: '/refactor',
        description: 'Suggest refactoring improvements',
        prompt: 'Please suggest refactoring improvements for this code. Focus on:\n1. Code readability\n2. Performance optimizations\n3. Best practices\n4. Design patterns that could be applied',
        isBuiltin: true,
    },
    {
        name: '/fix',
        description: 'Find and fix bugs',
        prompt: 'Please analyze this code for bugs and issues. For each issue found:\n1. Describe the bug\n2. Explain why it\'s a problem\n3. Provide the fix',
        isBuiltin: true,
    },
    {
        name: '/test',
        description: 'Generate unit tests',
        prompt: 'Please generate comprehensive unit tests for this code. Include:\n1. Happy path tests\n2. Edge cases\n3. Error handling tests\nUse the appropriate testing framework for the language.',
        isBuiltin: true,
    },
    {
        name: '/docs',
        description: 'Generate documentation',
        prompt: 'Please generate documentation for this code. Include:\n1. JSDoc/docstring comments for functions\n2. Type annotations if missing\n3. Usage examples\n4. Parameter descriptions',
        isBuiltin: true,
    },
    {
        name: '/optimize',
        description: 'Optimize for performance',
        prompt: 'Please optimize this code for performance. Consider:\n1. Time complexity improvements\n2. Space complexity improvements\n3. Caching opportunities\n4. Algorithm alternatives',
        isBuiltin: true,
    },
    {
        name: '/security',
        description: 'Security audit',
        prompt: 'Please perform a security audit on this code. Check for:\n1. Common vulnerabilities (injection, XSS, etc.)\n2. Input validation issues\n3. Authentication/authorization problems\n4. Data exposure risks',
        isBuiltin: true,
    },
];

export async function loadSkillsFromFolder(workspaceFolder: vscode.WorkspaceFolder | undefined): Promise<SlashCommand[]> {
    if (!workspaceFolder) {
        return [];
    }

    const skillsFolder = vscode.Uri.joinPath(workspaceFolder.uri, '.tokamak', 'skills');
    const skills: SlashCommand[] = [];

    try {
        const files = await vscode.workspace.fs.readDirectory(skillsFolder);

        for (const [fileName, fileType] of files) {
            if (fileType === vscode.FileType.File && fileName.endsWith('.md')) {
                const filePath = vscode.Uri.joinPath(skillsFolder, fileName);
                try {
                    const content = await vscode.workspace.fs.readFile(filePath);
                    const text = Buffer.from(content).toString('utf8');

                    // 파일명에서 명령어 이름 추출 (예: explain.md → /explain)
                    const commandName = '/' + fileName.replace('.md', '');

                    // 첫 줄을 description으로, 나머지를 prompt로 사용
                    const lines = text.split('\n');
                    let description = commandName;
                    let prompt = text;

                    // YAML frontmatter 파싱 (---로 시작하는 경우)
                    if (lines[0].trim() === '---') {
                        const endIndex = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---');
                        if (endIndex > 0) {
                            const frontmatter = lines.slice(1, endIndex).join('\n');
                            const descMatch = frontmatter.match(/description:\s*(.+)/);
                            if (descMatch) {
                                description = descMatch[1].trim();
                            }
                            prompt = lines.slice(endIndex + 1).join('\n').trim();
                        }
                    } else if (lines[0].startsWith('#')) {
                        // 첫 줄이 # 제목이면 description으로 사용
                        description = lines[0].replace(/^#+\s*/, '').trim();
                        prompt = lines.slice(1).join('\n').trim();
                    }

                    skills.push({
                        name: commandName,
                        description,
                        prompt,
                        isBuiltin: false,
                    });
                } catch {
                    // 파일 읽기 실패 무시
                }
            }
        }
    } catch {
        // 폴더가 없으면 빈 배열 반환
    }

    return skills;
}

export async function getAllSkills(workspaceFolder: vscode.WorkspaceFolder | undefined): Promise<SlashCommand[]> {
    const fileSkills = await loadSkillsFromFolder(workspaceFolder);

    // 파일 스킬이 우선, 같은 이름의 내장 스킬은 덮어씀
    const fileSkillNames = new Set(fileSkills.map(s => s.name));
    const builtinSkills = BUILTIN_SKILLS.filter(s => !fileSkillNames.has(s.name));

    return [...fileSkills, ...builtinSkills];
}

export function filterSlashCommands(query: string, skills: SlashCommand[]): SlashCommand[] {
    return skills.filter(cmd =>
        cmd.name.toLowerCase().includes(query.toLowerCase()) ||
        cmd.description.toLowerCase().includes(query.toLowerCase())
    );
}

export function matchSlashCommand(text: string, skills: SlashCommand[]): { command: SlashCommand | null; remainingText: string } {
    const trimmed = text.trim();

    for (const cmd of skills) {
        if (trimmed.startsWith(cmd.name + ' ') || trimmed === cmd.name) {
            const remainingText = trimmed.substring(cmd.name.length).trim();
            return { command: cmd, remainingText };
        }
    }
    return { command: null, remainingText: text };
}
