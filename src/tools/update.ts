import { defineTool } from './registry.js';
import { updateFile } from '../indexer/indexer.js';

export function register() {
  defineTool(
    'update',
    'Re-index a single file that has changed. Faster than a full scan for incremental updates.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        file: { type: 'string', description: 'Relative path to the file within the project' },
      },
      required: ['path', 'file'],
    },
    async (args) => {
      const path = args.path as string;
      const file = args.file as string;
      await updateFile(path, file);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ updated: file }) }],
      };
    },
  );
}
