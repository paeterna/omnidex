import { defineTool } from './registry.js';
import { openDatabase } from '../db/database.js';
import { logUsage, getSessionStats, getUsageHistory, resetSession } from '../tokens/tracker.js';

export function register() {
  defineTool(
    'tokens',
    'Track token usage. Actions: log (record usage), stats (get session statistics with cost estimate), history (recent entries), reset (clear all usage data).',
    {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the project root' },
        action: {
          type: 'string',
          enum: ['log', 'stats', 'history', 'reset'],
          description: 'The action to perform',
        },
        input_tokens: { type: 'number', description: 'Number of input tokens (for log)' },
        output_tokens: { type: 'number', description: 'Number of output tokens (for log)' },
        cache_creation_tokens: { type: 'number', description: 'Cache creation tokens (for log)' },
        cache_read_tokens: { type: 'number', description: 'Cache read tokens (for log)' },
        model: { type: 'string', description: 'Model name (for log)' },
        description: { type: 'string', description: 'Description of the usage (for log)' },
        since: { type: 'number', description: 'Timestamp to filter stats from (for stats)' },
        limit: { type: 'number', description: 'Number of entries to return (for history)' },
      },
      required: ['path', 'action'],
    },
    async (args) => {
      const projectPath = args.path as string;
      const action = args.action as string;
      const db = openDatabase(projectPath);

      try {
        switch (action) {
          case 'log': {
            const inputTokens = args.input_tokens as number;
            const outputTokens = args.output_tokens as number;
            if (inputTokens == null || outputTokens == null) {
              db.close();
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ error: 'input_tokens and output_tokens are required' }) }],
                isError: true as const,
              };
            }
            logUsage(db, {
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              cache_creation_tokens: args.cache_creation_tokens as number | undefined,
              cache_read_tokens: args.cache_read_tokens as number | undefined,
              model: args.model as string | undefined,
              description: args.description as string | undefined,
            });
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ logged: true }) }],
            };
          }

          case 'stats': {
            const since = args.since as number | undefined;
            const stats = getSessionStats(db, since);
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(stats) }],
            };
          }

          case 'history': {
            const limit = args.limit as number | undefined;
            const history = getUsageHistory(db, limit);
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(history) }],
            };
          }

          case 'reset': {
            resetSession(db);
            db.close();
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ reset: true }) }],
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
