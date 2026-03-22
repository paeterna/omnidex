import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { createQueries } from '../db/queries.js';
import { getFileSignature } from './signature.js';
import { minimatch } from 'minimatch';

interface FileRecord {
  id: number;
  path: string;
}

export function register() {
  defineTool(
    'signatures',
    'Get structural signatures for multiple files. Accepts a glob pattern or an explicit list of paths.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        pattern: { type: 'string', description: 'Glob pattern to match files (e.g. "src/**/*.ts")' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit list of relative file paths',
        },
      },
      required: ['path'],
    },
    async (args) => {
      const path = args.path as string;
      const pattern = args.pattern as string | undefined;
      const filesList = args.files as string[] | undefined;

      if (!pattern && !filesList) {
        return {
          content: [{ type: 'text' as const, text: 'Either "pattern" or "files" must be provided.' }],
          isError: true as const,
        };
      }

      const db = openDatabase(path);
      try {
        const q = createQueries(db);
        const allFiles = q.getAllFiles.all() as FileRecord[];

        let matchingFiles: FileRecord[];
        if (filesList) {
          const set = new Set(filesList);
          matchingFiles = allFiles.filter((f) => set.has(f.path));
        } else {
          matchingFiles = allFiles.filter((f) => minimatch(f.path, pattern!));
        }

        const outputs: string[] = [];
        for (const file of matchingFiles) {
          outputs.push(getFileSignature(q, file.id, file.path));
        }

        return {
          content: [{ type: 'text' as const, text: outputs.join('\n\n') || 'No matching files found.' }],
        };
      } finally {
        db.close();
      }
    },
  );
}
