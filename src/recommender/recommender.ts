import type Database from 'better-sqlite3';
import { extractKeywords } from './keywords.js';

export interface Recommendation {
  ok: boolean;
  needs_project?: boolean;
  skip?: boolean;
  mode: 'memory_first' | 'graph_search' | 'bootstrap';
  confidence: 'high' | 'medium' | 'low';
  max_supplementary_greps: number;
  max_supplementary_files: number;
  recommended_files: Array<{ file: string; access_type: 'new' | 'read' | 'write'; score: number }>;
  query: string;
}

interface FileScore {
  fileId: number;
  path: string;
  score: number;
}

export function recommend(db: Database.Database, query: string, limit = 5): Recommendation {
  // Edge case: check if DB has files
  const fileCount = (db.prepare('SELECT COUNT(*) as cnt FROM files').get() as { cnt: number }).cnt;

  if (fileCount === 0) {
    return {
      ok: false,
      needs_project: true,
      mode: 'bootstrap',
      confidence: 'low',
      max_supplementary_greps: 3,
      max_supplementary_files: 3,
      recommended_files: [],
      query,
    };
  }

  if (fileCount < 5) {
    return {
      ok: true,
      skip: true,
      mode: 'bootstrap',
      confidence: 'high',
      max_supplementary_greps: 0,
      max_supplementary_files: 0,
      recommended_files: [],
      query,
    };
  }

  const keywords = extractKeywords(query);

  if (keywords.length === 0) {
    return {
      ok: true,
      mode: 'graph_search',
      confidence: 'low',
      max_supplementary_greps: 3,
      max_supplementary_files: 3,
      recommended_files: [],
      query,
    };
  }

  // Phase 1: Action memory
  const memoryResult = phaseActionMemory(db, keywords, limit);
  if (memoryResult) {
    return { ...memoryResult, query };
  }

  // Phase 2: Symbol search
  const scores = new Map<number, FileScore>();
  phaseSymbolSearch(db, keywords, scores);

  // Phase 3: Graph expansion
  phaseGraphExpansion(db, scores);

  // Sort and take top N
  const sorted = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  // Determine confidence
  const topScore = sorted.length > 0 ? sorted[0].score : 0;
  let confidence: 'high' | 'medium' | 'low';
  let maxGreps: number;
  let maxFiles: number;

  if (topScore >= 10) {
    confidence = 'high';
    maxGreps = 0;
    maxFiles = 0;
  } else if (topScore >= 4) {
    confidence = 'medium';
    maxGreps = 2;
    maxFiles = 2;
  } else {
    confidence = 'low';
    maxGreps = 3;
    maxFiles = 3;
  }

  // Determine access_type from recent actions
  const accessTypes = determineAccessTypes(db, sorted.map((s) => s.path));

  const recommended_files = sorted.map((s) => ({
    file: s.path,
    access_type: accessTypes.get(s.path) || ('new' as const),
    score: s.score,
  }));

  return {
    ok: true,
    mode: 'graph_search',
    confidence,
    max_supplementary_greps: maxGreps,
    max_supplementary_files: maxFiles,
    recommended_files,
    query,
  };
}

function phaseActionMemory(
  db: Database.Database,
  keywords: string[],
  limit: number,
): Omit<Recommendation, 'query'> | null {
  const actions = db.prepare('SELECT * FROM actions ORDER BY created_at DESC LIMIT 50').all() as Array<{
    id: number;
    action_type: string;
    query: string | null;
    files: string | null;
    created_at: number;
  }>;

  if (actions.length === 0) return null;

  const keywordSet = new Set(keywords);
  let bestScore = 0;
  let bestFiles: string[] = [];

  for (const action of actions) {
    if (!action.query || !action.files) continue;

    const actionKeywords = extractKeywords(action.query);
    const matchCount = actionKeywords.filter((k) => keywordSet.has(k)).length;
    const score = matchCount * 3;

    if (score > bestScore) {
      bestScore = score;
      try {
        bestFiles = JSON.parse(action.files);
      } catch {
        continue;
      }
    }
  }

  if (bestScore >= 6 && bestFiles.length > 0) {
    const accessTypes = determineAccessTypes(db, bestFiles);
    const recommended = bestFiles.slice(0, limit).map((file) => ({
      file,
      access_type: accessTypes.get(file) || ('new' as const),
      score: bestScore,
    }));

    return {
      ok: true,
      mode: 'memory_first',
      confidence: 'high',
      max_supplementary_greps: 0,
      max_supplementary_files: 0,
      recommended_files: recommended,
    };
  }

  return null;
}

