import type { ExtractionResult } from '../types.js';

/**
 * Regex-based fallback extraction for unsupported languages.
 * Extracts identifiers and detects common patterns like class/function declarations.
 */
export function genericExtract(sourceCode: string, _filePath: string): ExtractionResult {
  const sourceLines = sourceCode.split('\n');
  const items: ExtractionResult['items'] = [];
  const lines: ExtractionResult['lines'] = [];
  const methods: ExtractionResult['methods'] = [];
  const types: ExtractionResult['types'] = [];
  const headerComments: string[] = [];
  const imports: ExtractionResult['imports'] = [];

  const seenTerms = new Set<string>();
  let seenCode = false;

  // Common comment patterns
  const lineCommentPattern = /^\s*(\/\/|#|--|;;)/;
  const blockCommentStart = /^\s*\/\*/;
  const blockCommentEnd = /\*\//;

  // Common declaration patterns
  const classPattern = /\b(?:class|struct|interface|enum)\s+([A-Z][a-zA-Z0-9_]*)/;
  const functionPattern = /\b(?:function|def|func|fn|fun|sub)\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

  // Identifier patterns
  const pascalCase = /\b([A-Z][a-zA-Z0-9_]+)\b/g;
  const camelCase = /\b([a-z][a-zA-Z0-9_]+)\b/g;

  let inBlockComment = false;

  for (let i = 0; i < sourceLines.length; i++) {
    const line = sourceLines[i];
    const lineNumber = i + 1;

    // Block comments
    if (inBlockComment) {
      if (!seenCode) {
        headerComments.push(line.replace(/^\s*\*\s?/, '').replace(/\s*\*\/\s*$/, '').trim());
      }
      lines.push({ lineNumber, type: 'comment' });
      if (blockCommentEnd.test(line)) {
        inBlockComment = false;
      }
      continue;
    }

    if (blockCommentStart.test(line)) {
      inBlockComment = true;
      if (!seenCode) {
        headerComments.push(line.replace(/^\s*\/\*\s?/, '').replace(/\s*\*\/\s*$/, '').trim());
      }
      lines.push({ lineNumber, type: 'comment' });
      if (blockCommentEnd.test(line)) {
        inBlockComment = false;
      }
      continue;
    }

    // Line comments
    if (lineCommentPattern.test(line)) {
      if (!seenCode) {
        headerComments.push(line.replace(/^\s*(\/\/|#|--|;;)\s?/, '').trim());
      }
      lines.push({ lineNumber, type: 'comment' });
      continue;
    }

    // Empty lines
    if (!line.trim()) continue;

    seenCode = true;

    // Check for class/struct/interface/enum
    const classMatch = classPattern.exec(line);
    if (classMatch) {
      const name = classMatch[1];
      const kindMatch = line.match(/\b(class|struct|interface|enum)\b/);
      const kindStr = kindMatch?.[1] ?? 'class';
      const kindMap: Record<string, 'class' | 'struct' | 'interface' | 'enum'> = {
        class: 'class', struct: 'struct', interface: 'interface', enum: 'enum',
      };
      types.push({ name, kind: kindMap[kindStr] ?? 'class', lineNumber });
      lines.push({ lineNumber, type: 'struct' });
      items.push({ term: name, lineNumber });
      seenTerms.add(name);
      continue;
    }

    // Check for function/method
    const funcMatch = functionPattern.exec(line);
    if (funcMatch) {
      const name = funcMatch[1];
      const prototype = line.trim().replace(/\s*\{.*$/, '').replace(/:$/, '').trim();
      methods.push({ name, prototype, lineNumber });
      lines.push({ lineNumber, type: 'method' });
      items.push({ term: name, lineNumber });
      seenTerms.add(name);
      continue;
    }

    // Extract identifiers
    lines.push({ lineNumber, type: 'code' });

    let match;
    pascalCase.lastIndex = 0;
    while ((match = pascalCase.exec(line)) !== null) {
      const term = match[1];
      if (term.length >= 2) {
        items.push({ term, lineNumber });
      }
    }

    camelCase.lastIndex = 0;
    while ((match = camelCase.exec(line)) !== null) {
      const term = match[1];
      if (term.length >= 2) {
        items.push({ term, lineNumber });
      }
    }
  }

  // Filter empty header comments
  const filteredHeaders = headerComments.filter((h) => h.length > 0);

  return { items, lines, methods, types, headerComments: filteredHeaders, imports };
}
