import test from 'node:test';
import assert from 'node:assert/strict';
import { readMeanings } from '../scripts/meanings.mjs';

const doc = (...english: string[]) => ({ meaning: { english } });

test('keeps the first three meanings', () => {
  assert.deepEqual(readMeanings(doc('a', 'b', 'c', 'd')), ['a', 'b', 'c']);
});

test('a document with no meanings gives none', () => {
  assert.deepEqual(readMeanings(undefined), []);
  assert.deepEqual(readMeanings({}), []);
});
