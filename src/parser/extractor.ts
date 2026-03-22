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
      // Extract identifier-like terms from comment text (domain terms, class names)
      const commentText = node.text;
      const identRegex = /\b([A-Z][a-zA-Z0-9]{2,})\b/g;
      let match;
      while ((match = identRegex.exec(commentText)) !== null) {
        const term = match[1];
        if (!config.isKeyword(term)) {
          items.push({ term, lineNumber });
        }
      }
      return; // don't recurse into comments
    }

    // Imports
    if (config.importNodes.has(node.type)) {
      const source = config.extractImportSource(node);
      if (source) {
        imports.push({ source, lineNumber });
        // Also extract identifiers from import path segments
        // e.g., "HRIS.Modules.HrMaster.Domain.Aggregates" → each segment as a term
        const segments = source.split(/[./\\]/);
        for (const seg of segments) {
          if (seg.length >= 2 && /^[A-Za-z_]/.test(seg) && !config.isKeyword(seg)) {
            items.push({ term: seg, lineNumber });
          }
        }
      }
      setLineType(lineNumber, 'code');
      // Don't return — still recurse into import nodes to capture identifiers
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
    if (node.childCount === 0 && (
      node.type === 'identifier' ||
      node.type === 'type_identifier' ||
      node.type === 'property_identifier' ||
      node.type === 'shorthand_property_identifier_pattern'
    )) {
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
