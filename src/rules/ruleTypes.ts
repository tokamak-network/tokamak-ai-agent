export interface RuleCondition {
  languages?: string[];    // e.g., ['typescript', 'typescriptreact']
  modes?: string[];        // e.g., ['agent', 'plan']
  filePatterns?: string[]; // glob patterns for file matching
}

export interface Rule {
  id: string;              // derived from filename
  description: string;
  condition: RuleCondition;
  priority: number;        // higher = applied first
  content: string;         // the rule text (markdown body after frontmatter)
  source: string;          // file path
}
