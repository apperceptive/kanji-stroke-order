import { App } from '@modelcontextprotocol/ext-apps';
import { applySafeArea, tellModel, wireHelp, wireSuggestions, type Suggestion } from './host-ui';

/** A view app: one kind of relation for one kanji, listed. It grades nothing and ends by offering what to say next. */
interface Item {
  k: string;
  relation: 'phonetic-series' | 'shares-part' | 'built-on';
  label: string;
  note?: string;
  gloss: string;
  reading: string;
  met: boolean;
}
interface Payload {
  hub: { c: string; gloss: string; reading: string };
  relation: Item['relation'];
  relationName: string;
  counts: Record<Item['relation'], number>;
  items: Item[];
  demo: boolean;
  suggested_next: Suggestion[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = new App({ name: 'Nihongoism related kanji', version: '0.1.0' });
// The host sizes the frame to the content, so a scrollbar inside it is only ever a rounding artifact.
document.documentElement.style.overflowY = 'hidden';

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function show(p: Payload): void {
  $('kj').textContent = p.hub.c;
  $('gl').textContent = p.hub.gloss;
  $('meta').textContent = p.hub.reading;
  $('rel').textContent = `${p.relationName[0].toUpperCase()}${p.relationName.slice(1)} · ${p.items.length} of ${p.counts[p.relation]}`;
  $('rows').replaceChildren(
    ...(p.items.length
      ? p.items.map((i) => {
          const li = el('li', `row2 ${i.relation}`);
          const what = el('div', 'what');
          const name = el('b', '', i.gloss);
          what.append(name, el('span', 'why', [i.reading, i.label, i.note].filter(Boolean).join(' · ')));
          li.append(el('span', 'k', i.k), what, el('span', `tag${i.met ? '' : ' new'}`, i.met ? 'known' : 'new'));
          return li;
        })
      : [el('li', 'sub', `No ${p.relationName} for ${p.hub.c}.`)]),
  );
  $('err').hidden = true;
  wireSuggestions(app, $('says'), p.suggested_next, (t) => ($('note').textContent = t));
  $('note').textContent = '';
  tellModel(app, `The learner is looking at the ${p.relationName} of ${p.hub.c}: ${p.items.map((i) => i.k).join(' ') || 'none'}.`);
}

function fail(msg: string): void {
  $('err').textContent = msg;
  $('err').hidden = false;
}

wireHelp(app);
app.ontoolresult = (result) => {
  const p = result.structuredContent as Payload | undefined;
  if (result.isError || !p?.hub) fail(result.content?.find((c) => c.type === 'text')?.text ?? 'No relations to show.');
  else show(p);
};
app.onhostcontextchanged = () => applySafeArea(app);
app.connect().then(() => applySafeArea(app)).catch((e) => fail(`Could not reach the host: ${e?.message ?? e}`));
