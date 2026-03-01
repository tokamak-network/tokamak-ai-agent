export type MentionType = 'file' | 'folder' | 'symbol' | 'problems';

export interface MentionQuery {
  type: MentionType | null;  // null = unresolved, show categories
  text: string;              // text after @ (e.g., "src/foo" for @file:src/foo)
  startIndex: number;        // position of @ in original text
  endIndex: number;          // end of mention token
}

export interface MentionResult {
  type: MentionType;
  displayName: string;       // shown in autocomplete
  insertText: string;        // text inserted into input (e.g., "@file:src/foo.ts")
  resolvedContext: string;   // context injected into prompt
  icon: string;              // emoji icon for UI
}

export interface MentionSuggestion {
  type: MentionType;
  displayName: string;
  insertText: string;
  icon: string;
  detail?: string;           // secondary text (e.g., file size, symbol type)
}
