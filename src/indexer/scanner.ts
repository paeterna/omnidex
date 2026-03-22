import { readdirSync, readFileSync, lstatSync } from 'fs';
import { join, relative, extname, basename } from 'path';
import { createHash } from 'crypto';
import ignore, { type Ignore } from 'ignore';

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  type: 'code' | 'config' | 'doc' | 'asset' | 'test' | 'other';
  language: string | null;
  hash: string;
}

const ALWAYS_SKIP = new Set([
  'node_modules', '.git', '.omnidex',
  'bin', 'obj', 'dist', '.vs', '.idea',
]);

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.cs': 'csharp',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.sql': 'sql',
};

const CONFIG_EXTENSIONS = new Set([
  '.json', '.yaml', '.yml', '.toml', '.xml', '.ini',
  '.env', '.editorconfig', '.eslintrc', '.prettierrc',
  '.csproj', '.sln', '.fsproj', '.props', '.targets',
]);

const CONFIG_FILENAMES = new Set([
  'Dockerfile',
]);

const CONFIG_PREFIXES = ['docker-compose'];

const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.adoc']);

const ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.pdf',
]);

const TEST_DIR_NAMES = new Set(['test', 'tests', '__tests__', 'spec']);

function detectLanguage(ext: string): string | null {
  return EXTENSION_TO_LANGUAGE[ext] ?? null;
}

function isTestFile(relativePath: string): boolean {
  const parts = relativePath.split('/');
  // Check if any directory in path is a test directory
  for (const part of parts) {
    if (TEST_DIR_NAMES.has(part)) return true;
  }
  // Check filename patterns: .test.*, .spec.*, _test.*
  const name = basename(relativePath);
  if (/\.(test|spec)\.[^.]+$/.test(name)) return true;
  if (/_test\.[^.]+$/.test(name)) return true;
  return false;
}

function classifyFile(relativePath: string, ext: string): { type: ScannedFile['type']; language: string | null } {
  const language = detectLanguage(ext);
  const name = basename(relativePath);

  // Test files take priority
  if (isTestFile(relativePath)) {
    return { type: 'test', language };
  }

  if (language) {
    return { type: 'code', language };
  }

  if (CONFIG_EXTENSIONS.has(ext) || CONFIG_FILENAMES.has(name) || CONFIG_PREFIXES.some(p => name.startsWith(p))) {
    return { type: 'config', language: null };
  }

  if (DOC_EXTENSIONS.has(ext)) {
    return { type: 'doc', language: null };
  }

  if (ASSET_EXTENSIONS.has(ext)) {
    return { type: 'asset', language: null };
  }

  return { type: 'other', language: null };
}

function isBinary(filePath: string): boolean {
  try {
    const fd = readFileSync(filePath, { flag: 'r' });
    const sample = fd.subarray(0, 512);
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return true;
    }
    return false;
  } catch {
    return true; // If we can't read it, treat as binary
  }
}

function computeHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function loadGitignore(projectPath: string): Ignore {
  const ig = ignore();
  try {
    const content = readFileSync(join(projectPath, '.gitignore'), 'utf-8');
    ig.add(content);
  } catch {
    // No .gitignore found, that's fine
  }
  return ig;
}

function buildExcludeFilter(patterns?: string[]): Ignore | null {
  if (!patterns || patterns.length === 0) return null;
  const ig = ignore();
  ig.add(patterns);
  return ig;
}

function walkDirectory(
  projectPath: string,
  currentPath: string,
  ig: Ignore,
  excludeIg: Ignore | null,
  results: ScannedFile[],
): void {
  let entries;
  try {
    entries = readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return; // Permission denied or other read error
  }

  for (const entry of entries) {
    const name = entry.name;

    // Skip always-skipped directories early
    if (ALWAYS_SKIP.has(name)) continue;

    const absPath = join(currentPath, name);
    const relPath = relative(projectPath, absPath);

    // Skip symlinks
    try {
      const stat = lstatSync(absPath);
      if (stat.isSymbolicLink()) continue;
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      // Check gitignore for directories (append trailing slash)
      const dirRel = relPath + '/';
      if (ig.ignores(dirRel)) continue;
      if (excludeIg && excludeIg.ignores(dirRel)) continue;

      walkDirectory(projectPath, absPath, ig, excludeIg, results);
    } else if (entry.isFile()) {
      // Check gitignore
      if (ig.ignores(relPath)) continue;
      if (excludeIg && excludeIg.ignores(relPath)) continue;

      // Skip binary files
      if (isBinary(absPath)) continue;

      const ext = extname(name).toLowerCase();
      const { type, language } = classifyFile(relPath, ext);
      const hash = computeHash(absPath);

      results.push({
        relativePath: relPath,
        absolutePath: absPath,
        type,
        language,
        hash,
      });
    }
  }
}

export async function scanProject(projectPath: string, exclude?: string[]): Promise<ScannedFile[]> {
  const ig = loadGitignore(projectPath);
  const excludeIg = buildExcludeFilter(exclude);
  const results: ScannedFile[] = [];

  walkDirectory(projectPath, projectPath, ig, excludeIg, results);

  return results;
}
