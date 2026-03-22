import type { LanguageConfig, TreeSitterNode } from '../types.js';

const KEYWORDS = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var',
  'void', 'while', 'with', 'yield', 'const', 'class', 'enum', 'interface',
  'type', 'async', 'await', 'of', 'from', 'as', 'implements', 'private',
  'protected', 'public', 'static', 'readonly',
]);

function getVisibility(node: TreeSitterNode): string | undefined {
  for (const child of node.children) {
    const text = child.text;
    if (['public', 'private', 'protected'].includes(text) &&
        (child.type === 'accessibility_modifier' || child.type.includes('modifier'))) {
      return text;
    }
  }
  return undefined;
}

export const typescriptConfig: LanguageConfig = {
  commentNodes: new Set(['comment', 'jsx_comment']),
  typeNodes: new Set([
    'class_declaration', 'interface_declaration',
    'type_alias_declaration', 'enum_declaration',
  ]),
  methodNodes: new Set(['method_definition', 'function_declaration', 'arrow_function']),
  importNodes: new Set(['import_statement']),
  stringNodes: new Set(['string', 'template_string']),
  propertyNodes: new Set(['property_signature', 'public_field_definition']),

  extractImportSource(node: TreeSitterNode): string | null {
    // import_statement contains a string child with the module path
    for (const child of node.namedChildren) {
      if (child.type === 'string' || child.type === 'string_literal') {
        // Strip quotes
        return child.text.replace(/^['"`]|['"`]$/g, '');
      }
    }
    // Fallback: find source child
    const source = node.childForFieldName('source');
    if (source) return source.text.replace(/^['"`]|['"`]$/g, '');
    return null;
  },

  extractTypeName(node: TreeSitterNode) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const kindMap: Record<string, 'class' | 'interface' | 'enum' | 'type'> = {
      class_declaration: 'class',
      interface_declaration: 'interface',
      type_alias_declaration: 'type',
      enum_declaration: 'enum',
    };
    const kind = kindMap[node.type];
    if (!kind) return null;

    return { name: nameNode.text, kind };
  },

  extractMethodInfo(node: TreeSitterNode, sourceLines: string[]) {
    // For arrow_function, only extract if it has a named parent (variable declarator)
    if (node.type === 'arrow_function') {
      // Arrow functions are only interesting if assigned to a variable
      // The parent would be a variable_declarator with a name field
      return null; // We'll handle named arrow functions via the variable_declarator's name
    }

    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = nameNode.text;
    const visibility = getVisibility(node);
    const isStatic = node.children.some(
      (c) => c.text === 'static' && (c.type === 'static' || c.type.includes('modifier')),
    );
    const isAsync = node.children.some(
      (c) => c.text === 'async',
    );

    const lineIdx = node.startPosition.row;
    const line = sourceLines[lineIdx]?.trim() ?? '';
    const prototype = line.replace(/\s*\{.*$/, '').replace(/\s*=>.*$/, '').trim();

    return { name, prototype, visibility, isStatic, isAsync };
  },

  isKeyword(term: string): boolean {
    return KEYWORDS.has(term);
  },
};
