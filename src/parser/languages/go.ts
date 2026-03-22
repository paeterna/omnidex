import type { LanguageConfig, TreeSitterNode } from '../types.js';

const KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type',
  'var', 'nil', 'true', 'false', 'iota', 'append', 'cap', 'close', 'complex',
  'copy', 'delete', 'imag', 'len', 'make', 'new', 'panic', 'print', 'println',
  'real', 'recover',
]);

export const goConfig: LanguageConfig = {
  commentNodes: new Set(['comment']),
  typeNodes: new Set(['type_declaration']),
  methodNodes: new Set(['function_declaration', 'method_declaration']),
  importNodes: new Set(['import_declaration']),
  stringNodes: new Set(['raw_string_literal', 'interpreted_string_literal']),
  propertyNodes: new Set(['field_declaration']),

  extractImportSource(node: TreeSitterNode): string | null {
    // import_declaration may contain import_spec_list or a single import_spec
    // We'll just get the text and clean it up
    const text = node.text;
    // Single import: import "fmt"
    const singleMatch = text.match(/import\s+"([^"]+)"/);
    if (singleMatch) return singleMatch[1];
    // Multi-import: extract all quoted strings
    const matches = text.match(/"([^"]+)"/g);
    if (matches) return matches.map((m) => m.replace(/"/g, '')).join(', ');
    return null;
  },

  extractTypeName(node: TreeSitterNode) {
    // type_declaration can contain type_spec children
    for (const child of node.namedChildren) {
      if (child.type === 'type_spec') {
        const nameNode = child.childForFieldName('name');
        if (!nameNode) continue;

        const typeNode = child.childForFieldName('type');
        let kind: 'struct' | 'interface' | 'type' = 'type';
        if (typeNode) {
          if (typeNode.type === 'struct_type') kind = 'struct';
          else if (typeNode.type === 'interface_type') kind = 'interface';
        }
        return { name: nameNode.text, kind };
      }
    }
    return null;
  },

  extractMethodInfo(node: TreeSitterNode, sourceLines: string[]) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const lineIdx = node.startPosition.row;
    const line = sourceLines[lineIdx]?.trim() ?? '';
    const prototype = line.replace(/\s*\{.*$/, '').trim();

    // In Go, exported functions start with uppercase
    const visibility = name[0] === name[0].toUpperCase() ? 'public' : 'private';

    return { name, prototype, visibility };
  },

  isKeyword(term: string): boolean {
    return KEYWORDS.has(term);
  },
};
