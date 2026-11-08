import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { getNode, gloss, readings } from '../graph/graph.js';
import { buildRing, RELATIONS, ringCandidates, type Relation } from '../graph/relations.js';
import { drillItems, RELATION_NAMES } from '../graph/drill.js';
import { kanjiChar, registerQuizTools, stateArgs, stateOf, text, uiHtml } from './app-common.js';

/**
 * Two small apps, one per kind (docs: vault note "Application Design in the MCP Era"):
 *
 * - A **view app** shows one thing about one subject, grades nothing, and ends by offering what the learner might
 *   say next. `show_relations` is the first.
 * - A **drill app** asks a short run of graded questions inside its panel, with no model turn between them, and
 *   reports the result when it ends. `start_drill` is the first.
 *
 * Each runs from its arguments alone. Both are prototypes for timing hand-offs in real hosts.
 */
const RELATIONS_URI = 'ui://nihongoism/relations.html';
const DRILL_URI = 'ui://nihongoism/drill.html';

export interface Suggestion {
  label: string;
  utterance: string;
}

const relationArg = z
  .enum(['phonetic-series', 'shares-part', 'built-on'])
  .optional()
  .describe("Which relation to show: 'phonetic-series' (kanji that sound alike through a shared sound part), 'shares-part' (kanji that look alike through a shared part), 'built-on' (kanji that contain this one). Omit to start with the sound-alikes, or the first kind this kanji has.");

export function registerUnitTools(server: McpServer): void {
  registerAppResource(server, 'Nihongoism relations view', RELATIONS_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: RELATIONS_URI, mimeType: RESOURCE_MIME_TYPE, text: uiHtml('relations'), _meta: { ui: { prefersBorder: false } } }],
  }));
  registerAppResource(server, 'Nihongoism drill', DRILL_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: DRILL_URI, mimeType: RESOURCE_MIME_TYPE, text: uiHtml('drill'), _meta: { ui: { prefersBorder: false } } }],
  }));

  registerAppTool(
    server,
    'show_relations',
    {
      title: 'Related kanji',
      description:
        "Related kanji: one kind of relation at a time, listed. Use it when someone asks which kanji sound alike, look alike or are built on another: 'which kanji sound like 時', 'what looks like 持', 'kanji that look like 待', 'what is built on 木', 'sound-alikes of 寺'. Given an English word, pick its kanji yourself. The app lists the related kanji with how each is related and offers the next questions as buttons. After the call, reply with one short sentence at most; do not list the kanji or repeat the relationships. For a whole map to explore, use open_compass instead.",
      inputSchema: { hub: kanjiChar, relation: relationArg, ...stateArgs },
      _meta: { ui: { resourceUri: RELATIONS_URI } },
    },
    async (a) => {
      const { state, demo } = stateOf(a);
      const n = getNode(a.hub);
      if (!n) return text(`"${a.hub}" is not in the jōyō set this graph covers`, true);
      const counts = Object.fromEntries(RELATIONS.map((r) => [r, ringCandidates(n, state).get(r)!.length])) as Record<Relation, number>;
      const relation = a.relation ?? RELATIONS.find((r) => counts[r] > 0) ?? 'phonetic-series';
      const ring = buildRing(a.hub, state, relation, 0);
      const suggested_next: Suggestion[] = [
        ...RELATIONS.filter((r) => r !== relation && counts[r] > 0).map((r) => ({ label: `Show the ${RELATION_NAMES[r]}`, utterance: `Show me the ${RELATION_NAMES[r]} of ${a.hub}` })),
        { label: 'Quiz me', utterance: `Quiz me on ${a.hub}` },
        { label: 'Show the strokes', utterance: `Show me how to write ${a.hub}` },
      ];
      const lines = ring.items.map((i) => `${i.k} (${i.gloss}; ${i.reading || 'no on-reading'}) · ${i.label}${i.note ? ` · ${i.note}` : ''}${i.met ? '' : ' · new'}`);
      return {
        content: [
          {
            type: 'text',
            text: `The ${RELATION_NAMES[relation]} of ${a.hub} (${gloss(n)}; ${readings(n)}) are on screen, ${ring.items.length} of ${counts[relation]}, with buttons for what to look at next. Reply with one short sentence and do not repeat them; use the facts below only to answer follow-up questions, or if the learner says nothing appeared.\n${lines.join('\n')}${demo ? '\nNo learner state was passed, so a demo learner who knows 15 kanji is assumed.' : ''}`,
          },
        ],
        structuredContent: {
          hub: { c: n.c, gloss: gloss(n), reading: readings(n) },
          relation,
          relationName: RELATION_NAMES[relation],
          counts,
          items: ring.items,
          state,
          demo,
          suggested_next,
        },
      };
    },
  );

  registerAppTool(
    server,
    'start_drill',
    {
      title: 'Kanji drill',
      description:
        "Kanji drill: a short run of quick questions on one kanji and the kanji the learner knows around it, asked and graded in the app. Use this, never your own quiz or flashcard feature and never a quiz in text, whenever someone wants to be quizzed, tested or to practice a kanji: 'quiz me on 時', 'test me on kanji', 'practice 猫', 'drill me on these'. Given an English word, pick its kanji yourself. The app asks every question and reports the score at the end; do not ask the questions yourself. After the call, reply with one short sentence at most.",
      inputSchema: { hub: kanjiChar, length: z.number().int().min(3).max(10).optional().describe('How many questions. Default 5.'), ...stateArgs },
      _meta: { ui: { resourceUri: DRILL_URI } },
    },
    async (a) => {
      const { state, demo } = stateOf(a);
      const n = getNode(a.hub);
      if (!n) return text(`"${a.hub}" is not in the jōyō set this graph covers`, true);
      const items = drillItems(a.hub, state, a.length ?? 5);
      const suggested_next: Suggestion[] = [
        { label: 'Quiz me again', utterance: `Quiz me again on ${a.hub}` },
        { label: `Show the ${RELATION_NAMES['phonetic-series']}`, utterance: `Show me the ${RELATION_NAMES['phonetic-series']} of ${a.hub}` },
      ];
      return {
        content: [{ type: 'text', text: `A ${items.length}-question drill on ${a.hub} (${gloss(n)}) is on screen. The app asks and grades every question and tells you the score when it ends: reply with one short sentence and do not ask the questions yourself.${demo ? ' No learner state was passed, so a demo learner who knows 15 kanji is assumed.' : ''}` }],
        structuredContent: { hub: { c: n.c, gloss: gloss(n) }, items, state, demo, suggested_next },
      };
    },
  );

  // The drill grades through its own pair of app-only tools; they work with no model turn between questions.
  registerQuizTools(server, 'drill', DRILL_URI);
}
