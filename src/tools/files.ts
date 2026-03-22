import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { createQueries } from '../db/queries.js';
import { minimatch } from 'minimatch';

interface ProjectFileRecord {
  id: number;
  path: string;
  type: string;
  extension: string | null;
  indexed: number;
}

export function register() {
  defineTool(
    'files',
    'List project files, optionally filtered by glob pattern, type, or modification time.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        pattern: { type: 'string', description: 'Glob pattern to filter file paths' },
        type: {
          type: 'string',
          enum: ['dir', 'code', 'config', 'doc', 'asset', 'test', 'other'],
          description: 'Filter by file type',
        },
        modified_since: {
          type: 'string',
          description: 'ISO date string — only files indexed after this date',
        },
      },
      required: ['path'],
    },
    async (args) => {
      const path = args.path as string;
      const pattern = args.pattern as string | undefined;
      const type = args.type as string | undefined;
      const modifiedSince = args.modified_since as string | undefined;

      const db = openDatabase(path);
      try {
        const q = createQueries(db);
        let files = q.getAllProjectFiles.all() as ProjectFileRecord[];

        if (type) {
          files = files.filter((f) => f.type === type);
        }

        if (pattern) {
          files = files.filter((f) => minimatch(f.path, pattern));
        }

        if (modifiedSince) {
          const sinceMs = new Date(modifiedSince).getTime();
          // Cross-reference with files table for last_indexed
          const indexedFiles = q.getAllFiles.all() as Array<{ id: number; path: string; last_indexed: number }>;
          const indexedByPath = new Map<string, number>();
          for (const f of indexedFiles) indexedByPath.set(f.path, f.last_indexed);
          files = files.filter((f) => {
            const ts = indexedByPath.get(f.path);
            return ts !== undefined && ts >= sinceMs;
          });
        }

        // Strip common path prefix to reduce token usage
        const paths = files.map((f) => f.path);
        let commonPrefix = '';
        if (paths.length > 1) {
          const first = paths[0];
          for (let i = 0; i < first.length; i++) {
            const char = first[i];
            if (paths.every((p) => p[i] === char)) {
              commonPrefix += char;
            } else {
              break;
            }
          }
          // Trim to last directory separator
          const lastSlash = commonPrefix.lastIndexOf('/');
          commonPrefix = lastSlash > 0 ? commonPrefix.substring(0, lastSlash + 1) : '';
        }

        const shortPaths = commonPrefix.length > 10
          ? paths.map((p) => p.substring(commonPrefix.length))
          : paths;

        const header = commonPrefix.length > 10
          ? `${files.length} files (under ${commonPrefix}):`
          : `${files.length} files:`;

        return {
          content: [{ type: 'text' as const, text: `${header}\n${shortPaths.join('\n')}` }],
        };
      } finally {
        db.close();
      }
    },
  );
}
