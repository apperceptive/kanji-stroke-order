import test from 'node:test';
import assert from 'node:assert/strict';
import { getNode, loadGraph, readings, SEED } from '../src/graph/graph.js';
import { buildRing, builtOn, confusable, devoice, phoneticSeries, sharesPart, RING_CAP } from '../src/graph/relations.js';
import { buildQuestion, judge, publicQuestion } from '../src/graph/questions.js';

const hub = (k: string) => getNode(k)!;
const to = (edges: { to: string }[]) => edges.map((e) => e.to).sort();

test('the seed is all in the graph', () => {
  for (const k of SEED) assert.ok(getNode(k), k);
  assert.equal(SEED.length, 30);
});

test('the 寺 family comes out of KanjiVG, not KRADFILE', () => {
  const family = ['侍', '待', '持', '時', '特', '等', '詩'].sort();
  const seen = new Set([...to(sharesPart(hub('時'))).filter((k) => family.includes(k)), ...to(phoneticSeries(hub('時'))).filter((k) => family.includes(k)), '時']);
  assert.deepEqual([...seen].sort(), family);
  // 寺 is not a KRADFILE element, so KRADFILE cannot say any of this.
  assert.ok(!hub('時').kr.includes('寺'));
});

test('phonetic-series needs the sound part and an on-reading; breaks are shares-part', () => {
  const ps = phoneticSeries(hub('時'));
  assert.deepEqual(to(ps), ['侍', '寺', '持', '詩']);
  assert.equal(ps.find((e) => e.to === '詩')!.sound, 'voicing'); // シ beside ジ
  assert.equal(ps.find((e) => e.to === '侍')!.sound, 'exact');
  assert.equal(ps.find((e) => e.to === '寺')!.sound, 'source');
  const sp = sharesPart(hub('時'));
  for (const k of ['待', '特', '等']) assert.equal(sp.find((e) => e.to === k && e.via === '寺')?.break, true, k);
  assert.ok(!sp.some((e) => e.to === '持' && e.via === '寺'), 'a carrier is not also a break');
});

test('shares-part counts top-level parts only', () => {
  // 土 is inside 寺, so it is reached through its own hub, not from 時.
  assert.ok(!sharesPart(hub('時')).some((e) => e.via === '土'));
  assert.ok(sharesPart(hub('寺')).some((e) => e.via === '土'));
});

test('built-on finds the wholes that contain the hub', () => {
  const wholes = to(builtOn(hub('日')));
  for (const k of ['時', '曜', '星', '間']) assert.ok(wholes.includes(k), k);
  assert.ok(!wholes.includes('日'));
});

test('a variant form counts as its original', () => {
  // 清 is drawn with 氵, KanjiVG's variant of 水.
  assert.ok(to(builtOn(hub('水'))).includes('清'));
});

test('devoicing meets ジ and シ, ブ and フ', () => {
  assert.equal(devoice('ジ'), 'シ');
  assert.equal(devoice('ブン'), 'フン');
  assert.equal(devoice('シ'), 'シ');
});

test('confusability: carriers of one series are exempt, a break is not', () => {
  assert.equal(confusable('時', '持'), false);
  assert.equal(confusable('時', '侍'), false);
  assert.equal(confusable('時', '詩'), true); // sound series, voiced differently
  assert.equal(confusable('時', '待'), true); // a break
  assert.equal(confusable('日', '木'), false);
});

test('the ring caps at six, ranks met kanji first, and shows every relation the hub has', () => {
  const ring = buildRing('時', { met: ['待', '特'], introduced: [] });
  assert.ok(ring.items.length <= RING_CAP);
  assert.deepEqual(ring.items.slice(0, 2).map((i) => i.met), [true, true]);
  assert.ok(new Set(ring.items.map((i) => i.relation)).size >= 2);
  assert.equal(ring.counts['built-on'], 0);
  assert.ok(ring.counts['shares-part'] > 50);
});

test('an unmet kanji confusable with one introduced this session waits', () => {
  const ring = buildRing('時', { met: ['日'], introduced: ['時'] });
  const by = Object.fromEntries(ring.items.map((i) => [i.k, i]));
  assert.equal(by['詩']?.locked, true);
  assert.equal(by['詩']?.lockedBy, '時');
  assert.equal(by['持']?.locked, false); // same-answer carrier
  assert.equal(by['侍']?.locked, false);
  // locked ones only fill spare slots
  const firstLocked = ring.items.findIndex((i) => i.locked);
  if (firstLocked >= 0) assert.ok(ring.items.slice(firstLocked).every((i) => i.locked));
});

