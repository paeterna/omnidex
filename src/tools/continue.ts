import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { recommend } from '../recommender/recommender.js';

export function register() {
  defineTool('continue', 'Auto-recommend files for the current turn. Call this FIRST before any file exploration.', {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project path' },
      query: { type: 'string', description: 'The user query or task description' },
      limit: { type: 'number', description: 'Max recommended files (default: 5)' },
    },
    required: ['path', 'query'],
  }, async (args) => {
    const db = openDatabase(args.path as string);
    try {
      const fileCount = (db.prepare('SELECT COUNT(*) as c FROM files').get() as any)?.c ?? 0;
      if (fileCount === 0) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, needs_project: true, query: args.query }) }] };
      }
      const result = recommend(db, args.query as string, args.limit as number | undefined);
      // Record action
      const filePaths = result.recommended_files.map(f => f.file);
      db.prepare('INSERT INTO actions (action_type, query, files, created_at) VALUES (?, ?, ?, ?)').run(
        'continue', args.query, JSON.stringify(filePaths), Date.now()
      );
      const compactResult: any = {
        ok: result.ok,
        confidence: result.confidence,
        max_supplementary_greps: result.max_supplementary_greps,
        max_supplementary_files: result.max_supplementary_files,
        recommended_files: result.recommended_files.map((f: any) => f.file),
        query: result.query,
      };
      if (result.needs_project) compactResult.needs_project = true;
      if (result.skip) compactResult.skip = true;
      return { content: [{ type: 'text' as const, text: JSON.stringify(compactResult) }] };
    } finally {
      db.close();
    }
  });
}
