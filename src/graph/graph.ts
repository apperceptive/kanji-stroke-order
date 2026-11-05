import fs from 'node:fs';

/** One top-level part of a kanji, as flattened from KanjiVG by scripts/build-graph.mjs. */
export interface Part {
  /** The part's element, with a variant form folded into its original (氵 is 水). */
  e: string;
  /** Stroke count of the part. */
  n: number;
  /** The form as drawn, when it is a variant of `e`. */
  s?: string;
  pos?: string;
  /** kvg:radical classification. */
  rad?: string;
  /** KanjiVG marks this part as the sound part of the kanji. */
  ph?: 1;
}

export interface KanjiNode {
  c: string;
  /** School grade (1–6, 8 for the rest of the jōyō list). */
  g: number | null;
  /** Newspaper frequency rank, lower is more frequent. */
  f: number | null;
  /** Stroke count. */
  sc: number;
  /** English meanings. */
  m: string[];
  /** On-readings, katakana. */
  on: string[];
  parts: Part[];
  /** Every element at any depth under the kanji. */
  deep: string[];
  /** KRADFILE's flat element list: a cross-check only. */
  kr: string[];
}

export interface GraphBundle {
  version: number;
  generated: string;
  sources: Record<string, string>;
  kradElements: string[];
  kanji: Record<string, KanjiNode>;
}

/** The tour's reviewed time-and-calendar seed: the testable hub set. */
export const SEED = [...'日月火水木金土曜時分半間前後今年午何一中期人数本同大手口星国'];

let cached: GraphBundle | null = null;

export function loadGraph(): GraphBundle {
  if (!cached) {
    const file = new URL('../../data/graph.json', import.meta.url);
    cached = JSON.parse(fs.readFileSync(file, 'utf8')) as GraphBundle;
  }
  return cached;
}

export function getNode(k: string): KanjiNode | undefined {
  return loadGraph().kanji[k];
}

export function gloss(n: KanjiNode): string {
  return n.m.slice(0, 2).join(', ');
}
