import { defineTool } from './registry.js';
import { execSync } from 'child_process';

let fallbackCallCount = 0;
const MAX_FALLBACK_CALLS = 5;

export function register() {
  defineTool('fallback_rg', 'Controlled ripgrep fallback. Use only when omnidex_continue confidence is low.', {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project path' },
      pattern: { type: 'string', description: 'Search pattern (regex)' },
      max_hits: { type: 'number', description: 'Max results (default: 30)' },
    },
    required: ['path', 'pattern'],
  }, async (args) => {
    fallbackCallCount++;
    if (fallbackCallCount > MAX_FALLBACK_CALLS) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Fallback call limit reached', calls: fallbackCallCount, max: MAX_FALLBACK_CALLS }) }] };
    }

    const projectPath = args.path as string;
    const pattern = args.pattern as string;
    const maxHits = (args.max_hits as number) ?? 30;

    try {
      const result = execSync(
        `rg -n --max-count ${maxHits} --glob '!node_modules' --glob '!.git' --glob '!.omnidex' --glob '!.aidex' --glob '!.dual-graph' -e '${pattern.replace(/'/g, "'\\''")}'`,
        { cwd: projectPath, maxBuffer: 1024 * 1024, timeout: 10000, encoding: 'utf-8' }
      );

      const lines = result.trim().split('\n').filter(Boolean).slice(0, maxHits);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ matches: lines, count: lines.length, call_number: fallbackCallCount }) }] };
    } catch (err: any) {
      if (err.status === 1) {
        // rg exits 1 when no matches
        return { content: [{ type: 'text' as const, text: JSON.stringify({ matches: [], count: 0, call_number: fallbackCallCount }) }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message, call_number: fallbackCallCount }) }] };
    }
  });
}
