import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStrokeOrderTool } from './tools/stroke-order.js';
import { registerAppTools } from './tools/apps.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'kanji-stroke-order',
    version: '0.1.0',
  });

  registerStrokeOrderTool(server);
  registerAppTools(server);

  return server;
}
