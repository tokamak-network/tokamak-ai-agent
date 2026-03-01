/**
 * Copy tree-sitter WASM files into parsers/ for extension packaging.
 *
 * Sources:
 *   - web-tree-sitter.wasm        → core runtime
 *   - tree-sitter-{lang}.wasm     → language grammars (from tree-sitter-wasms)
 */

import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dest = join(root, 'parsers');

mkdirSync(dest, { recursive: true });

// Core runtime (name varies by version: tree-sitter.wasm or web-tree-sitter.wasm)
const candidates = ['tree-sitter.wasm', 'web-tree-sitter.wasm'];
let coreCopied = false;
for (const name of candidates) {
    const src = join(root, 'node_modules', 'web-tree-sitter', name);
    if (existsSync(src)) {
        cpSync(src, join(dest, name));
        console.log(`  ✓ ${name}`);
        coreCopied = true;
        break;
    }
}
if (!coreCopied) {
    console.warn('  ✗ core wasm not found (tried: ' + candidates.join(', ') + ')');
}

// Language grammars
const languages = ['typescript', 'javascript', 'python', 'go'];
const wasmSrc = join(root, 'node_modules', 'tree-sitter-wasms', 'out');

for (const lang of languages) {
    const name = `tree-sitter-${lang}.wasm`;
    const src = join(wasmSrc, name);
    if (existsSync(src)) {
        cpSync(src, join(dest, name));
        console.log(`  ✓ ${name}`);
    } else {
        console.warn(`  ✗ ${name} not found`);
    }
}

console.log('Done.');
