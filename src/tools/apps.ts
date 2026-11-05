import fs from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { getNode, gloss } from '../graph/graph.js';
import { buildRing, centerParts, RELATIONS, type CompassState, type Ring } from '../graph/relations.js';
import { buildQuestion, judge, publicQuestion } from '../graph/questions.js';
import { getStrokes, type Stroke } from '../data/strokes.js';

/**
 * The two Nihongoism MCP Apps. Their markup is built from ui/ at build time and served as-is: presentation
 * structure is deterministic, never written by a model per conversation (ADR-024 B6).
 */
const STROKE_PLAYER_URI = 'ui://nihongoism/stroke-player.html';
const COMPASS_URI = 'ui://nihongoism/compass.html';

/**
 * A demo learner, because this server has no sign-in and records nothing. The host may pass the kanji the
 * learner has met; this is what a call with none starts from.
 */
export const DEMO_MET = [...'日月火水木金土一人大口時持寺待'];

const kanjiChar = z.string().length(1).describe("A single kanji, e.g. '時'");
const metArg = z
  .array(z.string().length(1))
  .max(300)
  .optional()
  .describe('Kanji the learner has already met, if known. Ranked first in the ring and the only source of wrong-answer options.');

function uiHtml(name: string): string {
  return fs.readFileSync(new URL(`../../ui-dist/${name}.html`, import.meta.url), 'utf8');
}

function text(t: string, isError = false) {
  return { content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) };
}

export interface HubPayload {
  hub: {
    c: string;
    gloss: string;
    meanings: string[];
    on: string[];
    grade: number | null;
    strokeCount: number;
    parts: ReturnType<typeof centerParts>;
    strokes: Stroke[];
    met: boolean;
  };
  ring: Ring;
  state: CompassState;
  relations: typeof RELATIONS;
  demo: boolean;
}

/** The ring page that shows `focus`, so a walk from a wrong answer can land on the confused kanji. */
function pageWith(hub: string, state: CompassState, focus: string): { relation: Ring['relation']; page: number } | null {
  const all = buildRing(hub, state, 'all', 0);
  for (let p = 0; p < all.pages; p++) if (buildRing(hub, state, 'all', p).items.some((i) => i.k === focus)) return { relation: 'all', page: p };
  for (const r of RELATIONS) {
    const first = buildRing(hub, state, r, 0);
    for (let p = 0; p < first.pages; p++) if (buildRing(hub, state, r, p).items.some((i) => i.k === focus)) return { relation: r, page: p };
  }
  return null;
}

export async function hubPayload(hubChar: string, state: CompassState, relation: Ring['relation'] = 'all', page = 0, demo = false, focus?: string): Promise<HubPayload> {
  const n = getNode(hubChar);
  if (!n) throw new Error(`"${hubChar}" is not in the jōyō set this graph covers`);
  if (focus) {
    const at = pageWith(hubChar, state, focus);
    if (at) ({ relation, page } = at);
  }
  return {
    hub: {
      c: n.c,
      gloss: gloss(n),
      meanings: n.m,
      on: n.on,
      grade: n.g,
      strokeCount: n.sc,
      parts: centerParts(n),
      strokes: (await getStrokes(n.c)) ?? [],
      met: state.met.includes(n.c),
    },
    ring: buildRing(n.c, state, relation, page),
    state,
    relations: RELATIONS,
    demo,
  };
}

const stateArgs = {
  met: metArg,
  introduced: z.array(z.string().length(1)).max(100).optional().describe('Kanji introduced in this session and not yet met.'),
};
const stateOf = (a: { met?: string[]; introduced?: string[] }): { state: CompassState; demo: boolean } => ({
  state: { met: a.met ?? DEMO_MET, introduced: a.introduced ?? [] },
  demo: a.met === undefined,
});

