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
  matchedKeywords: Set<string>;
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

  // Phase 4: Conjunction bonus — files matching more unique keywords get a multiplier
  // This ensures "API endpoint for departments" ranks files with both "api" AND "departments"
  // above files that only match "api" heavily
  if (keywords.length >= 2) {
    // Only count non-compound keywords (the original query terms, not generated compounds)
    // Compounds like "departmentversion" are derived, not independent signals
    const primaryKeywordCount = keywords.filter((k) => !keywords.some((other) => other !== k && k.includes(other) && k.length > other.length)).length;
    const minKeywords = Math.max(2, primaryKeywordCount);

    for (const entry of scores.values()) {
      const matchRatio = entry.matchedKeywords.size / minKeywords;
      if (matchRatio >= 0.8) {
        // Matches almost all keywords — strong conjunction bonus
        entry.score = Math.round(entry.score * 1.5);
      } else if (matchRatio >= 0.5) {
        // Matches at least half — moderate bonus
        entry.score = Math.round(entry.score * 1.2);
      }
      // Files matching < 50% of keywords get no bonus (their base score stands)
    }
  }

  // Phase 5: Apply test file penalty — test files are useful but should rank below source files
  // unless the query explicitly mentions "test"
  const queryMentionsTest = keywords.some((k) => k === 'test' || k === 'tests' || k === 'testing' || k === 'spec');
  if (!queryMentionsTest) {
    for (const entry of scores.values()) {
      const lowerPath = entry.path.toLowerCase();
      if (
        lowerPath.startsWith('tests/') ||
        lowerPath.startsWith('test/') ||
        lowerPath.includes('/tests/') ||
        lowerPath.includes('/test/') ||
        lowerPath.includes('/__tests__/') ||
        lowerPath.includes('/spec/') ||
        /\.(test|spec)\.[^/]+$/.test(lowerPath) ||
        lowerPath.endsWith('tests.cs') ||
        lowerPath.endsWith('test.cs') ||
        lowerPath.endsWith('.spec.ts')
      ) {
        entry.score = Math.round(entry.score * 0.3); // 70% penalty
      }
    }
  }

  // Sort and take top N
  const sorted = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  // Determine confidence
  const topScore = sorted.length > 0 ? sorted[0].score : 0;
  let confidence: 'high' | 'medium' | 'low';
  let maxGreps: number;
  let maxFiles: number;

  if (topScore >= 20) {
    confidence = 'high';
    maxGreps = 0;
    maxFiles = 0;
  } else if (topScore >= 8) {
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
  // Only check very recent actions (last 5 minutes) to avoid stale cache pollution
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const actions = db.prepare('SELECT * FROM actions WHERE created_at > ? ORDER BY created_at DESC LIMIT 20').all(fiveMinutesAgo) as Array<{
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
  let bestMatchRatio = 0;

  for (const action of actions) {
    if (!action.query || !action.files) continue;

    const actionKeywords = extractKeywords(action.query);
    if (actionKeywords.length === 0) continue;

    const matchCount = actionKeywords.filter((k) => keywordSet.has(k)).length;
    // Require high overlap ratio (>= 70% of keywords must match), not just raw count
    const matchRatio = matchCount / Math.max(keywords.length, actionKeywords.length);
    const score = matchCount * 3;

    if (score > bestScore && matchRatio > bestMatchRatio) {
      bestScore = score;
      bestMatchRatio = matchRatio;
      try {
        bestFiles = JSON.parse(action.files);
      } catch {
        continue;
      }
    }
  }

  // Require both high score AND high match ratio to use cached results
  if (bestScore >= 9 && bestMatchRatio >= 0.7 && bestFiles.length > 0) {
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
  const totalFiles = (db.prepare('SELECT COUNT(*) as c FROM files').get() as any).c;

  // Pre-compute: for each keyword, find matching items with file counts (for IDF)
  const itemFileCount = db.prepare(`
    SELECT COUNT(DISTINCT o.file_id) as file_count
    FROM items i
    JOIN occurrences o ON i.id = o.item_id
    WHERE i.term LIKE ? COLLATE NOCASE
  `);

  // Get unique files per keyword (not per occurrence!)
  // Use a larger limit to avoid truncating results for common keywords
  const itemFileSearch = db.prepare(`
    SELECT DISTINCT o.file_id, f.path, i.term
    FROM items i
    JOIN occurrences o ON i.id = o.item_id
    JOIN files f ON o.file_id = f.id
    WHERE i.term LIKE ? COLLATE NOCASE
    LIMIT 500
  `);

  const typeSearch = db.prepare(`
    SELECT t.name, t.kind, t.file_id, f.path
    FROM types t
    JOIN files f ON t.file_id = f.id
    WHERE t.name LIKE ? COLLATE NOCASE
  `);

  const methodSearch = db.prepare(`
    SELECT m.name, m.file_id, f.path
    FROM methods m
    JOIN files f ON m.file_id = f.id
    WHERE m.name LIKE ? COLLATE NOCASE
  `);

  for (const keyword of keywords) {
    const pattern = `%${keyword}%`;

    // Calculate IDF for this keyword
    const docFreq = (itemFileCount.get(pattern) as any)?.file_count || 1;
    const idf = Math.log(totalFiles / Math.max(docFreq, 1)) + 1; // +1 to avoid zero for very common terms
    // Clamp IDF: minimum 0.5 (very common), maximum 5 (very rare)
    const idfWeight = Math.max(0.5, Math.min(5, idf));

    // 1. Type name match — highest signal (+20 * idf for exact, +12 * idf for contains)
    const typeResults = typeSearch.all(pattern) as Array<{ name: string; kind: string; file_id: number; path: string }>;
    for (const row of typeResults) {
      const entry = getOrCreate(scores, row.file_id, row.path);
      const isExact = row.name.toLowerCase() === keyword.toLowerCase();
      entry.score += Math.round((isExact ? 20 : 12) * idfWeight);
      entry.matchedKeywords.add(keyword);
    }

    // 2. Method name match — second highest signal (+15 * idf for exact, +8 * idf for contains)
    const methodResults = methodSearch.all(pattern) as Array<{ name: string; file_id: number; path: string }>;
    for (const row of methodResults) {
      const entry = getOrCreate(scores, row.file_id, row.path);
      const isExact = row.name.toLowerCase() === keyword.toLowerCase();
      entry.score += Math.round((isExact ? 15 : 8) * idfWeight);
      entry.matchedKeywords.add(keyword);
    }

    // 3. Item/symbol search — DISTINCT by file, weighted by IDF
    // Score = 3 * idf per unique file that contains this keyword in any symbol
    const itemResults = itemFileSearch.all(pattern) as Array<{ file_id: number; path: string; term: string }>;
    // Deduplicate by file_id (the DISTINCT in SQL should handle this but be safe)
    const seenFiles = new Set<number>();
    for (const row of itemResults) {
      if (seenFiles.has(row.file_id)) continue;
      seenFiles.add(row.file_id);
      const entry = getOrCreate(scores, row.file_id, row.path);
      const isExact = row.term.toLowerCase() === keyword.toLowerCase();
      entry.score += Math.round((isExact ? 5 : 3) * idfWeight);
      entry.matchedKeywords.add(keyword);
    }

    // 4. File path match — only if keyword is >= 4 chars (skip short generic words)
    if (keyword.length >= 4) {
      // Use a targeted query instead of scanning all files
      const pathResults = db.prepare(`
        SELECT id, path FROM files WHERE LOWER(path) LIKE ? LIMIT 50
      `).all(`%${keyword}%`) as Array<{ id: number; path: string }>;
      for (const row of pathResults) {
        const entry = getOrCreate(scores, row.id, row.path);
        entry.score += Math.round(3 * idfWeight);
        entry.matchedKeywords.add(keyword);
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

  // Only expand from top 5 scoring files (but require minimum score of 10)
  const top5 = [...scores.values()]
    .filter(s => s.score >= 10)
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
    entry = { fileId, path, score: 0, matchedKeywords: new Set() };
    scores.set(fileId, entry);
  }
  return entry;
}
