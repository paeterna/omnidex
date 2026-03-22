import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { createQueries } from '../db/queries.js';
import { updateFile } from '../indexer/indexer.js';
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

interface FileRecord {
  id: number;
  path: string;
  hash: string;
  last_indexed: number;
}

interface SessionRecord {
  id: number;
  started_at: number;
  ended_at: number | null;
}

interface NoteRecord {
  id: number;
  content: string;
  created_at: number;
}

export function register() {
  defineTool(
    'session',
    'Start or check a session. Detects files changed since last indexing and re-indexes them. Returns session info and latest note.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
      },
      required: ['path'],
    },
    async (args) => {
      const projectPath = args.path as string;
      const db = openDatabase(projectPath);
      const q = createQueries(db);

      try {
        // Get latest session (before creating new one)
        const lastSession = q.getLatestSession.get() as SessionRecord | undefined;

        // End the previous session if it exists and has no end time
        if (lastSession && !lastSession.ended_at) {
          q.updateSessionEnd.run(Date.now(), lastSession.id);
        }

        // Create new session
        const now = Date.now();
        q.insertSession.run(now);
        const newSession = q.getLatestSession.get() as SessionRecord;

        // Detect changed files by comparing hashes
        const allFiles = q.getAllFiles.all() as FileRecord[];
        let filesChanged = 0;
        let filesReindexed = 0;

        for (const file of allFiles) {
          const absolutePath = resolve(projectPath, file.path);
          if (!existsSync(absolutePath)) continue;

          try {
            const content = readFileSync(absolutePath, 'utf-8');
            const currentHash = createHash('sha256').update(content).digest('hex');

            if (currentHash !== file.hash) {
              filesChanged++;
              // Close db before updateFile (it opens its own)
              // Instead, just track changed files and reindex after
            }
          } catch {
            // Skip files that can't be read
          }
        }

        // Close db, then reindex changed files (updateFile opens its own db)
        const changedFiles: string[] = [];
        for (const file of allFiles) {
          const absolutePath = resolve(projectPath, file.path);
          if (!existsSync(absolutePath)) continue;

          try {
            const content = readFileSync(absolutePath, 'utf-8');
            const currentHash = createHash('sha256').update(content).digest('hex');
            if (currentHash !== file.hash) {
              changedFiles.push(file.path);
            }
          } catch {
            // Skip
          }
        }

        // Get latest note before closing
        const latestNote = q.getLatestNote.get() as NoteRecord | undefined;

        db.close();

        // Reindex changed files
        for (const filePath of changedFiles) {
          try {
            await updateFile(projectPath, filePath);
            filesReindexed++;
          } catch {
            // Skip files that fail to reindex
          }
        }

        const result = {
          session_id: newSession.id,
          started_at: newSession.started_at,
          last_session: lastSession
            ? { started_at: lastSession.started_at, ended_at: lastSession.ended_at }
            : null,
          files_changed: changedFiles.length,
          files_reindexed: filesReindexed,
          note: latestNote?.content ?? null,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        db.close();
        throw err;
      }
    },
  );
}
