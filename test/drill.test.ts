import test from 'node:test';
import assert from 'node:assert/strict';
import { getNode } from '../src/graph/graph.js';
import { drillItems } from '../src/graph/drill.js';

const state = (met: string[]) => ({ met, introduced: [] });

test('a drill asks about the hub first, then met neighbors, then other met kanji', () => {
  const met = [...'日月火水木金土一人大口時持寺待'];
  const items = drillItems('時', state(met), 5);
  assert.equal(items.length, 5);
  assert.equal(items[0].target, '時');
  assert.equal(new Set(items.map((i) => i.target)).size, 5, 'no kanji twice');
  for (const i of items) assert.ok(met.includes(i.target), i.target);
});

test('a drill never asks about a kanji the learner has not met, even if it is related', () => {
  const items = drillItems('時', state(['時', '寺']), 5);
  assert.deepEqual(items.map((i) => i.target).sort(), ['寺', '時']);
});

test('questions alternate form and sound, and a kanji without an on-reading is only asked by form', () => {
  const met = [...'日月火水木金土一人大口時持寺待'];
  const items = drillItems('時', state(met), 6);
  assert.deepEqual(items.map((i) => i.kind).slice(0, 2), ['form', 'sound']);
  for (const i of items) if (i.kind === 'sound') assert.ok(getNode(i.target)!.on.length, i.target);
});

test('an unknown hub is an error, not an empty drill', () => {
  assert.throws(() => drillItems('x', state([]), 5));
});
