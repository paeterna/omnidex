import type { LanguageConfig, TreeSitterNode } from '../types.js';

const KEYWORDS = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char',
  'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate',
  'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false',
  'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit',
  'in', 'int', 'interface', 'internal', 'is', 'lock', 'long', 'namespace',
  'new', 'null', 'object', 'operator', 'out', 'override', 'params', 'private',
  'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed',
  'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked',
  'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while', 'var',
  'async', 'await', 'get', 'set', 'value', 'partial', 'where', 'yield', 'record',
]);

function getVisibility(node: TreeSitterNode): string | undefined {
  for (const child of node.children) {
    if (child.type === 'modifier' || child.type.endsWith('_modifier')) {
      const text = child.text;
      if (['public', 'private', 'protected', 'internal'].includes(text)) {
        return text;
      }
    }
  }
  return undefined;
}

function hasModifier(node: TreeSitterNode, modifier: string): boolean {
  for (const child of node.children) {
    if ((child.type === 'modifier' || child.type.endsWith('_modifier')) && child.text === modifier) {
      return true;
    }
  }
  return false;
}

export const csharpConfig: LanguageConfig = {
  commentNodes: new Set(['comment', 'xml_documentation_comment']),
  typeNodes: new Set([
    'class_declaration', 'struct_declaration', 'interface_declaration',
    'enum_declaration', 'record_declaration',
  ]),
  methodNodes: new Set(['method_declaration', 'constructor_declaration']),
  importNodes: new Set(['using_directive']),
  stringNodes: new Set(['string_literal', 'interpolated_string_expression']),
  propertyNodes: new Set(['property_declaration']),

  extractImportSource(node: TreeSitterNode): string | null {
    // using_directive → "using" <qualified_name> ";"
    const nameNode = node.childForFieldName('name') ?? node.childForFieldName('type');
    if (nameNode) return nameNode.text;
    // Fallback: strip "using" and ";"
    const text = node.text.replace(/^using\s+/, '').replace(/;$/, '').trim();
    return text || null;
  },

  extractTypeName(node: TreeSitterNode) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const kindMap: Record<string, 'class' | 'struct' | 'interface' | 'enum' | 'type'> = {
      class_declaration: 'class',
      struct_declaration: 'struct',
      interface_declaration: 'interface',
      enum_declaration: 'enum',
      record_declaration: 'class',
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
    const isAsync = hasModifier(node, 'async');

    // Build prototype from the source line
    const lineIdx = node.startPosition.row;
    const line = sourceLines[lineIdx]?.trim() ?? '';
    // Take up to the opening brace or =>
    const prototype = line.replace(/\s*\{.*$/, '').replace(/\s*=>.*$/, '').trim();

    return { name, prototype, visibility, isStatic, isAsync };
  },

  isKeyword(term: string): boolean {
    return KEYWORDS.has(term);
  },
};
