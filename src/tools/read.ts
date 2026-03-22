import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { readFileSync } from 'fs';
import { join } from 'path';

export function register() {
  defineTool('read', 'Read a file or specific symbol. Supports file::symbol notation.', {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project path' },
      file: { type: 'string', description: 'Relative file path, optionally with ::symbol (e.g. src/auth.ts::handleLogin)' },
    },
    required: ['path', 'file'],
  }, async (args) => {
    const projectPath = args.path as string;
    const fileArg = args.file as string;

    const [relPath, symbolName] = fileArg.includes('::') ? fileArg.split('::') : [fileArg, null];
    const absPath = join(projectPath, relPath);

    const content = readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');

    if (!symbolName) {
      // Record action
      const db = openDatabase(projectPath);
      db.prepare('INSERT INTO actions (action_type, query, files, created_at) VALUES (?, ?, ?, ?)').run('read', null, JSON.stringify([relPath]), Date.now());
      db.close();

      // Return numbered lines
      const numbered = lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
      return { content: [{ type: 'text' as const, text: numbered }] };
    }

    // Symbol lookup
    const db = openDatabase(projectPath);
    try {
      const file = db.prepare('SELECT id FROM files WHERE path = ?').get(relPath) as any;
      if (!file) {
        return { content: [{ type: 'text' as const, text: `File not indexed: ${relPath}` }], isError: true };
      }

      // Check methods
      const method = db.prepare('SELECT line_number FROM methods WHERE file_id = ? AND name = ?').get(file.id, symbolName) as any;
      // Check types
      const type = db.prepare('SELECT line_number FROM types WHERE file_id = ? AND name = ?').get(file.id, symbolName) as any;

      const startLine = method?.line_number ?? type?.line_number;
      if (!startLine) {
        return { content: [{ type: 'text' as const, text: `Symbol not found: ${symbolName} in ${relPath}` }], isError: true };
      }

      // Find end line: next method/type start or end of file
      const nextMethod = db.prepare('SELECT line_number FROM methods WHERE file_id = ? AND line_number > ? ORDER BY line_number ASC LIMIT 1').get(file.id, startLine) as any;
      const nextType = db.prepare('SELECT line_number FROM types WHERE file_id = ? AND line_number > ? ORDER BY line_number ASC LIMIT 1').get(file.id, startLine) as any;

      let endLine = lines.length;
      if (nextMethod?.line_number) endLine = Math.min(endLine, nextMethod.line_number - 1);
      if (nextType?.line_number) endLine = Math.min(endLine, nextType.line_number - 1);

      // Record action
      db.prepare('INSERT INTO actions (action_type, query, files, created_at) VALUES (?, ?, ?, ?)').run('read', symbolName, JSON.stringify([fileArg]), Date.now());

      const slice = lines.slice(startLine - 1, endLine);
      const numbered = slice.map((l, i) => `${startLine + i}\t${l}`).join('\n');
      return { content: [{ type: 'text' as const, text: numbered }] };
    } finally {
      db.close();
    }
  });
}