export function registerAppTools(server: McpServer): void {
  registerAppResource(server, 'Nihongoism stroke player', STROKE_PLAYER_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: STROKE_PLAYER_URI, mimeType: RESOURCE_MIME_TYPE, text: uiHtml('stroke-player'), _meta: { ui: { prefersBorder: false } } }],
  }));
  registerAppResource(server, 'Nihongoism compass', COMPASS_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: COMPASS_URI, mimeType: RESOURCE_MIME_TYPE, text: uiHtml('compass'), _meta: { ui: { prefersBorder: false } } }],
  }));

  registerAppTool(
    server,
    'show_strokes',
    {
      title: 'Stroke player',
      description:
        'Shows one kanji as an interactive brush stroke player. The learner plays, pauses, steps through and replays the strokes at their own pace. Use it when someone asks how a kanji is written or what its stroke order is. The strokes come from KanjiVG and are drawn by the app; do not describe coordinates.',
      inputSchema: { character: kanjiChar },
      _meta: { ui: { resourceUri: STROKE_PLAYER_URI } },
    },
    async ({ character }) => {
      const strokes = await getStrokes(character);
      if (!strokes) return text(`No stroke data for "${character}".`, true);
      const n = getNode(character);
      return {
        content: [{ type: 'text', text: `Stroke player shown for ${character}${n ? ` (${gloss(n)}; ${n.on.join('・')})` : ''}, ${strokes.length} strokes. The learner controls the pace.` }],
        structuredContent: { character, gloss: n ? gloss(n) : '', on: n?.on ?? [], strokes },
      };
    },
  );

  registerAppTool(
    server,
    'open_compass',
    {
      title: 'Kanji compass',
      description:
        'Opens the kanji compass on a hub kanji: the hub at the center and a ring of at most six related kanji around it, each slot labeled with its relation (built-on: the neighbor contains the hub; shares-part: they share a visible piece; phonetic-series: a shared sound part and a shared on-reading). The learner moves between kanji by choosing a neighbor. Use it to look around a kanji, or to show the 寺 family from 時. Relations are computed from KanjiVG and reported in the result; explain only what the result states.',
      inputSchema: { hub: kanjiChar, ...stateArgs },
      _meta: { ui: { resourceUri: COMPASS_URI } },
    },
    async (a) => {
      const { state, demo } = stateOf(a);
      // Opening on an unmet kanji introduces it, so what is confusable with it waits (P-025 rule 1).
      if (!state.met.includes(a.hub) && !state.introduced.includes(a.hub)) state.introduced = [...state.introduced, a.hub];
      try {
        const p = await hubPayload(a.hub, state, 'all', 0, demo);
        const lines = p.ring.items.map(
          (i) =>
            `${i.k} (${i.gloss}; ${i.reading || 'no on-reading'}) · ${i.label}${i.note ? ` · ${i.note}` : ''}${i.met ? '' : ' · new'}${i.locked ? ` · waits: confusable with ${i.lockedBy}, new this session` : ''}`,
        );
        const c = p.ring.counts;
        const total = c['phonetic-series'] + c['shares-part'] + c['built-on'];
        return {
          content: [
            {
              type: 'text',
              text: `Compass opened on ${p.hub.c} (${p.hub.gloss}; ${p.hub.on.join('・')}). Parts: ${p.hub.parts.map((x) => `${x.shown} (${x.role})`).join(', ') || 'none'}.\nRing (${p.ring.items.length} of ${total} neighbors; phonetic-series ${c['phonetic-series']}, shares-part ${c['shares-part']}, built-on ${c['built-on']}):\n${lines.join('\n')}${demo ? '\nNo learner state was passed, so a demo learner who knows 15 kanji is assumed.' : ''}`,
            },
          ],
          structuredContent: p as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return text((e as Error).message, true);
      }
    },
  );

  // App-only tools: the compass calls these as the learner moves and answers. Hidden from the model.
  registerAppTool(
    server,
    'compass_move',
    {
      title: 'Compass: move the hub',
      description: 'App only. Returns the hub and ring for a kanji the learner selected.',
      inputSchema: { hub: kanjiChar, ...stateArgs, relation: z.enum(['all', ...RELATIONS]).optional(), page: z.number().int().min(0).max(80).optional(), focus: kanjiChar.optional() },
      _meta: { ui: { resourceUri: COMPASS_URI, visibility: ['app'] } },
    },
    async (a) => {
      const { state, demo } = stateOf(a);
      try {
        const p = await hubPayload(a.hub, state, a.relation ?? 'all', a.page ?? 0, demo, a.focus);
        return { content: [{ type: 'text', text: `hub ${a.hub}` }], structuredContent: p as unknown as Record<string, unknown> };
      } catch (e) {
        return text((e as Error).message, true);
      }
    },
  );

  const kind = z.enum(['form', 'sound']);
  registerAppTool(
    server,
    'compass_question',
    {
      title: 'Compass: ask a question',
      description: "App only. A four-option question about a kanji. The answer and each option's relation stay on the server until an answer is submitted.",
      inputSchema: { target: kanjiChar, kind, met: metArg },
      _meta: { ui: { resourceUri: COMPASS_URI, visibility: ['app'] } },
    },
    async (a) => {
      try {
        const q = buildQuestion(a.target, a.kind, a.met ?? DEMO_MET);
        return { content: [{ type: 'text', text: q.prompt }], structuredContent: publicQuestion(q) as unknown as Record<string, unknown> };
      } catch (e) {
        return text((e as Error).message, true);
      }
    },
  );
  registerAppTool(
    server,
    'compass_answer',
    {
      title: 'Compass: grade an answer',
      description: 'App only. Grades a chosen option against the question the server rebuilds, and names the relation behind a wrong choice.',
      inputSchema: { target: kanjiChar, kind, met: metArg, chosen: z.string().regex(/^o[0-3]$/) },
      _meta: { ui: { resourceUri: COMPASS_URI, visibility: ['app'] } },
    },
    async (a) => {
      try {
        const q = buildQuestion(a.target, a.kind, a.met ?? DEMO_MET);
        const v = judge(q, a.chosen);
        return { content: [{ type: 'text', text: v.correct ? 'correct' : (v.diagnosis?.fact ?? 'incorrect') }], structuredContent: v as unknown as Record<string, unknown> };
      } catch (e) {
        return text((e as Error).message, true);
      }
    },
  );
}
