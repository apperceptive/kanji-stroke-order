import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getKanji } from '../data/firestore.js';

const TOOL_DESCRIPTION = `Returns KanjiVG stroke order data for a single kanji character.

Response fields (JSON string):
- character: The requested character.
- stroke_count: Number of strokes (integer, or null if unavailable).
- svg: Raw KanjiVG SVG inner content (mincho style). Wrap in <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 109"> to render.

SVG structure:
- <path> elements with IDs ending in -s1, -s2, … appear in correct stroke order within the document.
- Strokes are nested in <g> groups with kvg:element attributes naming kanji components/radicals
  (e.g. kvg:element="水"). This hierarchy is pedagogically meaningful — use it to color strokes
  by component, explain character structure, or group strokes when teaching.
- A <g id="kvg:StrokeNumbers_…"> sibling group contains <text> elements positioned at each
  stroke's start point for visual stroke-order numbering.
- The full SVG uses a 109×109 coordinate space.

Common rendering patterns the harness should consider:
- Sequential animation: apply CSS stroke-dasharray/stroke-dashoffset to each <path>,
  with increasing animation-delay per stroke index to draw strokes one at a time.
- Component coloring: assign a distinct color to each top-level component <g> group.
- Static reference: render the SVG directly with no animation for a reference diagram.
- The harness decides speed, color, stroke width, and drawing order — the MCP does not.`;

export function registerStrokeOrderTool(server: McpServer): void {
  server.tool(
    'get_stroke_order',
    TOOL_DESCRIPTION,
    { character: z.string().length(1).describe("Single kanji character, e.g. '犬'") },
    async ({ character }) => {
      const doc = await getKanji(character);

      if (!doc) {
        return {
          content: [{
            type: 'text',
            text: `Character "${character}" not found. The database covers Jōyō kanji and many additional characters; check that the input is a single CJK character.`,
          }],
          isError: true,
        };
      }

      const svg = doc.strokes?.mincho?.svg;
      if (!svg) {
        return {
          content: [{
            type: 'text',
            text: `Stroke data (mincho) not available for "${character}".`,
          }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            character,
            stroke_count: doc.stroke_count ?? null,
            svg,
          }),
        }],
      };
    },
  );
}
