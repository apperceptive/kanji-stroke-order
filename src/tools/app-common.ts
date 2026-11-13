import fs from 'node:fs';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { CompassState } from '../graph/relations.js';
import { buildQuestion, judge, publicQuestion } from '../graph/questions.js';

/** What the Nihongoism MCP Apps share: the learner state they pass, the tool arguments, the markup loader and the quiz tools. */

/**
 * A demo learner, because this server has no sign-in and records nothing. The host may pass the kanji the
 * learner has met; this is what a call with none starts from.
 */
export const DEMO_MET = [...'日月火水木金土一人大口時持寺待'];

export const kanjiChar = z.string().length(1).describe("A single kanji, e.g. '猫'. If the learner gave an English word or a meaning, choose its most common kanji yourself (cat → 猫).");
export const metArg = z
  .array(z.string().length(1))
  .max(300)
  .optional()
  .describe('Kanji the learner has already met, if known. Ranked first in the ring and the only source of wrong-answer options.');

export const stateArgs = {
  met: metArg,
  introduced: z.array(z.string().length(1)).max(100).optional().describe('Kanji introduced in this session and not yet met.'),
};
export const stateOf = (a: { met?: string[]; introduced?: string[] }): { state: CompassState; demo: boolean } => ({
  state: { met: a.met ?? DEMO_MET, introduced: a.introduced ?? [] },
  demo: a.met === undefined,
});

export function uiHtml(name: string): string {
  return fs.readFileSync(new URL(`../../ui-dist/${name}.html`, import.meta.url), 'utf8');
}

export function text(t: string, isError = false) {
  return { content: [{ type: 'text' as const, text: t }], ...(isError ? { isError: true } : {}) };
}

const questionKind = z.enum(['form', 'sound']);

/**
 * The app-only question and answer tools an app calls to quiz the learner. Each app that quizzes registers its
 * own pair (`<prefix>_question`, `<prefix>_answer`) bound to its own resource, because a host may only let an app
 * call the tools that belong to it. Answers stay on the server until an answer is submitted.
 */
export function registerQuizTools(server: McpServer, prefix: string, resourceUri: string): void {
  registerAppTool(
    server,
    `${prefix}_question`,
    {
      title: `${prefix}: ask a question`,
      description: "App only. A four-option question about a kanji. The answer and each option's relation stay on the server until an answer is submitted.",
      inputSchema: { target: kanjiChar, kind: questionKind, met: metArg },
      _meta: { ui: { resourceUri, visibility: ['app'] } },
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
    `${prefix}_answer`,
    {
      title: `${prefix}: grade an answer`,
      description: 'App only. Grades a chosen option against the question the server rebuilds, and names the relation behind a wrong choice.',
      inputSchema: { target: kanjiChar, kind: questionKind, met: metArg, chosen: z.string().regex(/^o[0-3]$/) },
      _meta: { ui: { resourceUri, visibility: ['app'] } },
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
