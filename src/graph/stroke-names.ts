// KanjiVG stroke type symbols, named for a learner. The first symbol decides; a few families share a name.
// One home for these: the stroke player shows them, and the tool text lists them for hosts that show no app.
const NAMES: Record<string, string> = {
  '㇐': 'horizontal', '㇑': 'vertical', '㇒': 'left sweep', '㇓': 'left sweep', '㇔': 'dot', '㇏': 'right sweep',
  '㇀': 'rising stroke', '㇕': 'turn', '㇆': 'turn with hook', '㇖': 'hook', '㇚': 'vertical hook', '㇟': 'curved hook',
  '㇂': 'curved hook', '㇛': 'hook', '㇗': 'turn', '㇙': 'turn', '㇄': 'turn', '㇅': 'turn', '㇈': 'turn', '㇊': 'turn',
  '㇋': 'turn', '㇌': 'turn', '㇍': 'turn', '㇎': 'turn', '㇇': 'turn', '㇉': 'turn', '㇁': 'hook', '㇃': 'turn',
};

export const strokeName = (type: string): string => NAMES[[...type.split('/').pop()!][0]] ?? 'stroke';
