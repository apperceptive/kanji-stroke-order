import { getNode } from './graph.js';
import { RELATIONS, ringCandidates, type CompassState, type Relation } from './relations.js';
import type { QuestionKind } from './questions.js';

/** What a learner calls each relation, for the view app's headings and the utterances it suggests. */
export const RELATION_NAMES: Record<Relation, string> = {
  'phonetic-series': 'sound-alikes',
  'shares-part': 'look-alikes',
  'built-on': 'kanji built on it',
};

export interface DrillItem {
  target: string;
  kind: QuestionKind;
}

/**
 * The questions of a drill: the hub first, then its neighbors the learner has met, the relations taking turns,
 * then other kanji the learner has met. Questions alternate between "which kanji" and "how is it read"; a kanji
 * with no on-reading is only asked the first way. Asking about met kanji keeps the wait rule (P-025): nothing
 * unmet is a target, and the question's wrong answers are drawn from met kanji too.
 */
export function drillItems(hubChar: string, state: CompassState, length: number): DrillItem[] {
  const hub = getNode(hubChar);
  if (!hub) throw new Error(`"${hubChar}" is not in the jōyō set this graph covers`);
  const cands = ringCandidates(hub, state);
  const lists = RELATIONS.map((r) => cands.get(r)!.filter((c) => c.item.met).map((c) => c.item.k));
  const targets = [hubChar];
  while (targets.length < length && lists.some((l) => l.length)) {
    for (const l of lists) {
      const k = l.shift();
      if (k && !targets.includes(k) && targets.length < length) targets.push(k);
    }
  }
  for (const k of state.met) {
    if (targets.length >= length) break;
    if (!targets.includes(k) && getNode(k)) targets.push(k);
  }
  return targets.map((target, i) => ({ target, kind: i % 2 === 1 && getNode(target)!.on.length ? 'sound' : 'form' }));
}
