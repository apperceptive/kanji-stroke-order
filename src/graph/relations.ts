import { getNode, loadGraph, SEED, gloss, type KanjiNode, type Part } from './graph.js';

/**
 * The ring's relations (Apperceptive Pedagogy D-P9), computed from KanjiVG's component tree.
 * KRADFILE appears only in crossCheck(); it lists radical elements, not parts.
 */
export type Relation = 'phonetic-series' | 'shares-part' | 'built-on';
export const RELATIONS: Relation[] = ['phonetic-series', 'shares-part', 'built-on'];

export type PartRole = 'sound' | 'radical' | 'part';

export interface Edge {
  relation: Relation;
  to: string;
  /** The shared or contained part. */
  via: string;
  /** shares-part: the piece does the same job in both kanji. */
  sameRole?: boolean;
  samePos?: boolean;
  /** phonetic-series: the neighbor's reading matches exactly, or only once voicing is ignored. */
  sound?: 'exact' | 'voicing' | 'source';
  hubReading?: string;
  reading?: string;
  /** shares-part where both parts are the sound part but the readings do not agree. */
  break?: boolean;
}

// --- sound -----------------------------------------------------------------------------------

const VOICED = 'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ';
const PLAIN = 'カキクケコサシスセソタチツテトハヒフヘホハヒフヘホ';
/** A reading with its first mora unvoiced, so ジ and シ meet (P-011's near-carrier). */
export const devoice = (r: string): string => {
  const i = VOICED.indexOf(r[0] ?? '');
  return i < 0 ? r : PLAIN[i] + r.slice(1);
};

function soundMatch(a: string[], b: string[]): { kind: 'exact' | 'voicing'; a: string; b: string } | null {
  for (const x of a) for (const y of b) if (x === y) return { kind: 'exact', a: x, b: y };
  for (const x of a) for (const y of b) if (devoice(x) === devoice(y)) return { kind: 'voicing', a: x, b: y };
  return null;
}

// --- indexes ---------------------------------------------------------------------------------

export const roleOf = (p: Part): PartRole => (p.ph ? 'sound' : p.rad ? 'radical' : 'part');

interface Indexes {
  kradElements: Set<string>;
  /** element → kanji that have it as a visible top-level part */
  byPart: Map<string, string[]>;
  /** element → kanji that contain it at any depth */
  byDeep: Map<string, string[]>;
  /** element → kanji that carry it as the marked sound part */
  byPhon: Map<string, string[]>;
  /** on-reading → kanji */
  byReading: Map<string, string[]>;
}

let idx: Indexes | null = null;
function indexes(): Indexes {
  if (idx) return idx;
  const g = loadGraph();
  const kradElements = new Set(g.kradElements);
  const byPart = new Map<string, string[]>();
  const byDeep = new Map<string, string[]>();
  const byPhon = new Map<string, string[]>();
  const byReading = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const a = m.get(k);
    if (a) a.push(v);
    else m.set(k, [v]);
  };
  for (const n of Object.values(g.kanji)) {
    for (const p of n.parts) {
      if (isVisible(p, kradElements)) push(byPart, p.e, n.c);
      if (p.ph) push(byPhon, p.e, n.c);
    }
    for (const e of n.deep) push(byDeep, e, n.c);
    for (const r of n.on) push(byReading, r, n.c);
  }
  idx = { kradElements, byPart, byDeep, byPhon, byReading };
  return idx;
}

/**
 * A part counts if it is something with a name (a kanji, or an element KRADFILE inventories) and has two
 * or more strokes, so one-stroke pieces never form a family (D-P9).
 */
function isVisible(p: Part, krad: Set<string>): boolean {
  return p.n >= 2 && (!!loadGraph().kanji[p.e] || krad.has(p.e));
}
export const visibleParts = (n: KanjiNode): Part[] => n.parts.filter((p) => isVisible(p, indexes().kradElements));

// --- the three relations ---------------------------------------------------------------------

