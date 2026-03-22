import type Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';

type Queries = Record<string, Statement>;

export function createQueries(db: Database.Database): Queries {
  return {
    // Files
    insertFile: db.prepare('INSERT OR REPLACE INTO files (path, hash, last_indexed) VALUES (?, ?, ?)'),
    getFileByPath: db.prepare('SELECT * FROM files WHERE path = ?'),
    getFileById: db.prepare('SELECT * FROM files WHERE id = ?'),
    deleteFile: db.prepare('DELETE FROM files WHERE id = ?'),
    getAllFiles: db.prepare('SELECT * FROM files'),

    // Lines
    insertLine: db.prepare('INSERT INTO lines (id, file_id, line_number, line_type, line_hash, modified) VALUES (?, ?, ?, ?, ?, ?)'),
    deleteLinesByFile: db.prepare('DELETE FROM lines WHERE file_id = ?'),

    // Items
    insertItem: db.prepare('INSERT OR IGNORE INTO items (term) VALUES (?)'),
    getItemByTerm: db.prepare('SELECT * FROM items WHERE term = ?'),

    // Occurrences
    insertOccurrence: db.prepare('INSERT OR IGNORE INTO occurrences (item_id, file_id, line_id) VALUES (?, ?, ?)'),
    deleteOccurrencesByFile: db.prepare('DELETE FROM occurrences WHERE file_id = ?'),

    // Methods
    insertMethod: db.prepare('INSERT INTO methods (file_id, name, prototype, line_number, visibility, is_static, is_async) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    deleteMethodsByFile: db.prepare('DELETE FROM methods WHERE file_id = ?'),
    getMethodsByFile: db.prepare('SELECT * FROM methods WHERE file_id = ?'),
    getMethodByName: db.prepare('SELECT m.*, f.path FROM methods m JOIN files f ON m.file_id = f.id WHERE m.name = ?'),

    // Types
    insertType: db.prepare('INSERT INTO types (file_id, name, kind, line_number) VALUES (?, ?, ?, ?)'),
    deleteTypesByFile: db.prepare('DELETE FROM types WHERE file_id = ?'),
    getTypesByFile: db.prepare('SELECT * FROM types WHERE file_id = ?'),

    // Signatures
    insertSignature: db.prepare('INSERT OR REPLACE INTO signatures (file_id, header_comments) VALUES (?, ?)'),
    getSignatureByFile: db.prepare('SELECT * FROM signatures WHERE file_id = ?'),

    // Edges
    insertEdge: db.prepare('INSERT OR REPLACE INTO edges (source_file_id, target_file_id, edge_type, weight) VALUES (?, ?, ?, ?)'),
    deleteEdgesByFile: db.prepare('DELETE FROM edges WHERE source_file_id = ?'),
    getEdgesFrom: db.prepare('SELECT e.*, f.path as target_path FROM edges e JOIN files f ON e.target_file_id = f.id WHERE e.source_file_id = ?'),
    getEdgesTo: db.prepare('SELECT e.*, f.path as source_path FROM edges e JOIN files f ON e.source_file_id = f.id WHERE e.target_file_id = ?'),

    // Project files
    insertProjectFile: db.prepare('INSERT OR REPLACE INTO project_files (path, type, extension, indexed) VALUES (?, ?, ?, ?)'),
    getAllProjectFiles: db.prepare('SELECT * FROM project_files'),

    // Tasks
    insertTask: db.prepare('INSERT INTO tasks (title, description, priority, status, tags, source, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    getTask: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    updateTask: db.prepare('UPDATE tasks SET title=?, description=?, priority=?, status=?, tags=?, sort_order=?, updated_at=?, completed_at=? WHERE id=?'),
    deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
    listTasks: db.prepare('SELECT * FROM tasks ORDER BY priority ASC, sort_order ASC, created_at DESC'),

    // Task log
    insertTaskLog: db.prepare('INSERT INTO task_log (task_id, note, created_at) VALUES (?, ?, ?)'),
    getTaskLogs: db.prepare('SELECT * FROM task_log WHERE task_id = ? ORDER BY created_at DESC'),

    // Notes
    insertNote: db.prepare('INSERT INTO notes (content, created_at) VALUES (?, ?)'),
    getLatestNote: db.prepare('SELECT * FROM notes ORDER BY created_at DESC LIMIT 1'),
    deleteAllNotes: db.prepare('DELETE FROM notes'),

    // Sessions
    insertSession: db.prepare('INSERT INTO sessions (started_at) VALUES (?)'),
    getLatestSession: db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 1'),
    updateSessionEnd: db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?'),

    // Token usage
    insertTokenUsage: db.prepare('INSERT INTO token_usage (input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, model, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    getTokenUsageSession: db.prepare('SELECT * FROM token_usage WHERE created_at >= ?'),
    getAllTokenUsage: db.prepare('SELECT * FROM token_usage ORDER BY created_at DESC'),
    deleteAllTokenUsage: db.prepare('DELETE FROM token_usage'),

    // Actions
    insertAction: db.prepare('INSERT INTO actions (action_type, query, files, created_at) VALUES (?, ?, ?, ?)'),
    getRecentActions: db.prepare('SELECT * FROM actions ORDER BY created_at DESC LIMIT ?'),

    // Metadata
    setMetadata: db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)'),
    getMetadata: db.prepare('SELECT value FROM metadata WHERE key = ?'),
  };
}
