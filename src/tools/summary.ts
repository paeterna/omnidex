import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { createQueries } from '../db/queries.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { INDEX_DIR } from '../constants.js';

interface ProjectFileRecord {
  type: string;
}

export function register() {
  defineTool(
    'summary',
    'Get a project overview: file counts by type, top types, top entry points, and user-written summary.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
      },
      required: ['path'],
    },
    async (args) => {
      const path = args.path as string;

      const db = openDatabase(path);
      try {
        const q = createQueries(db);

        // Project name
        const nameRow = q.getMetadata.get('project_name') as { value: string } | undefined;
        const projectName = nameRow?.value || path.split('/').pop() || 'unknown';

        // File counts by type
        const allProjectFiles = q.getAllProjectFiles.all() as ProjectFileRecord[];
        const fileCounts: Record<string, number> = {};
        for (const f of allProjectFiles) {
          fileCounts[f.type] = (fileCounts[f.type] || 0) + 1;
        }

        // Top types (by occurrence count), deduplicated by name, limited to 5
        const topTypesRaw = db
          .prepare(`
            SELECT t.name, t.kind, COUNT(o.item_id) as occurrences
            FROM types t
            LEFT JOIN items i ON i.term = t.name
            LEFT JOIN occurrences o ON o.item_id = i.id
            GROUP BY t.id
            ORDER BY occurrences DESC
            LIMIT 20
          `)
          .all() as Array<{ name: string; kind: string; occurrences: number }>;

        const seenTypes = new Set<string>();
        const topTypes = topTypesRaw.filter((t) => {
          if (seenTypes.has(t.name)) return false;
          seenTypes.add(t.name);
          return true;
        }).slice(0, 5);

        // Top 5 entry points (files with most inbound edges)
        const topEntryPoints = db
          .prepare(`
            SELECT f.path, COUNT(e.source_file_id) as inbound
            FROM edges e
            JOIN files f ON e.target_file_id = f.id
            GROUP BY e.target_file_id
            ORDER BY inbound DESC
            LIMIT 5
          `)
          .all() as Array<{ path: string; inbound: number }>;

        // Read summary.md if it exists
        const summaryPath = join(path, INDEX_DIR, 'summary.md');
        let summaryContent: string | null = null;
        if (existsSync(summaryPath)) {
          summaryContent = readFileSync(summaryPath, 'utf-8');
        }

        const result = {
          project: projectName,
          fileCounts,
          topTypes,
          topEntryPoints,
          summary: summaryContent,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } finally {
        db.close();
      }
    },
  );
}