/** phonetic-series: a shared sound part (marked by KanjiVG in both) and a shared on-reading. */
export function phoneticSeries(hub: KanjiNode): Edge[] {
  const { byPhon } = indexes();
  const out: Edge[] = [];
  const seen = new Set<string>();
  const add = (e: Edge) => {
    if (seen.has(e.to)) return;
    seen.add(e.to);
    out.push(e);
  };
  // Series the hub belongs to as a carrier: it has a sound part P.
  for (const p of hub.parts.filter((x) => x.ph)) {
    const source = getNode(p.e);
    if (source && source.c !== hub.c && source.on.length) {
      const m = soundMatch(hub.on, source.on);
      if (m) add({ relation: 'phonetic-series', to: source.c, via: p.e, sound: 'source', hubReading: m.a, reading: m.b });
    }
    for (const c of byPhon.get(p.e) ?? []) {
      if (c === hub.c) continue;
      const m = soundMatch(hub.on, getNode(c)!.on);
      if (m) add({ relation: 'phonetic-series', to: c, via: p.e, sound: m.kind, hubReading: m.a, reading: m.b });
    }
  }
  // Series the hub is the source of: other kanji carry it as their sound part.
  for (const c of byPhon.get(hub.c) ?? []) {
    if (c === hub.c) continue;
    const m = soundMatch(hub.on, getNode(c)!.on);
    if (m) add({ relation: 'phonetic-series', to: c, via: hub.c, sound: m.kind, hubReading: m.a, reading: m.b });
  }
  return out;
}

/** shares-part: a visible top-level part in common, with a note on whether it does the same job. */
export function sharesPart(hub: KanjiNode): Edge[] {
  const { byPart } = indexes();
  const out: Edge[] = [];
  for (const p of visibleParts(hub)) {
    for (const c of byPart.get(p.e) ?? []) {
      if (c === hub.c) continue;
      const other = getNode(c)!;
      const q = other.parts.find((x) => x.e === p.e)!;
      const bothSound = !!p.ph && !!q.ph;
      const agree = bothSound && soundMatch(hub.on, other.on) !== null;
      if (agree) continue; // that pair is a phonetic-series edge
      out.push({
        relation: 'shares-part',
        to: c,
        via: p.e,
        sameRole: roleOf(p) === roleOf(q),
        samePos: !!p.pos && p.pos === q.pos,
        break: bothSound,
      });
    }
  }
  return out;
}

/** built-on: the neighbor contains the hub as a part at any depth. */
export function builtOn(hub: KanjiNode): Edge[] {
  const { byDeep } = indexes();
  return (byDeep.get(hub.c) ?? []).filter((c) => c !== hub.c).map((c) => ({ relation: 'built-on' as const, to: c, via: hub.c }));
}

/** Two kanji that read alike with nothing in common to see: used as a distractor relation only. */
export function sharesReading(hub: KanjiNode): { to: string; reading: string }[] {
  const { byReading } = indexes();
  const out: { to: string; reading: string }[] = [];
  const seen = new Set<string>();
  for (const r of hub.on) {
    for (const c of byReading.get(r) ?? []) {
      if (c === hub.c || seen.has(c)) continue;
      const n = getNode(c)!;
      const sharedPart = visibleParts(hub).some((p) => n.parts.some((q) => q.e === p.e));
      if (sharedPart || n.deep.includes(hub.c) || hub.deep.includes(c)) continue;
      seen.add(c);
      out.push({ to: c, reading: r });
    }
  }
  return out;
}

// --- confusability (P-025) -------------------------------------------------------------------

/**
 * Whether two kanji have alike cues and different answers, so that introducing both in one session
 * interferes. Carriers of one series are exempt: their cues are alike and their answers agree.
 */
export function confusable(a: string, b: string): boolean {
  if (a === b) return false;
  const x = getNode(a);
  const y = getNode(b);
  if (!x || !y) return false;
  for (const p of x.parts) {
    const q = y.parts.find((r) => r.e === p.e);
    if (p.ph && q?.ph) {
      const m = soundMatch(x.on, y.on);
      if (m?.kind === 'exact') return false;
    }
  }
  if (x.deep.includes(b) || y.deep.includes(a)) return true;
  const vx = new Set(visibleParts(x).map((p) => p.e));
  if (visibleParts(y).some((p) => vx.has(p.e))) return true;
  return x.on.some((r) => y.on.includes(r));
}

