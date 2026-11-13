import fs from 'node:fs';
import path from 'node:path';
import { getKanji } from './firestore.js';

/** One stroke: KanjiVG's type symbol and its centerline in the 109×109 square. */
export type Stroke = [type: string, d: string];

/** KanjiVG <path> elements in writing order, as the brush engine wants them. */
export function parseStrokes(svg: string): Stroke[] {
  const found: { n: number; type: string; d: string }[] = [];
  for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
    const id = /id="[^"]*-s(\d+)"/.exec(tag);
    const d = /\bd="([^"]*)"/.exec(tag);
    if (!id || !d) continue;
    found.push({ n: Number(id[1]), type: /kvg:type="([^"]*)"/.exec(tag)?.[1] ?? '㇐', d: d[1] });
  }
  return found.sort((a, b) => a.n - b.n).map((s) => [s.type, s.d]);
}

const cache = new Map<string, Stroke[]>();

/**
 * Strokes for a character: V1's Firestore collection (the deployed path), or, for local work without
 * credentials, a directory of KanjiVG files named by KANJIVG_DIR.
 */
export async function getStrokes(character: string): Promise<Stroke[] | null> {
  const hit = cache.get(character);
  if (hit) return hit;
  let strokes: Stroke[] | null = null;
  const dir = process.env.KANJIVG_DIR;
  if (dir) {
    const file = path.join(dir, `${character.codePointAt(0)!.toString(16).padStart(5, '0')}.svg`);
    if (fs.existsSync(file)) strokes = parseStrokes(fs.readFileSync(file, 'utf8'));
  }
  if (!strokes?.length) {
    try {
      const doc = await getKanji(character);
      const svg = doc?.strokes?.mincho?.svg;
      if (svg) strokes = parseStrokes(svg);
    } catch (err) {
      console.error(`stroke lookup for ${character} failed:`, (err as Error).message);
    }
  }
  if (!strokes?.length) return null;
  cache.set(character, strokes);
  return strokes;
}
