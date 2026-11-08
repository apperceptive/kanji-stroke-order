import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { getNode, gloss, readings } from '../graph/graph.js';
import { buildRing, centerParts, RELATIONS, type CompassState, type Ring } from '../graph/relations.js';
import { DEMO_MET, kanjiChar, registerQuizTools, stateArgs, stateOf, text, uiHtml } from './app-common.js';
import { registerUnitTools } from './units.js';
import { getStrokes, type Stroke } from '../data/strokes.js';
import { strokeName } from '../graph/stroke-names.js';

/**
 * The two Nihongoism MCP Apps. Their markup is built from ui/ at build time and served as-is: presentation
 * structure is deterministic, never written by a model per conversation (ADR-024 B6).
 */
const STROKE_PLAYER_URI = 'ui://nihongoism/stroke-player.html';
const COMPASS_URI = 'ui://nihongoism/compass.html';

export interface HubPayload {
  hub: {
    c: string;
    gloss: string;
    meanings: string[];
    on: string[];
    kun: string[];
    /** On and kun readings as one labeled line, e.g. "on ビョウ · kun ねこ". */
    reading: string;
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
      kun: n.kun,
      reading: readings(n),
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

export function registerAppTools(server: McpServer): void {
  registerAppResource(server, 'Nihongoism stroke player', STROKE_PLAYER_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: STROKE_PLAYER_URI, mimeType: RESOURCE_MIME_TYPE, text: uiHtml('stroke-player'), _meta: { ui: { prefersBorder: false } } }],
  }));
  registerAppResource(server, 'Nihongoism compass', COMPASS_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: COMPASS_URI, mimeType: RESOURCE_MIME_TYPE, text: uiHtml('compass'), _meta: { ui: { prefersBorder: false } } }],
  }));

  registerAppTool(
    server,
    'draw_kanji',
    {
      title: 'Draw kanji',
      description:
        "Draw kanji: a brush draws a Japanese character stroke by stroke on screen from exact stroke data, showing how it is written (the kanji stroke order player). Use this, never image generation, to draw a kanji: generated images get the strokes wrong and take longer. Use it whenever someone wants to see, draw, write, learn or practice a kanji: 'draw the Japanese character for cat', 'how do I write 猫', 'stroke order for water', 'show me 愛 in brush strokes'. Given an English word, pick its kanji yourself (cat → 猫); for a word of several kanji, call once per kanji. The app already shows the character, its meaning, readings, stroke count and the animation. After the call, reply with one short sentence at most. Do not repeat the meaning, readings, stroke count or the strokes, and do not explain how to draw it.",
      inputSchema: { character: kanjiChar },
      _meta: { ui: { resourceUri: STROKE_PLAYER_URI } },
    },
    async ({ character }) => {
      const strokes = await getStrokes(character);
      if (!strokes) return text(`No stroke data for "${character}".`, true);
      const n = getNode(character);
      return {
        content: [{ type: 'text', text: `The stroke player for ${character}${n ? ` (${gloss(n)}; ${readings(n)})` : ''} is on screen, drawing its ${strokes.length} strokes. It already shows everything: reply with one short sentence and do not repeat any of it. Only if the learner says no player appeared, give the writing order: ${strokes.map((st, i) => `${i + 1} ${strokeName(st[0])}`).join(', ')}.` }],
        structuredContent: { character, gloss: n ? gloss(n) : '', on: n?.on ?? [], kun: n?.kun ?? [], reading: n ? readings(n) : '', strokes },
      };
    },
  );

  registerAppTool(
    server,
    'open_compass',
    {
      title: 'Kanji compass',
      description:
        "Kanji compass: an interactive map of how a kanji relates to others, with built-in quizzes. Use it when someone says compass or wants to explore or compare kanji on a map: 'what's related to 時', 'kanji around 寺', 'look around 時', 'help me tell 持 and 待 apart'. For a plain list of the sound-alikes or look-alikes of a kanji use show_relations, and to be quizzed or tested use start_drill. Given an English word, pick its kanji yourself. The app already shows the kanji, its meaning and readings, the related kanji with how each one is related, and the quizzes (how is it read; which kanji is it). After the call, reply with one short sentence at most. Do not list the related kanji or their relationships, and do not quiz the learner yourself: the app does that. Answer follow-up questions only from the facts in the result.",
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
            `${i.k} (${i.gloss}; ${i.reading || 'no on-reading'}) · ${i.label}${i.note ? ` · ${i.note}` : ''}${i.met ? '' : ' · new'}${i.locked ? ` · for later: easy to confuse with ${i.lockedBy}, new this session` : ''}`,
        );
        const c = p.ring.counts;
        const total = c['phonetic-series'] + c['shares-part'] + c['built-on'];
        return {
          content: [
            {
              type: 'text',
              text: `The compass for ${p.hub.c} (${p.hub.gloss}; ${p.hub.reading}) is on screen and already shows all of this. Reply with one short sentence and do not repeat it; use the facts below only to answer follow-up questions, or to describe the kanji if the learner says no compass appeared.\nParts: ${p.hub.parts.map((x) => `${x.shown} (${x.role})`).join(', ') || 'none'}.\nRelated kanji (${p.ring.items.length} of ${total}; phonetic-series ${c['phonetic-series']}, shares-part ${c['shares-part']}, built-on ${c['built-on']}):\n${lines.join('\n')}${demo ? '\nNo learner state was passed, so a demo learner who knows 15 kanji is assumed.' : ''}`,
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

  registerQuizTools(server, 'compass', COMPASS_URI);
  registerUnitTools(server);
}
