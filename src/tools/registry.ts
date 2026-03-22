import { TOOL_PREFIX } from '../constants.js';
import { register as registerScan } from './scan.js';
import { register as registerUpdate } from './update.js';
import { register as registerQuery } from './query.js';
import { register as registerSignature } from './signature.js';
import { register as registerSignatures } from './signatures.js';
import { register as registerTree } from './tree.js';
import { register as registerFiles } from './files.js';
import { register as registerSummary } from './summary.js';
import { register as registerDescribe } from './describe.js';
import { register as registerSession } from './session.js';
import { register as registerNote } from './note.js';
import { register as registerTask } from './task.js';
import { register as registerTasks } from './tasks.js';
import { register as registerTokens } from './tokens.js';
import { register as registerContinue } from './continue.js';
import { register as registerRead } from './read.js';
import { register as registerFallbackRg } from './fallback-rg.js';

const tools: Array<{ name: string; description: string; inputSchema: object }> = [];
const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

let registered = false;

export function registerTools() {
  if (!registered) {
    registerScan();
    registerUpdate();
    registerQuery();
    registerSignature();
    registerSignatures();
    registerTree();
    registerFiles();
    registerSummary();
    registerDescribe();
    registerSession();
    registerNote();
    registerTask();
    registerTasks();
    registerTokens();
    registerContinue();
    registerRead();
    registerFallbackRg();
    registered = true;
  }
  return tools;
}

export async function handleToolCall(name: string, args: Record<string, unknown>) {
  const handler = handlers.get(name);
  if (!handler) {
    return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true as const };
  }
  return handler(args) as Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export function defineTool(
  name: string,
  description: string,
  inputSchema: object,
  handler: (args: Record<string, unknown>) => Promise<unknown>
) {
  const fullName = `${TOOL_PREFIX}${name}`;
  tools.push({ name: fullName, description, inputSchema });
  handlers.set(fullName, handler);
}