test('a single relation pages through its own ranked list', () => {
  const p0 = buildRing('日', { met: [], introduced: [] }, 'built-on', 0);
  const p1 = buildRing('日', { met: [], introduced: [] }, 'built-on', 1);
  assert.equal(p0.items.length, RING_CAP);
  assert.ok(p0.pages > 10);
  assert.ok(!p0.items.some((a) => p1.items.some((b) => b.k === a.k)));
});

test('questions take wrong answers from met kanji only and name their relation', () => {
  const met = ['日', '待', '持', '寺'];
  for (const kind of ['form', 'sound'] as const) {
    const q = buildQuestion('時', kind, met);
    assert.equal(q.options.length, 4);
    for (const o of q.options.filter((x) => !x.correct)) {
      if (o.diagnosis!.relation !== 'neutral') assert.ok(met.includes(o.diagnosis!.owner), `${kind}: ${o.diagnosis!.owner}`);
    }
    assert.equal(q.options.filter((x) => x.correct).length, 1);
  }
});

test('a question is deterministic, so the server can regrade it', () => {
  const a = buildQuestion('持', 'sound', ['待', '詩', '日']);
  const b = buildQuestion('持', 'sound', ['待', '詩', '日']);
  assert.deepEqual(publicQuestion(a), publicQuestion(b));
});

test('a wrong sound answer names the break that caused it', () => {
  const q = buildQuestion('持', 'sound', ['待', '日', '詩']);
  const idx = q.options.findIndex((o) => o.text === 'タイ');
  const v = judge(q, `o${idx}`);
  assert.equal(v.correct, false);
  assert.equal(v.diagnosis?.relation, 'shares-part');
  assert.equal(v.diagnosis?.owner, '待');
  assert.match(v.diagnosis!.fact, /breaks/);
  assert.equal(v.answerText, 'ジ');
  // the unvoiced twin is named as such
  const j = judge(q, `o${q.options.findIndex((o) => o.text === 'シ')}`);
  assert.equal(j.diagnosis?.relation, 'phonetic-series');
  assert.match(j.diagnosis!.fact, /unvoiced/);
});

test('form questions leave out distractors that share a gloss with the answer', () => {
  const q = buildQuestion('時', 'form', ['日', '寺', '持', '待']);
  const words = (k: string) => new Set(hub(k).m.flatMap((m) => m.toLowerCase().split(/[^a-z]+/)));
  for (const o of q.options.filter((x) => !x.correct)) {
    for (const w of words('時')) if (w.length > 2) assert.ok(!words(o.text).has(w), `${o.text} shares "${w}"`);
  }
});

test('kun readings travel with the on-readings, labeled, and uncommon ones stay out', () => {
  assert.deepEqual(hub('猫').kun, ['ねこ']);
  assert.equal(readings(hub('猫')), 'on ビョウ · kun ねこ');
  assert.equal(readings(hub('時')), 'on ジ · kun とき');
  // dictionary style: a dot before the okurigana, and a long list is cut for the line
  assert.equal(hub('分').kun[0], 'わ.ける');
  assert.equal(readings(hub('分'), 2), 'on ブン・フン・ブ · kun わ.ける・わ.かれる');
  // a kanji with no kun reading just has the on line
  assert.ok(!readings(hub('寺')).includes('kun') || hub('寺').kun.length > 0);
});

test('no meaning carries the (kokuji) label; the flag marks at least the nine tagged jōyō kokuji', () => {
  const nodes = Object.values(loadGraph().kanji);
  assert.deepEqual(nodes.filter((n) => n.m.some((m) => /kokuji/i.test(m))).map((n) => n.c), []);
  const flagged = new Set(nodes.filter((n) => n.kokuji).map((n) => n.c));
  for (const k of '働込匂畑腺峠枠塀栃') assert.ok(flagged.has(k), k); // more may be flagged once the source carries a kokuji field
  assert.equal(getNode('働')!.m.join(', '), 'work');
});
