import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { createQueries } from '../db/queries.js';

interface NoteRecord {
  id: number;
  content: string;
  created_at: number;
}

export function register() {
  defineTool(
    'note',
    'Read or write session notes. Call with no args to read the latest note, provide `note` to save, `append: true` to append to the latest note, or `clear: true` to delete all notes.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        note: { type: 'string', description: 'Note content to save' },
        append: { type: 'boolean', description: 'Append to the latest note instead of creating a new one' },
        clear: { type: 'boolean', description: 'Delete all notes' },
      },
      required: ['path'],
    },
    async (args) => {
      const projectPath = args.path as string;
      const note = args.note as string | undefined;
      const append = args.append as boolean | undefined;
      const clear = args.clear as boolean | undefined;

      const db = openDatabase(projectPath);
      const q = createQueries(db);

      try {
        // Clear all notes
        if (clear) {
          q.deleteAllNotes.run();
          db.close();
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ cleared: true }) }],
          };
        }

        // Save or append a note
        if (note) {
          if (append) {
            const latest = q.getLatestNote.get() as NoteRecord | undefined;
            const combined = latest ? `${latest.content}\n${note}` : note;
            q.insertNote.run(combined, Date.now());
          } else {
            q.insertNote.run(note, Date.now());
          }
          db.close();
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ saved: true }) }],
          };
        }

        // Read latest note
        const latest = q.getLatestNote.get() as NoteRecord | undefined;
        db.close();

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ note: latest?.content ?? null }),
          }],
        };
      } catch (err) {
        db.close();
        throw err;
      }
    },
  );
}
