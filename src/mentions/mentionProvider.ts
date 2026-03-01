import * as vscode from 'vscode';
import type { MentionType, MentionQuery, MentionResult, MentionSuggestion } from './types.js';

const MENTION_REGEX = /@(file|folder|symbol|problems)(?::([^\s]+))?/g;

const TYPE_PREFIXES: { prefix: string; type: MentionType }[] = [
  { prefix: 'file:', type: 'file' },
  { prefix: 'folder:', type: 'folder' },
  { prefix: 'symbol:', type: 'symbol' },
];

const CATEGORY_SUGGESTIONS: MentionSuggestion[] = [
  { type: 'file', displayName: 'file', icon: '\u{1F4C4}', insertText: '@file:' },
  { type: 'folder', displayName: 'folder', icon: '\u{1F4C1}', insertText: '@folder:' },
  { type: 'symbol', displayName: 'symbol', icon: '\u{1F50D}', insertText: '@symbol:' },
  { type: 'problems', displayName: 'problems', icon: '\u26A0\uFE0F', insertText: '@problems' },
];

export class MentionProvider {
  /**
   * Parse user input text at cursor position to detect mention query.
   * Detects patterns: @, @file:, @folder:, @symbol:, @problems
   * Returns null if no mention is being typed.
   */
  parseQuery(text: string, cursorPos: number): MentionQuery | null {
    // Walk backwards from cursorPos to find @
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = text[i];
      // Stop if we hit whitespace before finding @
      if (ch === ' ' || ch === '\n' || ch === '\t') {
        return null;
      }
      if (ch === '@') {
        atIndex = i;
        break;
      }
    }

    if (atIndex === -1) {
      return null;
    }

    // Extract the text between @ and cursorPos
    const afterAt = text.substring(atIndex + 1, cursorPos);

    // Check for type prefix: file:, folder:, symbol:
    for (const { prefix, type } of TYPE_PREFIXES) {
      if (afterAt.startsWith(prefix)) {
        const searchText = afterAt.substring(prefix.length);
        return {
          type,
          text: searchText,
          startIndex: atIndex,
          endIndex: cursorPos,
        };
      }
    }

    // Check for "problems" (no colon)
    if ('problems'.startsWith(afterAt) || afterAt === 'problems') {
      return {
        type: afterAt === 'problems' ? 'problems' : null,
        text: afterAt,
        startIndex: atIndex,
        endIndex: cursorPos,
      };
    }

    // Just @ with no recognized prefix — show categories
    if (afterAt === '') {
      return {
        type: null,
        text: '',
        startIndex: atIndex,
        endIndex: cursorPos,
      };
    }

    // Partial prefix match for category filtering (e.g., @fi -> filter to file)
    const partialMatches = TYPE_PREFIXES.filter(({ prefix }) =>
      prefix.startsWith(afterAt) || afterAt.startsWith(prefix.slice(0, -1))
    );
    if (partialMatches.length > 0 || 'problems'.startsWith(afterAt)) {
      return {
        type: null,
        text: afterAt,
        startIndex: atIndex,
        endIndex: cursorPos,
      };
    }

