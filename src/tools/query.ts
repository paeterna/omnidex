import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { minimatch } from 'minimatch';

export function register() {
  defineTool(
    'query',
    'Search the index for symbols by name. Supports exact, contains, and starts_with matching modes.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        term: { type: 'string', description: 'Search term' },
        mode: {
          type: 'string',
          enum: ['exact', 'contains', 'starts_with'],
          description: 'Matching mode (default: exact)',
        },
        file_filter: { type: 'string', description: 'Glob pattern to filter file paths' },
        type_filter: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by line types (code, comment, struct, method, property, string)',
        },
        modified_since: { type: 'string', description: 'ISO date string — only files indexed after this date' },
        modified_before: { type: 'string', description: 'ISO date string — only files indexed before this date' },
        limit: { type: 'number', description: 'Max results to return (default: 100)' },
      },
      required: ['path', 'term'],
    },
    async (args) => {
      const path = args.path as string;
      const term = args.term as string;
      const mode = (args.mode as string) || 'exact';
      const fileFilter = args.file_filter as string | undefined;
      const typeFilter = args.type_filter as string[] | undefined;
      const modifiedSince = args.modified_since as string | undefined;
      const modifiedBefore = args.modified_before as string | undefined;
      const limit = (args.limit as number) || 100;

      const db = openDatabase(path);
      try {
        let whereClause: string;
        let params: string[];

        switch (mode) {
          case 'contains':
            whereClause = "i.term LIKE '%' || ? || '%' COLLATE NOCASE";
            params = [term];
            break;
          case 'starts_with':
            whereClause = "i.term LIKE ? || '%' COLLATE NOCASE";
            params = [term];
            break;
          default: // exact
            whereClause = 'i.term = ? COLLATE NOCASE';
            params = [term];
            break;
        }

        const conditions = [whereClause];

        if (typeFilter && typeFilter.length > 0) {
          const placeholders = typeFilter.map(() => '?').join(', ');
          conditions.push(`l.line_type IN (${placeholders})`);
          params.push(...typeFilter);
        }

        if (modifiedSince) {
          conditions.push('f.last_indexed >= ?');
          params.push(String(new Date(modifiedSince).getTime()));
        }

        if (modifiedBefore) {
          conditions.push('f.last_indexed <= ?');
          params.push(String(new Date(modifiedBefore).getTime()));
        }

        const sql = `
          SELECT f.path as file, l.line_number as line, l.line_type, i.term
          FROM occurrences o
          JOIN items i ON o.item_id = i.id
          JOIN files f ON o.file_id = f.id
          JOIN lines l ON o.file_id = l.file_id AND o.line_id = l.id
          WHERE ${conditions.join(' AND ')}
          LIMIT ?
        `;
        params.push(String(limit));

        let results = db.prepare(sql).all(...params) as Array<{
          file: string;
          line: number;
          line_type: string;
          term: string;
        }>;

        // Apply glob filter in JS since SQLite doesn't support glob matching well
        if (fileFilter) {
          results = results.filter((r) => minimatch(r.file, fileFilter));
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(results) }],
        };
      } finally {
        db.close();
      }
    },
  );
}
