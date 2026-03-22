import type { LanguageConfig, TreeSitterNode } from '../types.js';

const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'self', 'cls',
]);

export const pythonConfig: LanguageConfig = {
  commentNodes: new Set(['comment']),
  typeNodes: new Set(['class_definition']),
  methodNodes: new Set(['function_definition']),
  importNodes: new Set(['import_statement', 'import_from_statement']),
  stringNodes: new Set(['string', 'concatenated_string']),
  propertyNodes: new Set(),

  extractImportSource(node: TreeSitterNode): string | null {
    // import_statement: "import foo.bar"
    // import_from_statement: "from foo.bar import baz"
    if (node.type === 'import_from_statement') {
      const moduleNode = node.childForFieldName('module_name') ?? node.childForFieldName('module');
      if (moduleNode) return moduleNode.text;
      // Fallback: find dotted_name child
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' || child.type === 'relative_import') {
          return child.text;
        }
      }
    }
    if (node.type === 'import_statement') {
      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name' || child.type === 'aliased_import') {
          return child.text;
        }
      }
    }
    // Fallback
    const text = node.text
      .replace(/^from\s+/, '')
      .replace(/\s+import.*$/, '')
      .replace(/^import\s+/, '')
      .trim();
    return text || null;
  },

  extractTypeName(node: TreeSitterNode) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;
    return { name: nameNode.text, kind: 'class' as const };
  },

  extractMethodInfo(node: TreeSitterNode, sourceLines: string[]) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const isAsync = node.children.some((c) => c.text === 'async');

    const lineIdx = node.startPosition.row;
    const line = sourceLines[lineIdx]?.trim() ?? '';
    const prototype = line.replace(/:$/, '').trim();

    return { name, prototype, isAsync };
  },

  isKeyword(term: string): boolean {
    return KEYWORDS.has(term);
  },
};
