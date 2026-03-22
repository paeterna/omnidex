import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { createQueries } from '../db/queries.js';

interface TaskRecord {
  id: number;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  tags: string | null;
  source: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface TaskLogRecord {
  id: number;
  task_id: number;
  note: string;
  created_at: number;
}

export function register() {
  defineTool(
    'task',
    'CRUD operations for a single task. Actions: create, read, update, delete, log.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        action: {
          type: 'string',
          enum: ['create', 'read', 'update', 'delete', 'log'],
          description: 'The action to perform',
        },
        id: { type: 'number', description: 'Task ID (for read/update/delete/log)' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        priority: { type: 'number', enum: [1, 2, 3], description: 'Priority: 1=high, 2=medium, 3=low' },
        status: {
          type: 'string',
          enum: ['backlog', 'active', 'done', 'cancelled'],
          description: 'Task status',
        },
        tags: { type: 'string', description: 'Comma-separated tags' },
        source: { type: 'string', description: 'Source/origin of the task' },
        sort_order: { type: 'number', description: 'Sort order within same priority' },
        note: { type: 'string', description: 'Log entry note (for log action)' },
      },
      required: ['path', 'action'],
    },
    async (args) => {
      const projectPath = args.path as string;
      const action = args.action as string;
      const db = openDatabase(projectPath);
      const q = createQueries(db);

      try {
        switch (action) {
          case 'create': {
            const now = Date.now();
            q.insertTask.run(
              args.title as string ?? 'Untitled',
              (args.description as string) ?? null,
              (args.priority as number) ?? 2,
              (args.status as string) ?? 'backlog',
              (args.tags as string) ?? null,
              (args.source as string) ?? null,
              (args.sort_order as number) ?? 0,
              now,
              now,
            );
            // Get the created task (last inserted)
            const created = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 1').get() as TaskRecord;
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(created) }],
            };
          }

          case 'read': {
            const id = args.id as number;
            if (!id) {
              db.close();
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'id is required for read' }) }],
                isError: true as const,
              };
            }
            const task = q.getTask.get(id) as TaskRecord | undefined;
            const logs = q.getTaskLogs.all(id) as TaskLogRecord[];
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ task: task ?? null, logs }) }],
            };
          }

          case 'update': {
            const id = args.id as number;
            if (!id) {
              db.close();
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'id is required for update' }) }],
                isError: true as const,
              };
            }
            const existing = q.getTask.get(id) as TaskRecord | undefined;
            if (!existing) {
              db.close();
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'task not found' }) }],
                isError: true as const,
              };
            }

            const newStatus = (args.status as string) ?? existing.status;
            const now = Date.now();
            const completedAt = (newStatus === 'done' || newStatus === 'cancelled')
              ? (existing.completed_at ?? now)
              : null;

            q.updateTask.run(
              (args.title as string) ?? existing.title,
              (args.description as string) ?? existing.description,
              (args.priority as number) ?? existing.priority,
              newStatus,
              (args.tags as string) ?? existing.tags,
              (args.sort_order as number) ?? existing.sort_order,
              now,
              completedAt,
              id,
            );

            const updated = q.getTask.get(id) as TaskRecord;
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(updated) }],
            };
          }

          case 'delete': {
            const id = args.id as number;
            if (!id) {
              db.close();
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'id is required for delete' }) }],
                isError: true as const,
              };
            }
            q.deleteTask.run(id);
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ deleted: id }) }],
            };
          }

          case 'log': {
            const id = args.id as number;
            const note = args.note as string;
            if (!id || !note) {
              db.close();
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'id and note are required for log' }) }],
                isError: true as const,
              };
            }
            q.insertTaskLog.run(id, note, Date.now());
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ logged: true, task_id: id }) }],
            };
          }

          default: {
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: `Unknown action: ${action}` }) }],
              isError: true as const,
            };
          }
        }
      } catch (err) {
        db.close();
        throw err;
      }
    },
  );
}
