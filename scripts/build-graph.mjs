// Builds data/graph.json, the kanji-to-kanji relation bundle the compass serves.
//
//   node scripts/build-graph.mjs
//
// Inputs (all read-only):
//   KANJIVG_DIR     KanjiVG per-character SVG files (default ../kanjiism/kanji-vg-raw)
//   READINGS_TSV    V1's jōyō readings (default ../kanjiism/data/readings.tsv); its 2,136 kanji are the jōyō set
//   KRADFILE        used only as a cross-check, never to build a relation (default ../kanjiism/data/kradfile-u)
//   service-account.json (repo root, gitignored) for grade, frequency and meanings from V1's Firestore `kanji`
//                   collection. Pass --no-firestore to skip; relations do not depend on it, ranking and glosses do.
//
// A relation is computed from KanjiVG's component tree (see src/graph/relations.ts); this script only
// flattens each tree into the parts the relations need.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readMeanings } from './meanings.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const env = (k, d) => process.env[k] ?? d;
const KANJIVG_DIR = env('KANJIVG_DIR', path.resolve(root, '../kanjiism/kanji-vg-raw'));
const READINGS_TSV = env('READINGS_TSV', path.resolve(root, '../kanjiism/data/readings.tsv'));
const KRADFILE = env('KRADFILE', path.resolve(root, '../kanjiism/data/kradfile-u'));
const useFirestore = !process.argv.includes('--no-firestore');

