import type { ExtractionResult, LanguageConfig, TreeSitterNode } from './types.js';

export function extract(
  rootNode: TreeSitterNode,
  sourceCode: string,
  config: LanguageConfig,
): ExtractionResult {
  const sourceLines = sourceCode.split('\n');
  const items: ExtractionResult['items'] = [];
  const lines: ExtractionResult['lines'] = [];
  const methods: ExtractionResult['methods'] = [];
  const types: ExtractionResult['types'] = [];
  const headerComments: string[] = [];
  const imports: ExtractionResult['imports'] = [];

  let seenCode = false;
  const processedLines = new Set<number>();

  function setLineType(lineNumber: number, type: ExtractionResult['lines'][0]['type']): void {
    if (!processedLines.has(lineNumber)) {
      processedLines.add(lineNumber);
      lines.push({ lineNumber, type });
    }
  }

  function visit(node: TreeSitterNode): void {
    const lineNumber = node.startPosition.row + 1;

    // Comments
    if (config.commentNodes.has(node.type)) {
      if (!seenCode) {
        headerComments.push(
          node.text.replace(/^\/\/\s?|^\/\*\s?|\s?\*\/$/g, '').trim(),
        );
      }
      // Mark all lines spanned by this comment
      for (let row = node.startPosition.row; row <= node.endPosition.row; row++) {
        setLineType(row + 1, 'comment');
      }
      return; // don't recurse into comments
    }

    // Imports
    if (config.importNodes.has(node.type)) {
      const source = config.extractImportSource(node);
      if (source) {
        imports.push({ source, lineNumber });
      }
      setLineType(lineNumber, 'code');
      return;
    }

    // Type declarations
    if (config.typeNodes.has(node.type)) {
      seenCode = true;
      const typeInfo = config.extractTypeName(node);
      if (typeInfo) {
        types.push({ ...typeInfo, lineNumber });
        setLineType(lineNumber, 'struct');
        items.push({ term: typeInfo.name, lineNumber });
      }
    }

    // Method declarations
    if (config.methodNodes.has(node.type)) {
      seenCode = true;
      const methodInfo = config.extractMethodInfo(node, sourceLines);
      if (methodInfo) {
        methods.push({ ...methodInfo, lineNumber });
        setLineType(lineNumber, 'method');
        items.push({ term: methodInfo.name, lineNumber });
      }
    }

    // Property declarations
    if (config.propertyNodes.has(node.type)) {
      seenCode = true;
      setLineType(lineNumber, 'property');
    }

    // String literals — mark and skip
    if (config.stringNodes.has(node.type)) {
      setLineType(lineNumber, 'string');
      return; // don't extract identifiers from strings
    }

    // Leaf identifier nodes — extract terms
    if (node.childCount === 0 && node.type === 'identifier') {
      const term = node.text;
      if (term.length >= 2 && !config.isKeyword(term)) {
        items.push({ term, lineNumber });
      }
      if (!processedLines.has(lineNumber)) {
        setLineType(lineNumber, 'code');
      }
    }

    // Also extract type_identifier nodes (common in C#, Go, Java)
    if (node.childCount === 0 && node.type === 'type_identifier') {
      const term = node.text;
      if (term.length >= 2 && !config.isKeyword(term)) {
        items.push({ term, lineNumber });
      }
      if (!processedLines.has(lineNumber)) {
        setLineType(lineNumber, 'code');
      }
    }

    // Recurse into children
    for (let i = 0; i < node.childCount; i++) {
      visit(node.child(i));
    }
  }

  visit(rootNode);
  return { items, lines, methods, types, headerComments, imports };
}
