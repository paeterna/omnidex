import { createRequire } from 'module';
import { extract } from './extractor.js';
import { getLanguageConfig } from './languages/index.js';
import { genericExtract } from './languages/generic.js';
import type { ExtractionResult } from './types.js';

const require = createRequire(import.meta.url);

type ParserInstance = {
  setLanguage(lang: unknown): void;
  parse(source: string): { rootNode: unknown };
};

const parserCache = new Map<string, ParserInstance>();

function getParser(language: string): ParserInstance | null {
  if (parserCache.has(language)) return parserCache.get(language)!;

  try {
    const Parser = require('tree-sitter');
    const parser: ParserInstance = new Parser();
    let grammar: unknown;

    switch (language) {
      case 'csharp':
        grammar = require('tree-sitter-c-sharp');
        break;
      case 'typescript':
        grammar = require('tree-sitter-typescript').typescript;
        break;
      case 'javascript':
        grammar = require('tree-sitter-javascript');
        break;
      case 'python':
        grammar = require('tree-sitter-python');
        break;
      case 'java':
        grammar = require('tree-sitter-java');
        break;
      case 'go':
        grammar = require('tree-sitter-go');
        break;
      default:
        return null;
    }

    parser.setLanguage(grammar);
    parserCache.set(language, parser);
    return parser;
  } catch {
    return null;
  }
}

/** Detect language from file extension */
function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    cs: 'csharp',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    java: 'java',
    go: 'go',
  };
  return map[ext || ''] || null;
}

/**
 * Parse source code and extract symbols, methods, types, imports, and identifiers.
 * Uses tree-sitter for supported languages, falls back to regex-based extraction.
 */
export function parse(sourceCode: string, filePath: string): ExtractionResult | null {
  const language = detectLanguage(filePath);
  if (!language) {
    return genericExtract(sourceCode, filePath);
  }

  const config = getLanguageConfig(language);
  if (!config) {
    return genericExtract(sourceCode, filePath);
  }

  const parser = getParser(language);
  if (!parser) {
    return genericExtract(sourceCode, filePath);
  }

  const tree = parser.parse(sourceCode);
  return extract(tree.rootNode as any, sourceCode, config);
}
