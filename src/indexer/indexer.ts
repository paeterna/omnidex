import { readFileSync } from 'fs';
import { extname, dirname, join, resolve, normalize } from 'path';
import { createHash } from 'crypto';
import { openDatabase } from '../db/database.js';
import { createQueries } from '../db/queries.js';
import { scanProject } from './scanner.js';
import { parse } from '../parser/parser.js';
import type { ExtractionResult } from '../parser/types.js';
import type Database from 'better-sqlite3';

export interface IndexResult {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  duration: number;
  errors: number;
}

interface FileRecord {
  id: number;
  path: string;
  hash: string;
  last_indexed: number;
}

export async function indexProject(
  projectPath: string,
  options?: { exclude?: string[] },
): Promise<IndexResult> {
  const start = Date.now();
  const db = openDatabase(projectPath);
  const q = createQueries(db);

  let indexedFiles = 0;
  let skippedFiles = 0;
  let errors = 0;

  // 1. Scan all files
  const scannedFiles = await scanProject(projectPath, options?.exclude);
  const totalFiles = scannedFiles.length;

  // 2. Get existing files from DB for change detection
  const existingFiles = q.getAllFiles.all() as FileRecord[];
  const existingByPath = new Map<string, FileRecord>();
  for (const f of existingFiles) {
    existingByPath.set(f.path, f);
  }

  // Track scanned paths for removal detection
  const scannedPaths = new Set<string>();

  // Collect imports per file for edge building after all files are indexed
  const fileImports = new Map<number, { filePath: string; imports: ExtractionResult['imports'] }>();

  // 3. Process all files in a transaction
  const processAll = db.transaction(() => {
    for (let i = 0; i < scannedFiles.length; i++) {
      const file = scannedFiles[i];
      scannedPaths.add(file.relativePath);

      const ext = extname(file.relativePath).toLowerCase();

      // Insert into project_files
      q.insertProjectFile.run(file.relativePath, file.type, ext, 0);

      // Only parse files with a detected language (code + test files)
      if (!file.language) {
        skippedFiles++;
        continue;
      }
      if (file.type !== 'code' && file.type !== 'test') {
        skippedFiles++;
        continue;
      }

      // Check hash — skip if unchanged
      const existing = existingByPath.get(file.relativePath);
      if (existing && existing.hash === file.hash) {
        skippedFiles++;
        // Still collect imports for edge building if file already in DB
        // We'll re-parse these later if needed, but skip for now
        continue;
      }

      try {
        const sourceCode = readFileSync(file.absolutePath, 'utf-8');
        const result = parse(sourceCode, file.relativePath);

        if (!result) {
          skippedFiles++;
          continue;
        }

        const now = Date.now();

        // Delete old data if file existed
        if (existing) {
          q.deleteOccurrencesByFile.run(existing.id);
          q.deleteLinesByFile.run(existing.id);
          q.deleteMethodsByFile.run(existing.id);
          q.deleteTypesByFile.run(existing.id);
          q.deleteEdgesByFile.run(existing.id);
          q.deleteFile.run(existing.id);
        }

        // Insert file record
        q.insertFile.run(file.relativePath, file.hash, now);
        const fileRow = q.getFileByPath.get(file.relativePath) as FileRecord;
        const fileId = fileRow.id;

        // Insert lines
        insertLines(q, fileId, result);

        // Insert items + occurrences
        insertItemsAndOccurrences(q, fileId, result);

        // Insert methods
        for (const method of result.methods) {
          q.insertMethod.run(
            fileId,
            method.name,
            method.prototype,
            method.lineNumber,
            method.visibility ?? null,
            method.isStatic ? 1 : 0,
            method.isAsync ? 1 : 0,
          );
        }

        // Insert types
        for (const type of result.types) {
          q.insertType.run(fileId, type.name, type.kind, type.lineNumber);
        }

        // Insert signature (header comments)
        if (result.headerComments.length > 0) {
          q.insertSignature.run(fileId, result.headerComments.join('\n'));
        }

        // Mark as indexed in project_files
        q.insertProjectFile.run(file.relativePath, file.type, ext, 1);

        // Collect imports for edge building
        if (result.imports.length > 0) {
          fileImports.set(fileId, { filePath: file.relativePath, imports: result.imports });
        }

        indexedFiles++;
      } catch (err) {
        process.stderr.write(`Error indexing ${file.relativePath}: ${err}\n`);
        errors++;
      }

      // Progress logging
      if ((i + 1) % 100 === 0) {
        process.stderr.write(`Indexed ${i + 1}/${totalFiles} files...\n`);
      }
    }

    // 4. Build edges from collected imports
    buildEdges(db, q, fileImports);

    // 5. Clean up removed files
    for (const existing of existingFiles) {
      if (!scannedPaths.has(existing.path)) {
        q.deleteOccurrencesByFile.run(existing.id);
        q.deleteLinesByFile.run(existing.id);
        q.deleteMethodsByFile.run(existing.id);
        q.deleteTypesByFile.run(existing.id);
        q.deleteEdgesByFile.run(existing.id);
        q.deleteFile.run(existing.id);
      }
    }

    // 6. Store metadata
    const projectName = projectPath.split('/').pop() || 'unknown';
    q.setMetadata.run('project_name', projectName);
    q.setMetadata.run('last_indexed', String(Date.now()));
    q.setMetadata.run('total_files', String(totalFiles));
    q.setMetadata.run('indexed_files', String(indexedFiles));
  });

  processAll();
  db.close();

  const duration = Date.now() - start;
  process.stderr.write(
    `Indexing complete: ${indexedFiles} indexed, ${skippedFiles} skipped, ${errors} errors in ${duration}ms\n`,
  );

  return { totalFiles, indexedFiles, skippedFiles, duration, errors };
}

