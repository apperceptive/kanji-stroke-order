import test from 'node:test';
import assert from 'node:assert/strict';
import { readMeanings } from '../scripts/meanings.mjs';

const doc = (english: string[], kokuji?: boolean) => ({ meaning: { english }, ...(kokuji === undefined ? {} : { kokuji }) });

test('keeps the first three meanings', () => {
  assert.deepEqual(readMeanings(doc(['a', 'b', 'c', 'd'])).m, ['a', 'b', 'c']);
});

test('a document with no meanings gives none, and is not a kokuji', () => {
  assert.deepEqual(readMeanings(undefined), { m: [], kokuji: false });
  assert.deepEqual(readMeanings({}), { m: [], kokuji: false });
});

test('the (kokuji) tag is flagged, then dropped from the meanings', () => {
  assert.deepEqual(readMeanings(doc(['work', '(kokuji)'])), { m: ['work'], kokuji: true });
});

test('the tag goes before the cut, so a fourth real meaning is kept', () => {
  assert.deepEqual(readMeanings(doc(['a', 'b', '(kokuji)', 'c', 'd'])), { m: ['a', 'b', 'c'], kokuji: true });
});

test('a document without the tag is not a kokuji', () => {
  assert.equal(readMeanings(doc(['a', 'b'])).kokuji, false);
});

test("a kokuji field decides the flag, and the tag is still dropped", () => {
  assert.deepEqual(readMeanings(doc(['work'], true)), { m: ['work'], kokuji: true });
  assert.deepEqual(readMeanings(doc(['work', '(kokuji)'], false)), { m: ['work'], kokuji: false });
});

test('the tag is matched without regard to case or surrounding whitespace', () => {
  assert.deepEqual(readMeanings(doc(['work', ' (Kokuji) '])), { m: ['work'], kokuji: true });
});
