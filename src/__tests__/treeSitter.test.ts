/**
 * Tree-sitter AST Integration Test
 *
 * 실제 wasm 파일을 로드하여 TypeScript/JavaScript 코드를 파싱하고
 * definition 추출, outline 생성이 제대로 동작하는지 검증합니다.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { TreeSitterService } from '../ast/treeSitterService.js';
import { DefinitionExtractor } from '../ast/definitionExtractor.js';

const PARSERS_DIR = path.join(__dirname, '..', '..', 'parsers');

// 테스트용 TypeScript 코드
const SAMPLE_TS_CODE = `
import { Router } from 'express';
import type { Request, Response } from 'express';

export interface UserConfig {
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export type UserId = string | number;

export class UserService {
  private users: Map<string, UserConfig> = new Map();

  async getUser(id: UserId): Promise<UserConfig | null> {
    return this.users.get(String(id)) ?? null;
  }

  async createUser(config: UserConfig): Promise<void> {
    this.users.set(config.name, config);
  }
}

export const validateEmail = (email: string): boolean => {
  return email.includes('@');
};

function internalHelper(data: string): string {
  return data.trim();
}

export enum UserRole {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}
`;

describe('Tree-sitter AST Integration', () => {
  let service: TreeSitterService;
  let extractor: DefinitionExtractor;
  let initialized: boolean;

  beforeAll(async () => {
    // 이전 테스트에서 남은 singleton 상태를 정리
    TreeSitterService.getInstance().dispose();

    // wasmDir 설정 후 초기화 — parsers/ 폴더에 wasm 파일이 있어야 동작
    TreeSitterService.setWasmDir(PARSERS_DIR);
    service = TreeSitterService.getInstance();
    await service.initialize();
    initialized = service.isInitialized();
    extractor = new DefinitionExtractor(service);
  });

  // ── 기본 초기화 ────────────────────────────────────────────

  it('should initialize tree-sitter with wasm files', () => {
    expect(initialized).toBe(true);
  });

  it('should map file extensions to languages', () => {
    expect(service.getLanguageFromExtension('.ts')).toBe('typescript');
    expect(service.getLanguageFromExtension('.js')).toBe('javascript');
    expect(service.getLanguageFromExtension('.py')).toBe('python');
    expect(service.getLanguageFromExtension('.go')).toBe('go');
    expect(service.getLanguageFromExtension('.rs')).toBeNull();
  });

  // ── 파싱 ───────────────────────────────────────────────────

  it('should parse TypeScript code into a syntax tree', async () => {
    if (!initialized) return;

    const tree = await service.parse(SAMPLE_TS_CODE, 'typescript');
    expect(tree).not.toBeNull();
    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.childCount).toBeGreaterThan(0);
  });

  it('should parse simple JavaScript code', async () => {
    if (!initialized) return;

    const jsCode = `function hello(name) { return "Hello " + name; }`;
    const tree = await service.parse(jsCode, 'javascript');
    expect(tree).not.toBeNull();
    expect(tree.rootNode.type).toBe('program');
  });

  // ── Definition 추출 ────────────────────────────────────────

  it('should extract all definition types from TypeScript', async () => {
    if (!initialized) return;

    const defs = await extractor.extractDefinitions(SAMPLE_TS_CODE, 'src/user.ts', 'typescript');

    const names = defs.map(d => d.name);
    expect(names).toContain('UserConfig');     // interface
    expect(names).toContain('UserId');         // type alias
    expect(names).toContain('UserService');    // class
    expect(names).toContain('getUser');        // method
    expect(names).toContain('createUser');     // method
    expect(names).toContain('validateEmail');  // arrow function variable
    expect(names).toContain('internalHelper'); // function
    expect(names).toContain('UserRole');       // enum
  });

  it('should correctly classify definition kinds', async () => {
    if (!initialized) return;

    const defs = await extractor.extractDefinitions(SAMPLE_TS_CODE, 'src/user.ts', 'typescript');
    const byName = new Map(defs.map(d => [d.name, d]));

    expect(byName.get('UserConfig')?.kind).toBe('interface');
    expect(byName.get('UserId')?.kind).toBe('type');
    expect(byName.get('UserService')?.kind).toBe('class');
    expect(byName.get('getUser')?.kind).toBe('method');
    expect(byName.get('validateEmail')?.kind).toBe('variable');
    expect(byName.get('internalHelper')?.kind).toBe('function');
    expect(byName.get('UserRole')?.kind).toBe('enum');
  });

  it('should detect export types (named / default / none)', async () => {
    if (!initialized) return;

    const defs = await extractor.extractDefinitions(SAMPLE_TS_CODE, 'src/user.ts', 'typescript');
    const byName = new Map(defs.map(d => [d.name, d]));

    expect(byName.get('UserConfig')?.exportType).toBe('named');
    expect(byName.get('UserService')?.exportType).toBe('named');
    expect(byName.get('validateEmail')?.exportType).toBe('named');
    expect(byName.get('internalHelper')?.exportType).toBe('none');
    expect(byName.get('UserRole')?.exportType).toBe('named');
  });

  it('should track parent class for methods', async () => {
    if (!initialized) return;

    const defs = await extractor.extractDefinitions(SAMPLE_TS_CODE, 'src/user.ts', 'typescript');
    const byName = new Map(defs.map(d => [d.name, d]));

    expect(byName.get('getUser')?.parentName).toBe('UserService');
    expect(byName.get('createUser')?.parentName).toBe('UserService');
    expect(byName.get('internalHelper')?.parentName).toBeUndefined();
  });

  it('should include line numbers', async () => {
    if (!initialized) return;

    const defs = await extractor.extractDefinitions(SAMPLE_TS_CODE, 'src/user.ts', 'typescript');
    for (const def of defs) {
      expect(def.startLine).toBeGreaterThan(0);
      expect(def.endLine).toBeGreaterThanOrEqual(def.startLine);
    }
  });

  // ── File Outline ───────────────────────────────────────────

  it('should generate a complete file outline with imports', async () => {
    if (!initialized) return;

    const outline = await extractor.getFileOutline(SAMPLE_TS_CODE, 'src/user.ts', 'typescript');

    expect(outline.filePath).toBe('src/user.ts');
    expect(outline.language).toBe('typescript');
    expect(outline.definitions.length).toBeGreaterThanOrEqual(7);
    expect(outline.imports.length).toBeGreaterThanOrEqual(1);

    // import 모듈 확인
    const modules = outline.imports.map(i => i.module);
    expect(modules).toContain('express');
  });

  // ── Prompt 포맷팅 ──────────────────────────────────────────

  it('should format outline for AI prompt', async () => {
    if (!initialized) return;

    const outline = await extractor.getFileOutline(SAMPLE_TS_CODE, 'src/user.ts', 'typescript');
    const formatted = extractor.formatOutlineForPrompt(outline);

    // 핵심 섹션들이 포함되어야 함
    expect(formatted).toContain('## src/user.ts (typescript)');
    expect(formatted).toContain('### Imports');
    expect(formatted).toContain('### Exports');
    expect(formatted).toContain('### Internal');

    // export된 항목들
    expect(formatted).toContain('interface UserConfig');
    expect(formatted).toContain('class UserService');
    expect(formatted).toContain('enum UserRole');

    // internal 항목
    expect(formatted).toContain('function internalHelper');

    console.log('\n=== Formatted Outline (AI Prompt) ===\n');
    console.log(formatted);
    console.log('\n=====================================\n');
  });

  // ── Graceful degradation ───────────────────────────────────

  it('should return null for unsupported languages', async () => {
    if (!initialized) return;

    const tree = await service.parse('fn main() {}', 'rust');
    expect(tree).toBeNull();
  });

  it('should return empty definitions for unsupported languages', async () => {
    if (!initialized) return;

    const defs = await extractor.extractDefinitions('fn main() {}', 'main.rs', 'rust');
    expect(defs).toEqual([]);
  });
});
