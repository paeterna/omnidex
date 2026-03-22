import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PRODUCT_NAME, PRODUCT_VERSION } from './constants.js';
import { registerTools, handleToolCall } from './tools/registry.js';

export function createServer() {
  const server = new Server(
    { name: PRODUCT_NAME.toLowerCase(), version: PRODUCT_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registerTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, request.params.arguments ?? {});
  });

  return {
    async start() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      console.error(`${PRODUCT_NAME} MCP server started`);
    },
  };
}