export async function updateFile(
  projectPath: string,
  filePath: string,
): Promise<void> {
  const db = openDatabase(projectPath);
  const q = createQueries(db);

  try {
    const absolutePath = resolve(projectPath, filePath);
    const content = readFileSync(absolutePath, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');

    // Check if hash unchanged
    const existing = q.getFileByPath.get(filePath) as FileRecord | undefined;
    if (existing && existing.hash === hash) {
      return;
    }

    const result = parse(content, filePath);
    if (!result) return;

    const doUpdate = db.transaction(() => {
      const now = Date.now();

      // Delete old data
      if (existing) {
        q.deleteOccurrencesByFile.run(existing.id);
        q.deleteLinesByFile.run(existing.id);
        q.deleteMethodsByFile.run(existing.id);
        q.deleteTypesByFile.run(existing.id);
        q.deleteEdgesByFile.run(existing.id);
        q.deleteFile.run(existing.id);
      }

      // Insert new file record
      q.insertFile.run(filePath, hash, now);
      const fileRow = q.getFileByPath.get(filePath) as FileRecord;
      const fileId = fileRow.id;

      // Insert parsed data
      insertLines(q, fileId, result);
      insertItemsAndOccurrences(q, fileId, result);

      for (const method of result.methods) {
        q.insertMethod.run(
          fileId,
          method.name,
          method.prototype,
          method.lineNumber,
          method.visibility ?? null,
          method.isStatic ? 1 : 0,
          method.isAsync ? 1 : 0,
        );
      }

      for (const type of result.types) {
        q.insertType.run(fileId, type.name, type.kind, type.lineNumber);
      }

      if (result.headerComments.length > 0) {
        q.insertSignature.run(fileId, result.headerComments.join('\n'));
      }

      // Re-resolve edges for this file
      resolveEdgesForFile(db, q, fileId, filePath, result.imports);
    });

    doUpdate();
  } finally {
    db.close();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function insertLines(
  q: ReturnType<typeof createQueries>,
  fileId: number,
  result: ExtractionResult,
): void {
  let lineCounter = 1;
  for (const line of result.lines) {
    q.insertLine.run(lineCounter, fileId, line.lineNumber, line.type, null, 0);
    lineCounter++;
  }
}

function insertItemsAndOccurrences(
  q: ReturnType<typeof createQueries>,
  fileId: number,
  result: ExtractionResult,
): void {
  // Build a map from lineNumber to line ID for occurrence linking
  const lineNumberToId = new Map<number, number>();
  let lineCounter = 1;
  for (const line of result.lines) {
    lineNumberToId.set(line.lineNumber, lineCounter);
    lineCounter++;
  }

  for (const item of result.items) {
    // INSERT OR IGNORE (dedup by term)
    q.insertItem.run(item.term);
    const itemRow = q.getItemByTerm.get(item.term) as { id: number } | undefined;
    if (!itemRow) continue;

    // Find the closest line ID for this item
    const lineId = lineNumberToId.get(item.lineNumber);
    if (lineId != null) {
      q.insertOccurrence.run(itemRow.id, fileId, lineId);
    }
  }
}

function buildEdges(
  db: Database.Database,
  q: ReturnType<typeof createQueries>,
  fileImports: Map<number, { filePath: string; imports: ExtractionResult['imports'] }>,
): void {
  if (fileImports.size === 0) return;

  // Build lookup tables once
  const allFiles = q.getAllFiles.all() as FileRecord[];
  const filesByPath = new Map<string, number>();
  for (const f of allFiles) {
    filesByPath.set(f.path, f.id);
  }

  const allTypes = db
    .prepare('SELECT t.name, t.file_id FROM types t')
    .all() as Array<{ name: string; file_id: number }>;
  const typeNameToFileIds = new Map<string, number[]>();
  for (const t of allTypes) {
    const existing = typeNameToFileIds.get(t.name) || [];
    existing.push(t.file_id);
    typeNameToFileIds.set(t.name, existing);
  }

  // Resolve imports for each file
  for (const [fileId, { filePath, imports }] of fileImports) {
    for (const imp of imports) {
      const targetId = resolveImport(imp.source, filePath, filesByPath, typeNameToFileIds);
      if (targetId != null && targetId !== fileId) {
        q.insertEdge.run(fileId, targetId, 'imports', 1);
      }
    }
  }
}

function resolveEdgesForFile(
  db: Database.Database,
  q: ReturnType<typeof createQueries>,
  fileId: number,
  filePath: string,
  imports: ExtractionResult['imports'],
): void {
  const allFiles = q.getAllFiles.all() as FileRecord[];
  const filesByPath = new Map<string, number>();
  for (const f of allFiles) {
    filesByPath.set(f.path, f.id);
  }

  const allTypes = db
    .prepare('SELECT t.name, t.file_id FROM types t')
    .all() as Array<{ name: string; file_id: number }>;
  const typeNameToFileIds = new Map<string, number[]>();
  for (const t of allTypes) {
    const existing = typeNameToFileIds.get(t.name) || [];
    existing.push(t.file_id);
    typeNameToFileIds.set(t.name, existing);
  }

  for (const imp of imports) {
    const targetId = resolveImport(imp.source, filePath, filesByPath, typeNameToFileIds);
    if (targetId != null && targetId !== fileId) {
      q.insertEdge.run(fileId, targetId, 'imports', 1);
    }
  }
}

function resolveImport(
  importSource: string,
  currentFilePath: string,
  filesByPath: Map<string, number>,
  typeNameToFileIds: Map<string, number[]>,
): number | null {
  // TypeScript/JavaScript relative imports
  if (importSource.startsWith('.')) {
    const dir = dirname(currentFilePath);
    const resolved = normalize(join(dir, importSource));

    // Try exact match, then with extensions
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
    for (const ext of extensions) {
      const candidate = resolved + ext;
      const id = filesByPath.get(candidate);
      if (id != null) return id;
    }
    return null;
  }

  // C# using directives: `using X.Y.Z`
  if (importSource.includes('.')) {
    const segments = importSource.split('.');
    const lastSegment = segments[segments.length - 1];
    const lastTwo = segments.length >= 2
      ? segments[segments.length - 2] + '.' + segments[segments.length - 1]
      : null;

    // Check types table for matching type name
    const typeFiles = typeNameToFileIds.get(lastSegment);
    if (typeFiles && typeFiles.length > 0) {
      return typeFiles[0];
    }

    // Check file paths for matching segments
    for (const [path, id] of filesByPath) {
      if (path.includes(lastSegment)) {
        return id;
      }
      if (lastTwo && path.includes(lastTwo.replace('.', '/'))) {
        return id;
      }
    }
  }

  return null;
}
