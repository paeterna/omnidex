const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'to', 'from', 'in', 'of', 'for', 'on', 'at', 'by',
  'with', 'as', 'it', 'its', 'that', 'this', 'which', 'what', 'how', 'why',
  'when', 'where', 'do', 'does', 'did', 'has', 'have', 'had', 'be', 'been',
  'are', 'was', 'were', 'can', 'could', 'should', 'would', 'will', 'shall',
  'may', 'might', 'must', 'not', 'no', 'and', 'or', 'but', 'if', 'then',
  'than', 'also', 'just', 'only', 'more', 'some', 'any', 'all', 'each',
  'every', 'both', 'few', 'many', 'much', 'very', 'too', 'so', 'up', 'out',
  'about', 'into', 'over', 'after', 'before', 'between', 'under', 'during',
  'through', 'above', 'below', 'being', 'having', 'doing', 'get', 'set',
  'add', 'remove', 'update', 'delete', 'create', 'make', 'fix', 'change',
  'modify', 'use', 'need', 'want', 'try', 'let', 'put',
  // Generic programming terms that flood results
  'new', 'old', 'file', 'files', 'field', 'fields', 'line', 'lines', 'code', 'value', 'values',
  'name', 'names', 'type', 'types', 'class', 'method', 'function', 'property', 'data',
  'list', 'item', 'items', 'error', 'result', 'results', 'test', 'tests', 'check',
  'show', 'display', 'page', 'view', 'model', 'service', 'module', 'config',
  'import', 'export', 'default', 'return', 'null', 'true', 'false', 'string', 'number',
  'boolean', 'object', 'array', 'map', 'key', 'id', 'index', 'count', 'size', 'length',
  'start', 'end', 'first', 'last', 'next', 'prev', 'current', 'parent', 'child',
  'open', 'close', 'read', 'write', 'load', 'save', 'send', 'receive',
  'enable', 'disable', 'hide', 'run', 'stop', 'init', 'setup',
  'handle', 'process', 'parse', 'format', 'convert', 'validate', 'render',
  'look', 'find', 'search', 'filter', 'sort', 'group', 'merge', 'split',
  'work', 'working', 'thing', 'things', 'way', 'part', 'point', 'case',
  'like', 'sure', 'know', 'think', 'going', 'here', 'there',
  'help', 'please', 'thanks', 'okay', 'right', 'wrong', 'good', 'bad',
  'implement', 'implementation', 'refactor', 'debug', 'issue', 'bug', 'feature',
]);

/**
 * Split camelCase/PascalCase into parts, returning both parts and the whole.
 * E.g. "DepartmentVersion" -> ["department", "version", "departmentversion"]
 */
function splitCamelCase(word: string): string[] {
  // Check if it has mixed case (camelCase or PascalCase)
  if (!/[a-z][A-Z]|[A-Z][a-z]/.test(word)) {
    return [word.toLowerCase()];
  }

  const parts = word
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .map((p) => p.toLowerCase())
    .filter((p) => p.length >= 2);

  const whole = word.toLowerCase();
  if (parts.length > 1) {
    return [...parts, whole];
  }
  return [whole];
}

/**
 * Detect file paths and extract meaningful segments.
 * E.g. "src/modules/auth.ts" -> ["src", "modules", "auth", "auth.ts"]
 */
function splitFilePath(token: string): string[] | null {
  if (!token.includes('/') && !token.includes('\\')) {
    return null;
  }

  const segments = token.split(/[/\\]/).filter(Boolean);
  const results: string[] = [];

  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (lower.length >= 2) {
      results.push(lower);
    }
    // Also add the name without extension
    const dotIdx = seg.lastIndexOf('.');
    if (dotIdx > 0) {
      const nameOnly = seg.substring(0, dotIdx).toLowerCase();
      if (nameOnly.length >= 2 && !results.includes(nameOnly)) {
        results.push(nameOnly);
      }
    }
  }

  return results.length > 0 ? results : null;
}

export function extractKeywords(query: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  function addUnique(term: string): void {
    if (term.length >= 2 && !STOP_WORDS.has(term) && !seen.has(term)) {
      seen.add(term);
      results.push(term);
    }
  }

  // Split on whitespace and punctuation (but preserve / and \ for path detection)
  const tokens = query.split(/[\s,;:!?'"()\[\]{}<>=+*&^%$#@|~`]+/).filter(Boolean);

  for (const token of tokens) {
    // Check if it's a file path
    const pathParts = splitFilePath(token);
    if (pathParts) {
      for (const part of pathParts) {
        addUnique(part);
      }
      continue;
    }

    // Split on dots and hyphens/underscores to get sub-tokens
    const subTokens = token.split(/[.\-_]+/).filter(Boolean);

    for (const sub of subTokens) {
      // Split camelCase/PascalCase
      const camelParts = splitCamelCase(sub);
      for (const part of camelParts) {
        addUnique(part);
      }
    }
  }

  return results;
}
