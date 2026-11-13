// How build-graph.mjs turns a Firestore `kanji` document into the meanings a graph node keeps.
// Pure, so test/meanings.test.ts can run it without Firestore.

/** How many English meanings a node keeps. */
export const MEANING_LIMIT = 3;

/** The English meanings a graph node keeps for one `kanji` document. */
export function readMeanings(doc, limit = MEANING_LIMIT) {
  return (doc?.meaning?.english ?? []).slice(0, limit);
}
