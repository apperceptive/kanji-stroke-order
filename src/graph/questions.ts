import { getNode, gloss, SEED, type KanjiNode } from './graph.js';
import { builtOn, centerParts, phoneticSeries, sharesPart, sharesReading, devoice, type Relation } from './relations.js';

/**
 * One question whose distractors come from named relations (P-012, P-019). The relation is a graph fact; the
 * wording below is a template over graph fields, so a host model can phrase it but adds no claims (B4).
 * Distractors are met kanji only (P-025 rule 3); when too few are met the rest are declared neutral.
 */
export type QuestionKind = 'form' | 'sound';
export type DistractorRelation = Relation | 'part' | 'shares-reading' | 'neutral';

export interface Diagnosis {
  relation: DistractorRelation;
  /** The kanji the chosen option belongs to. */
  owner: string;
  via?: string;
  /** The graph fact that makes this option a diagnosis, ready to show. */
  fact: string;
}

interface Option {
  text: string;
  correct: boolean;
  diagnosis?: Diagnosis;
}

export interface Question {
  kind: QuestionKind;
  target: string;
  prompt: string;
  options: Option[];
}

export interface PublicQuestion {
  kind: QuestionKind;
  target: string;
  prompt: string;
  options: { id: string; text: string }[];
}

export interface Verdict {
  correct: boolean;
  answerId: string;
  answerText: string;
  chosenId: string;
  diagnosis?: Diagnosis;
  /** Every option with the relation behind it, revealed once the learner has answered. */
  options: { id: string; text: string; correct: boolean; relation: DistractorRelation | 'answer'; owner: string; via?: string }[];
  /** The compass position that shows the answer and the chosen option's owner. */
  walk: { hub: string; highlight?: string };
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const words = (n: KanjiNode) => new Set(n.m.flatMap((m) => m.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 2));
const overlaps = (a: KanjiNode, b: KanjiNode) => [...words(a)].some((w) => words(b).has(w));
const g = (k: string) => `${k} (${gloss(getNode(k)!)})`;

interface Cand {
  owner: string;
  relation: DistractorRelation;
  via?: string;
  reading?: string;
  hubReading?: string;
  sound?: 'exact' | 'voicing' | 'source';
  brk?: boolean;
  sameRole?: boolean;
}

/** Everything related to the target that a learner might confuse it with. */
function candidates(a: KanjiNode): Cand[] {
  const out: Cand[] = [];
  for (const e of phoneticSeries(a)) out.push({ owner: e.to, relation: 'phonetic-series', via: e.via, reading: e.reading, hubReading: e.hubReading, sound: e.sound });
  for (const e of sharesPart(a)) out.push({ owner: e.to, relation: 'shares-part', via: e.via, brk: e.break, sameRole: e.sameRole });
  for (const p of centerParts(a)) if (p.navigable && p.e !== a.c) out.push({ owner: p.e, relation: 'part', via: p.e });
  for (const e of builtOn(a)) out.push({ owner: e.to, relation: 'built-on', via: a.c });
  for (const s of sharesReading(a)) out.push({ owner: s.to, relation: 'shares-reading', reading: s.reading });
  return out;
}

const ORDER: DistractorRelation[] = ['phonetic-series', 'shares-part', 'part', 'built-on', 'shares-reading'];
const SEED_SET = new Set(SEED);
const rankOwner = (k: string) => {
  const n = getNode(k)!;
  return [SEED_SET.has(k) ? 0 : 1, n.g ?? 9, n.f ?? 99999];
};
const byRank = (x: string, y: string) => {
  const a = rankOwner(x);
  const b = rankOwner(y);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};

function formFact(a: KanjiNode, c: Cand): string {
  const d = g(c.owner);
  switch (c.relation) {
    case 'part':
      return `${d} is a piece of ${a.c}. That is the part, not the whole.`;
    case 'built-on':
      return `${d} has ${a.c} inside it, but it is a different kanji.`;
    case 'shares-part':
      return `${d} and ${a.c} are both made with ${c.via}. ${c.brk ? `${c.via} is the sound part in both, but they read differently.` : c.sameRole ? `${c.via} does the same job in both.` : `${c.via} does a different job in each.`}`;
    case 'phonetic-series':
      return `${d} is in the same sound series as ${a.c} (${c.via}): both read ${c.sound === 'voicing' ? `alike, ${c.reading} against ${c.hubReading}` : c.reading}. Same sound, different kanji.`;
    case 'shares-reading':
      return `${d} reads ${c.reading} like ${a.c}, but they share no part. Only the sound is the same.`;
    default:
      return `${d} has no relation to ${a.c}: just a different kanji.`;
  }
}

function soundFact(a: KanjiNode, c: Cand, reading: string): string {
  const d = g(c.owner);
  switch (c.relation) {
    case 'part':
      return `${reading} is how ${d} reads, a piece of ${a.c}. You read the part, not the whole.`;
    case 'built-on':
      return `${reading} is how ${d} reads. ${d} has ${a.c} inside it, but it is a different kanji.`;
    case 'shares-part':
      return c.brk
        ? `${reading} is how ${d} reads. ${c.via} is the sound part in both, but it does not always give the sound: this is one of the breaks.`
        : `${reading} is how ${d} reads. It shares ${c.via} with ${a.c}, but sharing a piece does not give you the sound.`;
    case 'phonetic-series':
      return `${reading} is how ${d} reads. It is in ${a.c}'s sound series (${c.via}), the same sound ${devoice(reading) === reading ? 'unvoiced' : 'voiced'}: ${a.c} reads ${c.hubReading}.`;
    default:
      return `${reading} is how ${d} reads, which has no relation to ${a.c}.`;
  }
}

/** Build the question for a target kanji. Deterministic in (target, kind, met), so the server can regrade it. */
export function buildQuestion(targetChar: string, kind: QuestionKind, met: string[]): Question {
  const a = getNode(targetChar);
  if (!a) throw new Error(`"${targetChar}" is not in the jōyō set this graph covers`);
  const metSet = new Set(met);
  const rand = rng(hash(`${targetChar}|${kind}|${[...met].sort().join('')}`));
  const all = candidates(a).filter((c) => metSet.has(c.owner) && c.owner !== a.c);

  const picked: Cand[] = [];
  const takenOwners = new Set<string>();
  const takenText = new Set<string>(kind === 'sound' ? a.on : [a.c]);
  const textOf = (c: Cand) => (kind === 'sound' ? getNode(c.owner)!.on.find((r) => !a.on.includes(r)) : c.owner);
  const usable = (c: Cand) => {
    const t = textOf(c);
    if (!t || takenText.has(t) || takenOwners.has(c.owner)) return false;
    if (kind === 'form' && overlaps(a, getNode(c.owner)!)) return false; // an also-correct answer (P-018)
    if (kind === 'sound' && c.relation === 'phonetic-series' && c.sound === 'exact') return false;
    return true;
  };
  for (const relation of ORDER) {
    if (picked.length >= 3) break;
    const pool = all.filter((c) => c.relation === relation && usable(c)).sort((x, y) => byRank(x.owner, y.owner));
    const c = pool[0];
    if (c) {
      picked.push(c);
      takenOwners.add(c.owner);
      takenText.add(textOf(c)!);
    }
  }
  // Neutral fill: kanji with no relation to the target, met first, then the reviewed seed. Declared neutral.
  if (picked.length < 3) {
    const related = new Set(candidates(a).map((c) => c.owner));
    const pool = [...new Set([...met, ...SEED])]
      .filter((k) => k !== a.c && getNode(k) && !related.has(k))
      .filter((k) => (kind === 'sound' ? getNode(k)!.on.some((r) => !a.on.includes(r)) : !overlaps(a, getNode(k)!)));
    for (const k of shuffle(pool, rand)) {
      if (picked.length >= 3) break;
      const c: Cand = { owner: k, relation: 'neutral' };
      if (!usable(c)) continue;
      picked.push(c);
      takenOwners.add(k);
      takenText.add(textOf(c)!);
    }
  }

  const options: Option[] = [
    { text: kind === 'sound' ? a.on[0] : a.c, correct: true },
    ...picked.map((c): Option => {
      const text = textOf(c)!;
      return { text, correct: false, diagnosis: { relation: c.relation, owner: c.owner, via: c.via, fact: kind === 'sound' ? soundFact(a, c, text) : formFact(a, c) } };
    }),
  ];
  const prompt = kind === 'sound' ? `How is ${a.c} read?` : `Which kanji means “${gloss(a)}”?`;
  return { kind, target: a.c, prompt, options: shuffle(options, rand) };
}

export function publicQuestion(q: Question): PublicQuestion {
  return { kind: q.kind, target: q.kind === 'sound' ? q.target : '', prompt: q.prompt, options: q.options.map((o, i) => ({ id: `o${i}`, text: o.text })) };
}

export function judge(q: Question, chosenId: string): Verdict {
  const i = Number(chosenId.replace('o', ''));
  const chosen = q.options[i];
  if (!chosen) throw new Error(`no option ${chosenId}`);
  const answerIdx = q.options.findIndex((o) => o.correct);
  return {
    correct: chosen.correct,
    answerId: `o${answerIdx}`,
    answerText: q.options[answerIdx].text,
    chosenId,
    diagnosis: chosen.diagnosis,
    options: q.options.map((o, j) => ({ id: `o${j}`, text: o.text, correct: o.correct, relation: o.diagnosis?.relation ?? 'answer', owner: o.diagnosis?.owner ?? q.target, via: o.diagnosis?.via })),
    walk: { hub: q.target, highlight: chosen.diagnosis?.owner },
  };
}
