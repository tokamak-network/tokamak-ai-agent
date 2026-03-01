export type PromptVariant = 'standard' | 'compact';
export type ChatMode = 'ask' | 'plan' | 'agent';
export type ReviewStrategy = 'review' | 'red-team';
export type DebateStrategy = 'debate' | 'perspectives';

export type ContextTier = 'small' | 'medium' | 'large';

export interface PromptHints {
    variant: PromptVariant;
    thinkingBlocks: boolean;
    contextTier: ContextTier;
}

export interface PromptContext {
    workspaceInfo: string;
    projectStructure: string;
    projectKnowledge: string;
    variant: PromptVariant;
    hints?: PromptHints;
    activeRules?: string;        // Formatted active rules from Rule System
    mcpToolsSection?: string;    // Formatted MCP tools for prompt
    browserActionDocs?: string;  // Browser action documentation
}
