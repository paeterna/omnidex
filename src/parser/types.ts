export interface ExtractionResult {
  items: Array<{ term: string; lineNumber: number }>;
  lines: Array<{
    lineNumber: number;
    type: 'code' | 'comment' | 'struct' | 'method' | 'property' | 'string';
  }>;
  methods: Array<{
    name: string;
    prototype: string;
    lineNumber: number;
    visibility?: string;
    isStatic?: boolean;
    isAsync?: boolean;
  }>;
  types: Array<{
    name: string;
    kind: 'class' | 'struct' | 'interface' | 'enum' | 'type';
    lineNumber: number;
  }>;
  headerComments: string[];
  imports: Array<{ source: string; lineNumber: number }>;
}

export interface TreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  child(index: number): TreeSitterNode;
  childForFieldName(name: string): TreeSitterNode | null;
  children: TreeSitterNode[];
  namedChildren: TreeSitterNode[];
}

export interface LanguageConfig {
  commentNodes: Set<string>;
  typeNodes: Set<string>;
  methodNodes: Set<string>;
  importNodes: Set<string>;
  stringNodes: Set<string>;
  propertyNodes: Set<string>;
  extractImportSource: (node: TreeSitterNode) => string | null;
  extractTypeName: (
    node: TreeSitterNode,
  ) => { name: string; kind: 'class' | 'struct' | 'interface' | 'enum' | 'type' } | null;
  extractMethodInfo: (
    node: TreeSitterNode,
    sourceLines: string[],
  ) => {
    name: string;
    prototype: string;
    visibility?: string;
    isStatic?: boolean;
    isAsync?: boolean;
  } | null;
  isKeyword: (term: string) => boolean;
}
