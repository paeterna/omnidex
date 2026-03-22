import type { LanguageConfig, TreeSitterNode } from '../types.js';

const KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'false', 'final', 'finally', 'float', 'for', 'goto', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'null', 'package', 'private', 'protected', 'public', 'return',
  'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
  'throw', 'throws', 'transient', 'true', 'try', 'void', 'volatile', 'while',
  'var', 'record', 'sealed', 'permits', 'yield',
]);

function getVisibility(node: TreeSitterNode): string | undefined {
  for (const child of node.children) {
    if (child.type === 'modifiers') {
      for (const mod of child.children) {
        if (['public', 'private', 'protected'].includes(mod.text)) {
          return mod.text;
        }
      }
    }
  }
  return undefined;
}

function hasModifier(node: TreeSitterNode, modifier: string): boolean {
  for (const child of node.children) {
    if (child.type === 'modifiers') {
      for (const mod of child.children) {
        if (mod.text === modifier) return true;
      }
    }
  }
  return false;
}

export const javaConfig: LanguageConfig = {
  commentNodes: new Set(['line_comment', 'block_comment']),
  typeNodes: new Set(['class_declaration', 'interface_declaration', 'enum_declaration']),
  methodNodes: new Set(['method_declaration', 'constructor_declaration']),
  importNodes: new Set(['import_declaration']),
  stringNodes: new Set(['string_literal']),
  propertyNodes: new Set(['field_declaration']),

  extractImportSource(node: TreeSitterNode): string | null {
    // import_declaration: "import foo.bar.Baz;"
    const text = node.text
      .replace(/^import\s+/, '')
      .replace(/\s*static\s+/, '')
      .replace(/;$/, '')
      .trim();
    return text || null;
  },

  extractTypeName(node: TreeSitterNode) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const kindMap: Record<string, 'class' | 'interface' | 'enum'> = {
      class_declaration: 'class',
      interface_declaration: 'interface',
      enum_declaration: 'enum',
    };
    const kind = kindMap[node.type];
    if (!kind) return null;

    return { name: nameNode.text, kind };
  },

  extractMethodInfo(node: TreeSitterNode, sourceLines: string[]) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const visibility = getVisibility(node);
    const isStatic = hasModifier(node, 'static');

    const lineIdx = node.startPosition.row;
    const line = sourceLines[lineIdx]?.trim() ?? '';
    const prototype = line.replace(/\s*\{.*$/, '').trim();

    return { name, prototype, visibility, isStatic };
  },

  isKeyword(term: string): boolean {
    return KEYWORDS.has(term);
  },
};