function phaseSymbolSearch(
  db: Database.Database,
  keywords: string[],
  scores: Map<number, FileScore>,
): void {
  const itemSearch = db.prepare(`
    SELECT i.term, o.file_id, f.path
    FROM items i
    JOIN occurrences o ON i.id = o.item_id
    JOIN files f ON o.file_id = f.id
    WHERE i.term LIKE ?
  `);

  const typeSearch = db.prepare(`
    SELECT t.name, t.file_id, f.path
    FROM types t
    JOIN files f ON t.file_id = f.id
    WHERE LOWER(t.name) LIKE ?
  `);

  const methodSearch = db.prepare(`
    SELECT m.name, m.file_id, f.path
    FROM methods m
    JOIN files f ON m.file_id = f.id
    WHERE LOWER(m.name) LIKE ?
  `);

  const allFiles = db.prepare('SELECT id, path FROM files').all() as Array<{ id: number; path: string }>;

  for (const keyword of keywords) {
    // Item/occurrence search (contains mode)
    const pattern = `%${keyword}%`;
    const itemResults = itemSearch.all(pattern) as Array<{ term: string; file_id: number; path: string }>;

    for (const row of itemResults) {
      const entry = getOrCreate(scores, row.file_id, row.path);
      if (row.term.toLowerCase() === keyword) {
        entry.score += 10; // exact match
      } else {
        entry.score += 5; // contains match
      }
    }

    // Type name match bonus
    const typeResults = typeSearch.all(pattern) as Array<{ name: string; file_id: number; path: string }>;
    for (const row of typeResults) {
      const entry = getOrCreate(scores, row.file_id, row.path);
      entry.score += 8;
    }

    // Method name match bonus
    const methodResults = methodSearch.all(pattern) as Array<{ name: string; file_id: number; path: string }>;
    for (const row of methodResults) {
      const entry = getOrCreate(scores, row.file_id, row.path);
      entry.score += 6;
    }

    // File path contains keyword
    for (const file of allFiles) {
      if (file.path.toLowerCase().includes(keyword)) {
        const entry = getOrCreate(scores, file.id, file.path);
        entry.score += 3;
      }
    }
  }
}

function phaseGraphExpansion(
  db: Database.Database,
  scores: Map<number, FileScore>,
): void {
  const edgesFrom = db.prepare(`
    SELECT target_file_id, f.path FROM edges e
    JOIN files f ON e.target_file_id = f.id
    WHERE e.source_file_id = ?
  `);

  const edgesTo = db.prepare(`
    SELECT source_file_id, f.path FROM edges e
    JOIN files f ON e.source_file_id = f.id
    WHERE e.target_file_id = ?
  `);

  // Get top 5 files by score
  const top5 = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  for (const entry of top5) {
    // Files imported by this top file (this file imports them): +2
    const imported = edgesFrom.all(entry.fileId) as Array<{ target_file_id: number; path: string }>;
    for (const row of imported) {
      const target = getOrCreate(scores, row.target_file_id, row.path);
      target.score += 2;
    }

    // Files that import this top file (they depend on it): +3
    const importers = edgesTo.all(entry.fileId) as Array<{ source_file_id: number; path: string }>;
    for (const row of importers) {
      const source = getOrCreate(scores, row.source_file_id, row.path);
      source.score += 3;
    }
  }
}

function determineAccessTypes(
  db: Database.Database,
  filePaths: string[],
): Map<string, 'new' | 'read' | 'write'> {
  const result = new Map<string, 'new' | 'read' | 'write'>();
  if (filePaths.length === 0) return result;

  const actions = db.prepare('SELECT * FROM actions ORDER BY created_at DESC LIMIT 50').all() as Array<{
    action_type: string;
    query: string | null;
    files: string | null;
  }>;

  const pathSet = new Set(filePaths);

  for (const action of actions) {
    if (!action.files) continue;
    let actionFiles: string[];
    try {
      actionFiles = JSON.parse(action.files);
    } catch {
      continue;
    }

    for (const f of actionFiles) {
      if (!pathSet.has(f) || result.has(f)) continue;

      if (action.action_type === 'edit' || action.action_type === 'write') {
        result.set(f, 'write');
      } else if (action.action_type === 'read' || action.action_type === 'retrieve') {
        result.set(f, 'read');
      }
    }
  }

  return result;
}

function getOrCreate(scores: Map<number, FileScore>, fileId: number, path: string): FileScore {
  let entry = scores.get(fileId);
  if (!entry) {
    entry = { fileId, path, score: 0 };
    scores.set(fileId, entry);
  }
  return entry;
}
