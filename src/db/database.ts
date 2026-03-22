import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function openDatabase(projectPath: string): Database.Database {
  const indexDir = join(projectPath, '.omnidex');
  if (!existsSync(indexDir)) {
    mkdirSync(indexDir, { recursive: true });
  }
  const dbPath = join(indexDir, 'index.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Apply schema
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  return db;
}
