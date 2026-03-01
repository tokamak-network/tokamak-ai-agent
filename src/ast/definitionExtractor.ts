import type { CodeDefinition, FileOutline, DefinitionKind } from './types.js';
import { TreeSitterService } from './treeSitterService.js';

const TS_JS_DEFINITION_TYPES = [
  'function_declaration',
  'class_declaration',
  'method_definition',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'variable_declarator',
] as const;

export class DefinitionExtractor {
  private service: TreeSitterService;

  constructor(service?: TreeSitterService) {
    this.service = service ?? TreeSitterService.getInstance();
  }

  async extractDefinitions(code: string, filePath: string, language: string): Promise<CodeDefinition[]> {
    const tree = await this.service.parse(code, language);
    if (!tree) {
      return [];
    }

    const definitions: CodeDefinition[] = [];

    if (language === 'typescript' || language === 'javascript') {
      for (const nodeType of TS_JS_DEFINITION_TYPES) {
        const nodes = tree.rootNode.descendantsOfType(nodeType);
        for (const node of nodes) {
          const kind = nodeTypeToKind(nodeType);
          if (!kind) {
            continue;
          }

          const nameNode = node.childForFieldName('name');
          const name = nameNode ? nameNode.text : '';
          if (!name) {
            continue;
          }

          // For variable_declarator, only include arrow functions / function expressions
          if (nodeType === 'variable_declarator') {
            const value = node.childForFieldName('value');
            if (!value || (value.type !== 'arrow_function' && value.type !== 'function')) {
              continue;
            }
          }

          const parentName = getParentClassName(node);
          const exportType = getExportType(node);
          const signature = getNodeSignature(node, code, kind);

          definitions.push({
            kind,
            name,
            filePath,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            signature,
            parentName: parentName || undefined,
            exportType,
          });
        }
      }
    }

    return definitions;
  }

  async getFileOutline(code: string, filePath: string, language: string): Promise<FileOutline> {
    const tree = await this.service.parse(code, language);
    const definitions = await this.extractDefinitions(code, filePath, language);
    const imports = tree ? extractImports(tree, code) : [];

    return {
      filePath,
      language,
      definitions,
      imports,
    };
  }

  formatOutlineForPrompt(outline: FileOutline): string {
    const lines: string[] = [];
    lines.push(`## ${outline.filePath} (${outline.language})`);

    if (outline.imports.length > 0) {
      lines.push('### Imports');
      for (const imp of outline.imports) {
        if (imp.names.length > 0) {
          lines.push(`- { ${imp.names.join(', ')} } from "${imp.module}"`);
        } else {
          lines.push(`- "${imp.module}"`);
        }
      }
    }

    const exported = outline.definitions.filter(d => d.exportType !== 'none');
    const internal = outline.definitions.filter(d => d.exportType === 'none');

    if (exported.length > 0) {
      lines.push('### Exports');
      for (const def of exported) {
        const prefix = def.exportType === 'default' ? '(default) ' : '';
        const parent = def.parentName ? `${def.parentName}.` : '';
        lines.push(`- ${prefix}${def.kind} ${parent}${def.signature} [${def.startLine}-${def.endLine}]`);
      }
    }

    if (internal.length > 0) {
      lines.push('### Internal');
      for (const def of internal) {
        const parent = def.parentName ? `${def.parentName}.` : '';
        lines.push(`- ${def.kind} ${parent}${def.signature} [${def.startLine}-${def.endLine}]`);
      }
    }

    return lines.join('\n');
  }
}

function nodeTypeToKind(nodeType: string): DefinitionKind | null {
  const map: Record<string, DefinitionKind> = {
    'function_declaration': 'function',
    'class_declaration': 'class',
    'method_definition': 'method',
    'interface_declaration': 'interface',
    'type_alias_declaration': 'type',
    'enum_declaration': 'enum',
    'variable_declarator': 'variable',
  };
  return map[nodeType] ?? null;
}