// --- the ring ---------------------------------------------------------------------------------

export interface RingItem {
  k: string;
  relation: Relation;
  /** Every part through which this neighbor is related, hub's own form first. */
  via: string[];
  label: string;
  note?: string;
  gloss: string;
  reading: string;
  met: boolean;
  /** Unmet and confusable with a kanji introduced this session: it waits for another day (P-025 rule 1). */
  locked: boolean;
  lockedBy?: string;
  inSeed: boolean;
}

export interface CompassState {
  /** Kanji the learner has already met. */
  met: string[];
  /** Kanji introduced this session, not yet met. */
  introduced: string[];
}

const SEED_SET = new Set(SEED);
export const RING_CAP = 6;

function partName(e: string): string {
  const s = getNode(e);
  return s ? e : e;
}

function labelFor(e: Edge, hub: KanjiNode): { label: string; note?: string } {
  const via = partName(e.via);
  if (e.relation === 'built-on') return { label: `built on ${hub.c}`, note: `${hub.c} is inside it` };
  if (e.relation === 'phonetic-series') {
    if (e.sound === 'source') return { label: `sound source`, note: `${via} gives ${hub.c} its sound: ${hub.c} reads ${e.hubReading}, ${via} reads ${e.reading}` };
    if (e.sound === 'voicing') return { label: `sound ${via}`, note: `${via} gives the sound. ${e.reading}, the ${devoice(e.reading!) === e.reading ? 'unvoiced' : 'voiced'} twin of ${e.hubReading}` };
    return { label: `sound ${via}`, note: `${via} gives the sound in both, and both read ${e.reading}` };
  }
  const role = e.sameRole ? `${via} does the same job in both` : `${via} does a different job in each`;
  return { label: `shares ${via}`, note: e.break ? `${via} is the sound part in both, but they read differently` : role };
}

function rankKey(it: RingItem, e: Edge, metSet: Set<string>, hub: KanjiNode) {
  const n = getNode(it.k)!;
  const viaSound = hub.parts.some((p) => p.ph && p.e === e.via);
  return [
    it.locked ? 1 : 0,
    metSet.has(it.k) ? 0 : 1,
    viaSound ? 0 : 1, // a family through the hub's sound part carries the most to teach
    SEED_SET.has(it.k) ? 0 : 1,
    e.relation === 'shares-part' ? (e.sameRole ? 0 : 1) : 0,
    e.relation === 'shares-part' ? (e.samePos ? 0 : 1) : 0,
    n.g ?? 9,
    n.f ?? 99999,
    n.sc,
  ];
}
function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export interface Ring {
  hub: string;
  items: RingItem[];
  /** Candidate counts per relation, before the cap. */
  counts: Record<Relation, number>;
  relation: Relation | 'all';
  page: number;
  pages: number;
  /** Candidates that are locked this session. */
  lockedCount: number;
}

