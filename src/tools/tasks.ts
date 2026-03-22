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

export function register() {
  defineTool(
    'tasks',
    'List and filter tasks. Returns tasks grouped by status (active, backlog, done, cancelled), sorted by priority and sort order.',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        status: {
          type: 'string',
          enum: ['backlog', 'active', 'done', 'cancelled'],
          description: 'Filter by status',
        },
        priority: { type: 'number', enum: [1, 2, 3], description: 'Filter by priority' },
        tag: { type: 'string', description: 'Filter by tag (substring match in tags field)' },
      },
      required: ['path'],
    },
    async (args) => {
      const projectPath = args.path as string;
      const statusFilter = args.status as string | undefined;
      const priorityFilter = args.priority as number | undefined;
      const tagFilter = args.tag as string | undefined;

      const db = openDatabase(projectPath);
      const q = createQueries(db);

      try {
        let tasks = q.listTasks.all() as TaskRecord[];

        // Apply filters
        if (statusFilter) {
          tasks = tasks.filter(t => t.status === statusFilter);
        }
        if (priorityFilter) {
          tasks = tasks.filter(t => t.priority === priorityFilter);
        }
        if (tagFilter) {
          tasks = tasks.filter(t => t.tags?.includes(tagFilter));
        }

        // Group by status
        const grouped: Record<string, TaskRecord[]> = {
          active: [],
          backlog: [],
          done: [],
          cancelled: [],
        };

        for (const task of tasks) {
          const group = grouped[task.status];
          if (group) {
            group.push(task);
          }
        }

        // Remove empty groups
        for (const key of Object.keys(grouped)) {
          if (grouped[key].length === 0) {
            delete grouped[key];
          }
        }

        db.close();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ total: tasks.length, tasks: grouped }),
          }],
        };
      } catch (err) {
        db.close();
        throw err;
      }
    },
  );
}
