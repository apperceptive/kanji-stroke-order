import { App } from '@modelcontextprotocol/ext-apps';
import { applySafeArea, tellModel, wireHelp, wireSuggestions, type Suggestion } from './host-ui';

/**
 * A drill app: a short run of graded questions inside the panel. Each question and each answer is one server call
 * with no model turn between them; the model hears about it once, at the end.
 */
type Kind = 'form' | 'sound';
interface Payload {
  hub: { c: string; gloss: string };
  items: { target: string; kind: Kind }[];
  state: { met: string[]; introduced: string[] };
  demo: boolean;
  suggested_next: Suggestion[];
}
interface PublicQuestion {
  kind: Kind;
  target: string;
  prompt: string;
  options: { id: string; text: string }[];
}
interface Verdict {
  correct: boolean;
  answerId: string;
  answerText: string;
  chosenId: string;
  diagnosis?: { relation: string; owner: string; fact: string };
  options: { id: string; text: string; correct: boolean }[];
}
interface Result {
  target: string;
  kind: Kind;
  correct: boolean;
  chose: string;
  answer: string;
  fact?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = new App({ name: 'Nihongoism kanji drill', version: '0.1.0' });
document.documentElement.style.overflowY = 'hidden';

let payload: Payload;
let at = 0;
let q: PublicQuestion | null = null;
let verdict: Verdict | null = null;
let busy = false;
let results: Result[] = [];
/** How long each server call took as the panel saw it (the host relays it; no model is involved). */
let callMs: number[] = [];

function fail(msg: string): void {
  $('err').textContent = msg;
  $('err').hidden = false;
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const t0 = performance.now();
  const r = await app.callServerTool({ name, arguments: args });
  callMs.push(performance.now() - t0);
  if (r.isError) throw new Error((r.content?.find((c) => c.type === 'text') as { text?: string } | undefined)?.text ?? `${name} failed`);
  return r.structuredContent as T;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function ask(): Promise<void> {
  busy = true;
  verdict = null;
  $('fb').hidden = true;
  $('next').hidden = true;
  const item = payload.items[at];
  try {
    q = await call<PublicQuestion>('drill_question', { target: item.target, kind: item.kind, met: payload.state.met });
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    return;
  } finally {
    busy = false;
  }
  $('progress').textContent = `${at + 1} of ${payload.items.length}`;
  $('prompt').textContent = q.prompt;
  $('target').hidden = !q.target;
  $('target').textContent = q.target;
  $('opts').replaceChildren(
    ...q.options.map((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.dataset.id = o.id;
      b.textContent = o.text;
      b.setAttribute('aria-label', `${i + 1}: ${o.text}`);
      b.addEventListener('click', () => answer(o.id));
      return b;
    }),
  );
  $('ask').hidden = false;
  $('done').hidden = true;
}

async function answer(id: string): Promise<void> {
  if (!q || verdict || busy) return;
  busy = true;
  const item = payload.items[at];
  try {
    verdict = await call<Verdict>('drill_answer', { target: item.target, kind: item.kind, met: payload.state.met, chosen: id });
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    return;
  } finally {
    busy = false;
  }
  const v = verdict;
  document.querySelectorAll<HTMLButtonElement>('#opts .opt').forEach((b) => {
    b.disabled = true;
    const info = v.options.find((o) => o.id === b.dataset.id);
    if (info?.correct) b.classList.add('right');
    else if (b.dataset.id === v.chosenId) b.classList.add('wrong');
  });
  const chose = v.options.find((o) => o.id === v.chosenId)?.text ?? '';
  results.push({ target: item.target, kind: item.kind, correct: v.correct, chose, answer: v.answerText, fact: v.diagnosis?.fact });
  const fb = $('fb');
  fb.className = `fb ${v.correct ? 'ok' : 'no'}`;
  fb.replaceChildren(...(v.correct ? [bold('Right.')] : [bold('Not quite.'), document.createTextNode(` ${v.diagnosis?.fact ?? ''}`)]));
  fb.hidden = false;
  const next = $<HTMLButtonElement>('next');
  next.textContent = at + 1 < payload.items.length ? 'Next' : 'See the score';
  next.hidden = false;
  next.focus();
}

function bold(t: string): HTMLElement {
  const b = document.createElement('b');
  b.textContent = t;
  return b;
}

function finish(): void {
  const right = results.filter((r) => r.correct).length;
  const missed = results.filter((r) => !r.correct);
  $('ask').hidden = true;
  $('done').hidden = false;
  $('progress').textContent = '';
  $('score').textContent = `${right} of ${results.length} right`;
  $('missed').replaceChildren(
    ...missed.map((m) => {
      const li = document.createElement('li');
      const jp = (t: string) => Object.assign(document.createElement('span'), { className: 'jp', textContent: t });
      // A "which kanji" question's answer is the kanji itself; a "how is it read" question's is the reading.
      if (m.kind === 'sound') li.append(jp(m.target), ' reads ', jp(m.answer), '. ');
      else li.append('The answer was ', jp(m.answer), '. ');
      li.append(m.fact ?? '');
      return li;
    }),
  );
  const suggestions = [...payload.suggested_next];
  if (missed[0]) suggestions.unshift({ label: `Look-alikes of ${missed[0].target}`, utterance: `Show me the look-alikes of ${missed[0].target}` });
  wireSuggestions(app, $('says'), suggestions, (t) => ($('note').textContent = t));
  // Server round trips as the panel saw them: no model turn happens between questions.
  $('note').textContent = `${callMs.length} server calls, median ${Math.round(median(callMs))} ms each, no model involved.`;
  tellModel(
    app,
    `Drill on ${payload.hub.c} finished: ${right} of ${results.length} right. ` +
      (missed.length ? `Missed: ${missed.map((m) => `${m.target} (chose ${m.chose}, answer ${m.answer}${m.fact ? `; ${m.fact}` : ''})`).join('; ')}.` : 'No misses.'),
  );
}

$('next').addEventListener('click', () => {
  if (at + 1 < payload.items.length) {
    at += 1;
    ask();
  } else finish();
});
// Keys 1 to 4 choose an option, Enter moves on: a keyboard path through the same buttons.
document.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '4') document.querySelectorAll<HTMLButtonElement>('#opts .opt')[Number(e.key) - 1]?.click();
  else if (e.key === 'Enter' && !$('next').hidden && document.activeElement !== $('next')) $('next').click();
});

wireHelp(app);
app.ontoolresult = (result) => {
  const p = result.structuredContent as Payload | undefined;
  if (result.isError || !p?.items?.length) {
    fail(result.content?.find((c) => c.type === 'text')?.text ?? 'No drill to run.');
    return;
  }
  payload = p;
  $('kj').textContent = p.hub.c;
  $('gl').textContent = p.hub.gloss;
  at = 0;
  results = [];
  callMs = [];
  $('err').hidden = true;
  $('note').textContent = '';
  ask();
};
app.onhostcontextchanged = () => applySafeArea(app);
app.connect().then(() => applySafeArea(app)).catch((e) => fail(`Could not reach the host: ${e?.message ?? e}`));