/** The hub's neighbors by relation, one entry per neighbor (strongest relation wins), ranked. */
export function ringCandidates(hub: KanjiNode, state: CompassState): Map<Relation, { item: RingItem; edge: Edge }[]> {
  const metSet = new Set(state.met);
  const intro = state.introduced;
  const edges: Edge[] = [...phoneticSeries(hub), ...sharesPart(hub), ...builtOn(hub)];
  const byNeighbor = new Map<string, Edge[]>();
  for (const e of edges) {
    const a = byNeighbor.get(e.to);
    if (a) a.push(e);
    else byNeighbor.set(e.to, [e]);
  }
  const out = new Map<Relation, { item: RingItem; edge: Edge }[]>(RELATIONS.map((r) => [r, []]));
  for (const [k, list] of byNeighbor) {
    list.sort((p, q) => RELATIONS.indexOf(p.relation) - RELATIONS.indexOf(q.relation));
    const edge = list[0];
    const n = getNode(k);
    if (!n) continue;
    const met = metSet.has(k);
    const lockedBy = met ? undefined : intro.find((x) => x !== k && !metSet.has(x) && confusable(k, x));
    const { label, note } = labelFor(edge, hub);
    const item: RingItem = {
      k,
      relation: edge.relation,
      via: [...new Set(list.filter((e) => e.relation === edge.relation).map((e) => e.via))],
      label,
      note,
      gloss: gloss(n),
      reading: n.on[0] ?? '',
      met,
      locked: !!lockedBy,
      lockedBy,
      inSeed: SEED_SET.has(k),
    };
    out.get(edge.relation)!.push({ item, edge });
  }
  for (const list of out.values()) list.sort((p, q) => cmp(rankKey(p.item, p.edge, metSet, hub), rankKey(q.item, q.edge, metSet, hub)));
  return out;
}

/**
 * Up to RING_CAP neighbors. "all" deals the relations out in turn, strongest teaching claim first, so every
 * relation the hub has shows up; a single relation pages through its own ranked list.
 */
export function buildRing(hubChar: string, state: CompassState, relation: Relation | 'all' = 'all', page = 0): Ring {
  const hub = getNode(hubChar);
  if (!hub) throw new Error(`"${hubChar}" is not in the jōyō set this graph covers`);
  const cands = ringCandidates(hub, state);
  const counts = Object.fromEntries(RELATIONS.map((r) => [r, cands.get(r)!.length])) as Record<Relation, number>;
  let ordered: RingItem[];
  if (relation === 'all') {
    const lists = RELATIONS.map((r) => [...cands.get(r)!]);
    ordered = [];
    // Kanji the learner has met first, then new ones, then the ones that wait; within each, the relations
    // take turns so every relation the hub has is represented before any gets a second slot.
    const passes = [(i: RingItem) => !i.locked && i.met, (i: RingItem) => !i.locked && !i.met, (i: RingItem) => i.locked];
    for (const pass of passes) {
      const q = lists.map((l) => l.filter((c) => pass(c.item)));
      while (q.some((l) => l.length)) for (const l of q) if (l.length) ordered.push(l.shift()!.item);
    }
  } else {
    ordered = cands.get(relation)!.map((c) => c.item);
  }
  const pages = Math.max(1, Math.ceil(ordered.length / RING_CAP));
  const p = Math.min(Math.max(0, page), pages - 1);
  const lockedCount = RELATIONS.reduce((n, r) => n + cands.get(r)!.filter((c) => c.item.locked).length, 0);
  return { hub: hubChar, items: ordered.slice(p * RING_CAP, p * RING_CAP + RING_CAP), counts, relation, page: p, pages, lockedCount };
}

/** The hub's own parts, for the center. Choosing one makes it the hub (the inverse `part` relation takes no slot). */
export function centerParts(hub: KanjiNode): { e: string; shown: string; role: PartRole; navigable: boolean }[] {
  return hub.parts.map((p) => ({ e: p.e, shown: p.s ?? p.e, role: roleOf(p), navigable: !!getNode(p.e) }));
}

// --- cross-check against KRADFILE ------------------------------------------------------------

/**
 * Where a built-on or shares-part edge names a part that KRADFILE also lists for the neighbor, the two sources
 * agree. KRADFILE has elements, not parts, so a miss is expected for composed parts such as 寺.
 */
export function crossCheck(hub: KanjiNode): { relation: Relation; checked: number; agree: number } [] {
  const res: { relation: Relation; checked: number; agree: number }[] = [];
  for (const [relation, edges] of [['built-on', builtOn(hub)], ['shares-part', sharesPart(hub)]] as const) {
    let agree = 0;
    for (const e of edges) if (getNode(e.to)!.kr.includes(e.via)) agree++;
    res.push({ relation, checked: edges.length, agree });
  }
  return res;
}
