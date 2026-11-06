import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStrokeOrderTool } from './tools/stroke-order.js';
import { registerAppTools } from './tools/apps.js';

export function createServer(): McpServer {
  const server = new McpServer({
    // Hosts show this as the connector's name (Gemini takes it from here), so it is the product's name.
    name: 'nihongoism',
    title: 'Nihongoism',
    version: '0.1.0',
  });

  registerStrokeOrderTool(server);
  registerAppTools(server);

  return server;
}
