// How build-graph.mjs turns a Firestore `kanji` document into the meanings and kokuji flag a graph node keeps.
// Pure, so test/meanings.test.ts can run it without Firestore.

/** How many English meanings a node keeps. */
export const MEANING_LIMIT = 3;

/** KANJIDIC marks a kokuji (a kanji made in Japan) with this literal entry among the English meanings. */
export const KOKUJI_TAG = '(kokuji)';
const isKokujiTag = (entry) => entry.trim().toLowerCase() === KOKUJI_TAG;

/**
 * The meanings and kokuji flag a graph node keeps for one `kanji` document.
 *
 * The tag is a label, not a meaning, so it is removed before the cut to `limit`: a real meaning after it is
 * not lost. The flag comes from the document's `kokuji` boolean when it has one (apperceptive/kanjiism#110),
 * and from the tag's presence until every document does.
 */
export function readMeanings(doc, limit = MEANING_LIMIT) {
  const english = doc?.meaning?.english ?? [];
  return {
    m: english.filter((x) => !isKokujiTag(x)).slice(0, limit),
    kokuji: typeof doc?.kokuji === 'boolean' ? doc.kokuji : english.some(isKokujiTag),
  };
}