    return null;
  }

  /**
   * Get autocomplete suggestions for a mention query.
   */
  async getSuggestions(query: MentionQuery): Promise<MentionSuggestion[]> {
    // If query.type is null, return category suggestions (filtered by partial text)
    if (query.type === null) {
      if (query.text === '') {
        return CATEGORY_SUGGESTIONS;
      }
      return CATEGORY_SUGGESTIONS.filter(s =>
        s.displayName.startsWith(query.text)
      );
    }

    switch (query.type) {
      case 'file':
        return this.getFileSuggestions(query.text);
      case 'folder':
        return this.getFolderSuggestions(query.text);
      case 'symbol':
        return this.getSymbolSuggestions(query.text);
      case 'problems':
        return this.getProblemsSuggestion();
      default:
        return [];
    }
  }

  /**
   * Resolve a mention to its full context string for prompt injection.
   */
  async resolve(mention: MentionResult): Promise<string> {
    switch (mention.type) {
      case 'file':
        return this.resolveFile(mention);
      case 'folder':
        return this.resolveFolder(mention);
      case 'symbol':
        return this.resolveSymbol(mention);
      case 'problems':
        return this.resolveProblems();
      default:
        return mention.resolvedContext;
    }
  }

  /**
   * Process a message text, replacing mention tokens with resolved contexts.
   * E.g., "Fix @file:src/foo.ts" -> "Fix src/foo.ts"
   * Returns cleaned text + array of resolved contexts.
   */
  async resolveAllMentions(text: string): Promise<{ processedText: string; resolvedContexts: string[] }> {
    const resolvedContexts: string[] = [];
    const matches: { fullMatch: string; type: MentionType; value: string; index: number }[] = [];

    // Find all @type:value patterns in text
    const regex = new RegExp(MENTION_REGEX.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const type = match[1] as MentionType;
      const value = match[2] || '';
      matches.push({
        fullMatch: match[0],
        type,
        value,
        index: match.index,
      });
    }

    // Resolve each match
    let processedText = text;
    // Process in reverse order to preserve indices
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const context = await this.resolveMatchedMention(m.type, m.value);
      resolvedContexts.unshift(context);
      // Replace mention with just the search term (no @ prefix)
      const replacement = m.value || m.type;
      processedText =
        processedText.substring(0, m.index) +
        replacement +
        processedText.substring(m.index + m.fullMatch.length);
    }

    return { processedText, resolvedContexts };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async getFileSuggestions(searchText: string): Promise<MentionSuggestion[]> {
    const globPattern = searchText ? `**/*${searchText}*` : '**/*';
    const uris = await vscode.workspace.findFiles(globPattern, '**/node_modules/**', 20);

    // Sort by relevance: exact name match first
    const sorted = uris.sort((a, b) => {
      const aName = a.path.split('/').pop() || '';
      const bName = b.path.split('/').pop() || '';
      const aExact = aName === searchText ? 0 : 1;
      const bExact = bName === searchText ? 0 : 1;
      if (aExact !== bExact) {
        return aExact - bExact;
      }
      return aName.localeCompare(bName);
    });

    return sorted.map(uri => {
      const relativePath = vscode.workspace.asRelativePath(uri);
      return {
        type: 'file' as MentionType,
        displayName: relativePath,
        insertText: `@file:${relativePath}`,
        icon: '\u{1F4C4}',
        detail: uri.path.split('/').slice(-2, -1)[0] || '',
      };
    });
  }

  private async getFolderSuggestions(searchText: string): Promise<MentionSuggestion[]> {
    // Search for directories by finding files and extracting unique parent directories
    const globPattern = searchText ? `**/*${searchText}*/**/*` : '**/*';
    const uris = await vscode.workspace.findFiles(globPattern, '**/node_modules/**', 100);

    const folderSet = new Set<string>();
    for (const uri of uris) {
      const relativePath = vscode.workspace.asRelativePath(uri);
      const parts = relativePath.split('/');
      // Collect all parent directories
      for (let j = 1; j < parts.length; j++) {
        const folderPath = parts.slice(0, j).join('/');
        if (searchText === '' || folderPath.includes(searchText)) {
          folderSet.add(folderPath);
        }
      }
    }

    const folders = Array.from(folderSet).sort().slice(0, 20);
    return folders.map(folder => ({
      type: 'folder' as MentionType,
      displayName: folder,
      insertText: `@folder:${folder}`,
      icon: '\u{1F4C1}',
    }));
  }

  private async getSymbolSuggestions(searchText: string): Promise<MentionSuggestion[]> {
    if (!searchText) {
      return [];
    }

    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      searchText
    );

    if (!symbols || symbols.length === 0) {
      return [];
    }

    return symbols.slice(0, 20).map(symbol => {
      const relativePath = vscode.workspace.asRelativePath(symbol.location.uri);
      return {
        type: 'symbol' as MentionType,
        displayName: symbol.name,
        insertText: `@symbol:${symbol.name}`,
        icon: '\u{1F50D}',
        detail: `${vscode.SymbolKind[symbol.kind]} in ${relativePath}`,
      };
    });
  }

  private async getProblemsSuggestion(): Promise<MentionSuggestion[]> {
    const diagnostics = vscode.languages.getDiagnostics();
    const totalIssues = diagnostics.reduce((sum, [, diags]) => sum + diags.length, 0);

    return [{
      type: 'problems' as MentionType,
      displayName: 'problems',
      insertText: '@problems',
      icon: '\u26A0\uFE0F',
      detail: `${totalIssues} issue${totalIssues !== 1 ? 's' : ''} in workspace`,
    }];
  }

  private async resolveFile(mention: MentionResult): Promise<string> {
    const filePath = mention.resolvedContext || mention.insertText.replace('@file:', '');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return `[File not found: ${filePath}]`;
    }

    const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
    try {
      const content = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(content).toString('utf8');
      return `\`\`\`${filePath}\n${text}\n\`\`\``;
    } catch {
      return `[File not found: ${filePath}]`;
    }
  }

  private async resolveFolder(mention: MentionResult): Promise<string> {
    const folderPath = mention.resolvedContext || mention.insertText.replace('@folder:', '');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return `[Folder not found: ${folderPath}]`;
    }

    const folderUri = vscode.Uri.joinPath(workspaceFolders[0].uri, folderPath);
    try {
      const entries = await vscode.workspace.fs.readDirectory(folderUri);
      const listing = entries
        .map(([name, type]) => {
          const prefix = type === vscode.FileType.Directory ? '\u{1F4C1} ' : '\u{1F4C4} ';
          return `${prefix}${name}`;
        })
        .join('\n');
      return `Directory listing for ${folderPath}:\n${listing}`;
    } catch {
      return `[Folder not found: ${folderPath}]`;
    }
  }

  private async resolveSymbol(mention: MentionResult): Promise<string> {
    const symbolName = mention.resolvedContext || mention.insertText.replace('@symbol:', '');
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      symbolName
    );

    if (!symbols || symbols.length === 0) {
      return `[Symbol not found: ${symbolName}]`;
    }

    const symbol = symbols[0];
    try {
      const document = await vscode.workspace.openTextDocument(symbol.location.uri);
      const range = symbol.location.range;
      // Grab a window around the symbol definition
      const startLine = Math.max(0, range.start.line - 2);
      const endLine = Math.min(document.lineCount - 1, range.end.line + 10);
      const extendedRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
      const text = document.getText(extendedRange);
      const relativePath = vscode.workspace.asRelativePath(symbol.location.uri);
      return `Symbol \`${symbolName}\` (${vscode.SymbolKind[symbol.kind]}) in ${relativePath}:\n\`\`\`\n${text}\n\`\`\``;
    } catch {
      return `[Could not read symbol: ${symbolName}]`;
    }
  }

  private async resolveProblems(): Promise<string> {
    const diagnostics = vscode.languages.getDiagnostics();
    if (diagnostics.length === 0) {
      return 'No problems found in the workspace.';
    }

    const lines: string[] = ['Workspace problems:'];
    for (const [uri, diags] of diagnostics) {
      if (diags.length === 0) {
        continue;
      }
      const relativePath = vscode.workspace.asRelativePath(uri);
      for (const diag of diags) {
        const severity = vscode.DiagnosticSeverity[diag.severity];
        lines.push(`- ${relativePath}:${diag.range.start.line + 1}: [${severity}] ${diag.message}`);
      }
    }
    return lines.join('\n');
  }

  private async resolveMatchedMention(type: MentionType, value: string): Promise<string> {
    const mention: MentionResult = {
      type,
      displayName: value || type,
      insertText: value ? `@${type}:${value}` : `@${type}`,
      resolvedContext: value,
      icon: '',
    };

    return this.resolve(mention);
  }
}
