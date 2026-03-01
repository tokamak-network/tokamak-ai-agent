export type DefinitionKind = 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'variable';

export interface CodeDefinition {
  kind: DefinitionKind;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;       // "function foo(bar: string): number"
  parentName?: string;     // for methods: class name
  exportType?: 'named' | 'default' | 'none';
}

export interface FileOutline {
  filePath: string;
  language: string;
  definitions: CodeDefinition[];
  imports: { module: string; names: string[] }[];
}