function getParentClassName(node: any): string | null {
  let current = node.parent;
  while (current) {
    if (current.type === 'class_declaration' || current.type === 'class') {
      const nameNode = current.childForFieldName('name');
      return nameNode ? nameNode.text : null;
    }
    current = current.parent;
  }
  return null;
}

function getNodeSignature(node: any, code: string, kind: DefinitionKind): string {
  const nameNode = node.childForFieldName('name');
  const name = nameNode ? nameNode.text : '';

  switch (kind) {
    case 'function': {
      const params = node.childForFieldName('parameters');
      const returnType = node.childForFieldName('return_type');
      const paramsText = params ? params.text : '()';
      const returnText = returnType ? `: ${returnType.text}` : '';
      return `${name}${paramsText}${returnText}`;
    }
    case 'method': {
      const params = node.childForFieldName('parameters');
      const returnType = node.childForFieldName('return_type');
      const paramsText = params ? params.text : '()';
      const returnText = returnType ? `: ${returnType.text}` : '';
      return `${name}${paramsText}${returnText}`;
    }
    case 'class':
    case 'interface':
    case 'enum': {
      return name;
    }
    case 'type': {
      // Include the type value for type aliases
      const firstLine = code.substring(node.startIndex, node.endIndex).split('\n')[0];
      return firstLine.length <= 80 ? firstLine : `${name} = ...`;
    }
    case 'variable': {
      const value = node.childForFieldName('value');
      if (value && (value.type === 'arrow_function' || value.type === 'function')) {
        const params = value.childForFieldName('parameters');
        const returnType = value.childForFieldName('return_type');
        const paramsText = params ? params.text : '()';
        const returnText = returnType ? `: ${returnType.text}` : '';
        return `${name}${paramsText}${returnText}`;
      }
      return name;
    }
    default:
      return name;
  }
}

function getExportType(node: any): 'named' | 'default' | 'none' {
  const parent = node.parent;
  if (!parent) {
    return 'none';
  }

  // Check if parent is an export statement
  if (parent.type === 'export_statement') {
    // Check for "export default"
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i);
      if (child && child.type === 'default') {
        return 'default';
      }
    }
    return 'named';
  }

  // For variable_declarator, check grandparent (variable_declaration -> export_statement)
  if (node.type === 'variable_declarator' && parent.type === 'lexical_declaration') {
    const grandparent = parent.parent;
    if (grandparent && grandparent.type === 'export_statement') {
      for (let i = 0; i < grandparent.childCount; i++) {
        const child = grandparent.child(i);
        if (child && child.type === 'default') {
          return 'default';
        }
      }
      return 'named';
    }
  }

  return 'none';
}

function extractImports(tree: any, code: string): { module: string; names: string[] }[] {
  const imports: { module: string; names: string[] }[] = [];
  const importNodes = tree.rootNode.descendantsOfType('import_statement');

  for (const node of importNodes) {
    const sourceNode = node.childForFieldName('source');
    const module = sourceNode ? sourceNode.text.replace(/['"]/g, '') : '';
    if (!module) {
      continue;
    }

    const names: string[] = [];
    const importClause = node.descendantsOfType('import_specifier');
    for (const specifier of importClause) {
      const nameNode = specifier.childForFieldName('name');
      if (nameNode) {
        names.push(nameNode.text);
      }
    }

    // Check for default import
    const identifiers = node.descendantsOfType('identifier');
    if (identifiers.length > 0) {
      const firstId = identifiers[0];
      // If the identifier is a direct child of the import and not inside a named import block
      if (firstId.parent === node || firstId.parent?.type === 'import_clause') {
        const defaultName = firstId.text;
        if (defaultName && !names.includes(defaultName)) {
          names.unshift(defaultName);
        }
      }
    }

    imports.push({ module, names });
  }

  return imports;
}
