import { defineTool } from './registry.js';
import { indexProject } from '../indexer/indexer.js';

export function register() {
  defineTool(
    'scan',
    'Index a project directory. Scans all source files, extracts symbols, and builds the search index.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional glob patterns to exclude from indexing',
        },
      },
      required: ['path'],
    },
    async (args) => {
      const path = args.path as string;
      const exclude = args.exclude as string[] | undefined;
      const result = await indexProject(path, { exclude });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );
}
