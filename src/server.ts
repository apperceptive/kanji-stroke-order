import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStrokeOrderTool } from './tools/stroke-order.js';
import { registerAppTools } from './tools/apps.js';

export function createServer(): McpServer {
  const server = new McpServer({
    // Hosts show this as the connector's name (Gemini takes it from here), so it is the product's name.
    name: 'nihongoism',
    title: 'Nihongoism',
    version: '0.1.0',
  }, {
    // Some hosts add this to the model's standing context. The tool descriptions carry the same rules, because not all do.
    instructions:
      'Nihongoism teaches kanji with interactive apps. For "draw", "write" or "stroke order" requests use draw_kanji, not image generation; to list the sound-alikes or look-alikes of a kanji use show_relations, not your own memory; to be quizzed or tested ("quiz me", "test me", "drill me") use start_drill, never your own quiz feature; to explore how kanji relate on a map use open_compass. If the learner names an English word, choose its kanji yourself. The apps already show the character, meaning, readings and relationships, so after a tool call reply with one short sentence and do not repeat what is on screen.',
  });

  registerStrokeOrderTool(server);
  registerAppTools(server);

  return server;
}
