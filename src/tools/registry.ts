import { TOOL_PREFIX } from '../constants.js';

const tools: Array<{ name: string; description: string; inputSchema: object }> = [];
const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

export function registerTools() {
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