// ---- KanjiVG tree ---------------------------------------------------------------------------

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** Parse one KanjiVG file into { element, children: [...] } where leaves are { stroke: true }. */
function parseTree(svg) {
  const body = svg.slice(svg.indexOf('<g id="kvg:StrokePaths'));
  const tokens = body.match(/<g\b[^>]*>|<\/g>|<path\b[^>]*>|<text\b/g) ?? [];
  const stack = [];
  let rootNode = null;
  for (const tok of tokens) {
    if (tok.startsWith('<text')) break; // stroke numbers follow; nothing after this is structure
    if (tok.startsWith('<g')) {
      const a = attrs(tok);
      const node = { a, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else if (a['id']?.startsWith('kvg:StrokePaths')) { /* wrapper */ }
      stack.push(node);
      if (!rootNode && a['kvg:element']) rootNode = node;
    } else if (tok === '</g>') {
      stack.pop();
    } else if (tok.startsWith('<path')) {
      const a = attrs(tok);
      stack[stack.length - 1]?.children.push({ stroke: true, a });
    }
  }
  return rootNode;
}

const norm = (a) => a['kvg:original'] || a['kvg:element'];

function countStrokes(node) {
  if (node.stroke) return 1;
  return node.children.reduce((n, c) => n + countStrokes(c), 0);
}

/** Visible top-level parts: the root's children, looking through groups that carry no element. */
function topParts(node, out = []) {
  for (const c of node.children) {
    if (c.stroke) continue;
    if (!c.a['kvg:element']) { topParts(c, out); continue; }
    const el = norm(c.a);
    const phonAttr = c.a['kvg:phon'];
    out.push({
      e: el,
      shown: c.a['kvg:element'],
      pos: c.a['kvg:position'] ?? null,
      rad: c.a['kvg:radical'] ?? null,
      // KanjiVG's phon mark says this group is where the kanji's sound lives. Its value names the source
      // (寺's 土 carries phon="之V": the group stands for 之), so any value marks the group.
      ph: !!phonAttr,
      n: countStrokes(c),
    });
  }
  return out;
}

function deepElements(node, set = new Set(), top = true) {
  for (const c of node.children) {
    if (c.stroke) continue;
    if (c.a['kvg:element']) set.add(norm(c.a));
    deepElements(c, set, false);
  }
  return set;
}

// ---- inputs ---------------------------------------------------------------------------------

const readingsRows = fs.readFileSync(READINGS_TSV, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split('\t'));
const on = new Map();
// Kun readings keep KANJIDIC's dot between the stem and the okurigana (わ.ける); the uncommon ones are left out.
const kun = new Map();
for (const [k, reading, , type, uncommon] of readingsRows) {
  if (type === 'On') {
    if (!on.has(k)) on.set(k, []);
    on.get(k).push({ r: reading, u: uncommon === 'Y' ? 1 : 0 });
  } else if (type === 'Kun' && uncommon !== 'Y') {
    if (!kun.has(k)) kun.set(k, []);
    kun.get(k).push(reading);
  }
}
const joyo = [...new Set(readingsRows.map((r) => r[0]))];
console.log(`jōyō set: ${joyo.length} kanji, ${on.size} with an on-reading`);

const krad = new Map();
for (const line of fs.readFileSync(KRADFILE, 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const [k, rest] = line.split(' : ');
  if (rest) krad.set(k.trim(), rest.trim().split(/\s+/));
}
const kradElements = new Set([...krad.values()].flat());

let meta = new Map();
if (useFirestore) {
  const req = createRequire(path.join(root, 'package.json'));
  const admin = req('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(req(path.join(root, 'service-account.json'))), projectId: 'kanjiism-65892' });
  const db = admin.firestore();
  const refs = joyo.map((k) => db.collection('kanji').doc(k));
  for (let i = 0; i < refs.length; i += 300) {
    const snaps = await db.getAll(...refs.slice(i, i + 300), { fieldMask: ['meaning', 'kokuji', 'grade', 'jlpt', 'freq', 'stroke_count'] });
    for (const s of snaps) if (s.exists) meta.set(s.id, s.data());
  }
  console.log(`Firestore: ${meta.size} of ${joyo.length} kanji have metadata`);
}

// ---- flatten -------------------------------------------------------------------------------

const kanji = {};
let missing = 0;
for (const k of joyo) {
  const file = path.join(KANJIVG_DIR, `${k.codePointAt(0).toString(16).padStart(5, '0')}.svg`);
  if (!fs.existsSync(file)) { missing++; continue; }
  const tree = parseTree(fs.readFileSync(file, 'utf8'));
  if (!tree) { missing++; continue; }
  const parts = [];
  for (const p of topParts(tree)) {
    const dup = parts.find((q) => q.e === p.e);
    if (dup) { dup.n += p.n; dup.ph ||= p.ph; continue; } // a part split around another (門 around 日 in 間)
    parts.push(p);
  }
  const m = meta.get(k);
  kanji[k] = {
    c: k,
    g: m?.grade ?? null,
    f: m?.freq ?? null,
    sc: m?.stroke_count ?? countStrokes(tree),
    ...readMeanings(m),
    on: (on.get(k) ?? []).map((x) => x.r),
    kun: kun.get(k) ?? [],
    parts: parts.map(({ e, shown, pos, rad, ph, n }) => {
      const o = { e, n };
      if (shown !== e) o.s = shown;
      if (pos) o.pos = pos;
      if (rad) o.rad = rad;
      if (ph) o.ph = 1;
      return o;
    }),
    deep: [...deepElements(tree)].filter((e) => e !== k),
    kr: krad.get(k) ?? [],
  };
}
console.log(`flattened ${Object.keys(kanji).length} kanji (${missing} without KanjiVG data)`);

const bundle = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  sources: {
    structure: 'KanjiVG component tree (CC BY-SA 3.0, https://kanjivg.tagaini.net)',
    readings: "V1 data/readings.tsv, the jōyō list (KANJIDIC-derived, EDRDG)",
    crosscheck: 'KRADFILE-u (EDRDG), cross-check only',
    meanings: 'V1 Firestore kanji collection (KANJIDIC-derived)',
  },
  kradElements: [...kradElements],
  kanji,
};
const out = path.join(root, 'data', 'graph.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(bundle), 'utf8');
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
process.exit(0);
