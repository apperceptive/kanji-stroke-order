import { App } from '@modelcontextprotocol/ext-apps';
import { BrushPlayer, type Stroke } from './brush-player';

// --- shapes the server returns (src/tools/apps.ts, src/graph/*.ts) -----------------------------

type Relation = 'phonetic-series' | 'shares-part' | 'built-on';
type Filter = Relation | 'all';

interface RingItem {
  k: string;
  relation: Relation;
  via: string[];
  label: string;
  note?: string;
  gloss: string;
  reading: string;
  met: boolean;
  locked: boolean;
  lockedBy?: string;
  inSeed: boolean;
}
interface Payload {
  hub: {
    c: string;
    gloss: string;
    meanings: string[];
    on: string[];
    grade: number | null;
    strokeCount: number;
    parts: { e: string; shown: string; role: 'sound' | 'radical' | 'part'; navigable: boolean }[];
    strokes: Stroke[];
    met: boolean;
  };
  ring: { hub: string; items: RingItem[]; counts: Record<Relation, number>; relation: Filter; page: number; pages: number; lockedCount: number };
  state: { met: string[]; introduced: string[] };
  relations: Relation[];
  demo: boolean;
}
interface PublicQuestion {
  kind: 'form' | 'sound';
  target: string;
  prompt: string;
  options: { id: string; text: string }[];
}
type OptionRelation = Relation | 'part' | 'shares-reading' | 'neutral' | 'answer';
interface Verdict {
  correct: boolean;
  answerId: string;
  answerText: string;
  chosenId: string;
  diagnosis?: { relation: OptionRelation; owner: string; via?: string; fact: string };
  options: { id: string; text: string; correct: boolean; relation: OptionRelation; owner: string; via?: string }[];
  walk: { hub: string; highlight?: string };
}

// --- small helpers ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style') el.setAttribute('style', String(v));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}
function fill(el: HTMLElement, ...kids: Child[]): void {
  el.replaceChildren(...(kids.filter(Boolean) as (Node | string)[]));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jp = (t: string) => h('span', { class: 'jp' }, t);

/** CSS class for a relation's color. */
const cls = (r: OptionRelation): 'sound' | 'part' | 'built' | 'neutral' =>
  r === 'phonetic-series' || r === 'shares-reading' ? 'sound' : r === 'shares-part' || r === 'part' ? 'part' : r === 'built-on' ? 'built' : 'neutral';
const REL_NAME: Record<Relation, string> = { 'phonetic-series': 'Sound series', 'shares-part': 'Shares a part', 'built-on': 'Built on' };
const REL_CLASS: Record<Relation, string> = { 'phonetic-series': 'sound', 'shares-part': 'part', 'built-on': 'built' };
const ROLE_NAME = { sound: 'sound', radical: 'radical', part: '' } as const;

// --- state -----------------------------------------------------------------------------------

const app = new App({ name: 'Nihongoism kanji compass', version: '0.1.0' });
let payload: Payload;
const met = new Set<string>();
const introduced = new Set<string>();
let trail: string[] = [];
let busy = false;
let focusK: string | null = null;
let quiz: { q: PublicQuestion; verdict?: Verdict } | null = null;
let defaultStatus = '';

const player = new BrushPlayer($<HTMLCanvasElement>('c'));
player.speed = 1.5;

const stateArgs = () => ({ met: [...met], introduced: [...introduced] });

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await app.callServerTool({ name, arguments: args });
  if (r.isError) throw new Error((r.content?.find((c) => c.type === 'text') as { text?: string } | undefined)?.text ?? `${name} failed`);
  return r.structuredContent as T;
}

function showError(e: unknown): void {
  $('err').textContent = e instanceof Error ? e.message : String(e);
  $('err').hidden = false;
}

function tellModel(text: string): void {
  // Keep the host's model in step with what the learner is looking at. Hosts that do not support it ignore it.
  app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => {});
}

// --- layouts: a compact card inline, the full compass when expanded ----------------------------------
// Claude's design guidelines keep inline cards small (auto height, at most two actions) and give complex
// interaction a fullscreen view. Hosts without a fullscreen mode get the full compass inline when expanded.

let localFull = false;
let shownLayout: 'card' | 'full' | null = null;
const hostFullscreen = () => app.getHostContext()?.displayMode === 'fullscreen';
const canFullscreen = () => !!app.getHostContext()?.availableDisplayModes?.includes('fullscreen');
const isFull = () => hostFullscreen() || localFull;

/** Put the page in the right layout and the hub canvas in the right slot. Returns whether it changed. */
function applyLayout(): boolean {
  const layout = isFull() ? 'full' : 'card';
  document.body.dataset.layout = layout;
  const slot = layout === 'full' ? $('stage') : $('cardHub');
  if ($('hub').parentElement !== slot) slot.append($('hub'));
  const changed = layout !== shownLayout;
  shownLayout = layout;
  return changed;
}

async function expand(): Promise<void> {
  if (canFullscreen()) {
    try {
      await app.requestDisplayMode({ mode: 'fullscreen' });
    } catch {
      localFull = true;
    }
  } else localFull = true;
  render(false);
}

async function collapse(): Promise<void> {
  localFull = false;
  quiz = null;
  if (hostFullscreen()) await app.requestDisplayMode({ mode: 'inline' }).catch(() => {});
  render(false);
}

// --- moving ----------------------------------------------------------------------------------

async function load(hub: string, opts: { filter?: Filter; page?: number; focus?: string; arrive?: boolean } = {}): Promise<void> {
  const p = await call<Payload>('compass_move', { hub, ...stateArgs(), relation: opts.filter ?? 'all', page: opts.page ?? 0, focus: opts.focus });
  const hubChanged = !payload || payload.hub.c !== p.hub.c;
  payload = p;
  focusK = opts.focus ?? null;
  $('err').hidden = true;
  if (hubChanged || opts.arrive) {
    player.load(p.hub.strokes);
    player.play();
  }
  render(hubChanged || !!opts.arrive);
}

/** Make `k` the hub: the chosen tile glides to the center while the server answers. */
async function moveTo(k: string, tile?: HTMLElement): Promise<void> {
  if (busy || (payload && k === payload.hub.c && !quiz)) return;
  busy = true;
  try {
    quiz = null;
    if (tile) {
      tile.classList.add('flying');
      tile.style.setProperty('--x', '50%');
      tile.style.setProperty('--y', '50%');
    }
    if (!met.has(k)) introduced.add(k);
    const from = payload?.hub.c;
    await Promise.all([load(k, { arrive: true }), sleep(tile ? 300 : 0)]);
    // Going back to a kanji already on the trail cuts the trail there; anything else extends it.
    trail = trail.includes(k) ? trail.slice(0, trail.indexOf(k) + 1) : [...trail, k];
    renderTrail();
    tellModel(`The learner moved the kanji compass to ${k} (${payload.hub.gloss})${from ? ` from ${from}` : ''}. Its ring now shows ${payload.ring.items.map((i) => `${i.k} (${i.label})`).join(', ')}.`);
  } catch (e) {
    showError(e);
    introduced.delete(k);
  } finally {
    busy = false;
  }
}

// --- drawing the ring ------------------------------------------------------------------------

const R = 37; // tile-center distance from the hub, in percent of the stage

function place(n: number, i: number, startDeg = -90, spreadN = Math.max(n, 3)): { x: number; y: number } {
  const a = ((startDeg + (i * 360) / spreadN) * Math.PI) / 180;
  return { x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a) };
}

function clearStage(): void {
  $('stage').querySelectorAll('.tile').forEach((t) => t.remove());
  fill($('lines'), );
}

function line(x: number, y: number, c: string): SVGLineElement {
  const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  l.setAttribute('x1', '50');
  l.setAttribute('y1', '50');
  l.setAttribute('x2', String(x));
  l.setAttribute('y2', String(y));
  l.setAttribute('class', c);
  return l;
}

function setStatus(html: Node | string, rc = ''): void {
  const s = $('status');
  s.className = `status full-only ${rc}`;
  s.replaceChildren(...(typeof html === 'string' ? [document.createTextNode(html)] : [html]));
}

function explain(it: RingItem): void {
  const frag = document.createDocumentFragment();
  frag.append(h('span', { class: 'tag' }, it.label), ' ');
  frag.append(jp(it.k), ` (${it.gloss}${it.reading ? `; ${it.reading}` : ''}). `);
  if (it.note) frag.append(it.note.charAt(0).toUpperCase() + it.note.slice(1) + '. ');
  if (it.locked) frag.append(`It waits for another day: it is easy to confuse with ${it.lockedBy}, which is new this session.`);
  else if (!it.met) frag.append('New to you.');
  setStatus(frag, REL_CLASS[it.relation]);
}

function renderRing(animate: boolean): void {
  clearStage();
  const items = payload.ring.items;
  const stage = $('stage');
  items.forEach((it, i) => {
    const { x, y } = place(items.length, i);
    const rc = REL_CLASS[it.relation];
    const t = h(
      'button',
      {
        class: `tile ${rc} ${it.met ? 'met' : ''} ${it.locked ? 'locked' : ''} ${focusK === it.k ? 'focus' : ''}`,
        type: 'button',
        style: `--x:${x}%;--y:${y}%;--i:${animate ? i : 0}`,
        'aria-label': `${it.k}, ${it.gloss}. ${it.label}.${it.met ? '' : ' New.'}${it.locked ? ' Waits for another day.' : ''}`,
        'aria-disabled': it.locked ? 'true' : null,
      },
      h('span', { class: 'g' }, it.k),
      h('span', { class: 'gl' }, it.gloss),
      h('span', { class: 'pill' }, it.label),
      h('span', { class: 'badge' }, it.locked ? 'later' : it.met ? '✓' : 'new'),
    );
    t.addEventListener('click', () => (it.locked ? explain(it) : moveTo(it.k, t)));
    for (const ev of ['mouseenter', 'focus'] as const) t.addEventListener(ev, () => explain(it));
    stage.append(t);
    const l = line(x, y, rc);
    $('lines').append(l);
    for (const ev of ['mouseenter', 'focus'] as const) t.addEventListener(ev, () => l.classList.add('hot'));
    for (const ev of ['mouseleave', 'blur'] as const) t.addEventListener(ev, () => l.classList.remove('hot'));
  });
  if (!animate) $('stage').querySelectorAll<HTMLElement>('.tile').forEach((t) => (t.style.animation = 'none'));
}

function renderLegend(): void {
  const c = payload.ring.counts;
  const total = c['phonetic-series'] + c['shares-part'] + c['built-on'];
  const f = payload.ring.relation;
  const chip = (r: Filter, label: string, n: number, klass: string) =>
    h('button', { class: `fchip ${klass} ${f === r ? 'on' : ''}`, type: 'button', disabled: n === 0 || busy, onclick: () => load(payload.hub.c, { filter: r }).catch(showError) }, label + ' ', h('b', {}, String(n)));
  const pager = payload.ring.pages > 1
    ? h(
        'span',
        { class: 'pager' },
        h('button', { type: 'button', 'aria-label': 'Previous neighbors', disabled: payload.ring.page === 0, onclick: () => load(payload.hub.c, { filter: f, page: payload.ring.page - 1 }).catch(showError) }, '‹'),
        `${payload.ring.page + 1} / ${payload.ring.pages}`,
        h('button', { type: 'button', 'aria-label': 'More neighbors', disabled: payload.ring.page >= payload.ring.pages - 1, onclick: () => load(payload.hub.c, { filter: f, page: payload.ring.page + 1 }).catch(showError) }, '›'),
      )
    : null;
  fill($('legend'), 
    chip('all', 'All', total, ''),
    chip('phonetic-series', REL_NAME['phonetic-series'], c['phonetic-series'], 'sound'),
    chip('shares-part', REL_NAME['shares-part'], c['shares-part'], 'part'),
    chip('built-on', REL_NAME['built-on'], c['built-on'], 'built'),
    pager,
  );
}

function renderHubInfo(): void {
  const hb = payload.hub;
  fill($('hubinfo'), 
    h('span', { class: 'big jp' }, hb.c),
    h('span', { class: 'm' }, hb.gloss),
    h('span', { class: 'sub' }, [hb.on.join('・'), hb.grade ? `grade ${hb.grade}` : '', `${hb.strokeCount} strokes`].filter(Boolean).join(' · ')),
  );
  const parts = hb.parts;
  fill($('parts'), 
    ...(parts.length
      ? [
          'Made of',
          ...parts.map((p) =>
            h(
              'button',
              { class: `part-chip ${focusK === p.e ? 'focus' : ''}`, type: 'button', disabled: !p.navigable || busy, title: p.navigable ? `Make ${p.e} the center` : 'Not a kanji in this set', onclick: () => moveTo(p.e) },
              jp(p.shown),
              p.shown !== p.e ? h('small', {}, `= ${p.e}`) : null,
              ROLE_NAME[p.role] ? h('small', {}, ROLE_NAME[p.role]) : null,
            ),
          ),
        ]
      : [`${hb.c} has no parts of its own: it is a part of other kanji.`]),
  );
}

function renderActions(): void {
  const hb = payload.hub;
  const b = (label: string, onclick: () => void, extra: Record<string, unknown> = {}) => h('button', { type: 'button', onclick, ...extra }, label);
  fill($('actions'), 
    b('Replay strokes', () => player.replay()),
    b(met.has(hb.c) ? '✓ I know this' : 'I know this', async () => {
      if (met.has(hb.c)) met.delete(hb.c);
      else {
        met.add(hb.c);
        introduced.delete(hb.c);
      }
      await load(hb.c).catch(showError);
    }, { class: met.has(hb.c) ? 'solid' : '' }),
    b('Quiz: which kanji?', () => startQuiz('form').catch(showError)),
    hb.on.length ? b('Quiz: how is it read?', () => startQuiz('sound').catch(showError)) : null,
    b('Ask Claude', () => {
      app.sendMessage({ role: 'user', content: [{ type: 'text', text: `Tell me about ${hb.c} (${hb.gloss}): what its parts and the kanji around it on the compass teach.` }] }).catch(() => setStatus('This host does not let the compass send a message to the chat.'));
    }, { class: 'grow' }),
    b('Back to card', () => collapse().catch(showError)),
  );
}

function renderTrail(): void {
  const n = trail.length;
  fill($('trail'), 
    ...trail.flatMap((k, i) => {
      const last = i === n - 1;
      return [
        i > 0 ? h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→') : null,
        last ? h('span', { class: 'cur' }, k) : h('button', { type: 'button', title: `Go back to ${k}`, onclick: () => moveTo(k) }, k),
      ];
    }),
  );
}

function renderHubFace(): void {
  const hb = payload.hub;
  const q = $('hubq');
  const canvas = $('c');
  if (quiz?.q.kind === 'form' && !quiz.verdict) {
    q.hidden = false;
    q.textContent = `“${hb.gloss}”`;
    canvas.style.visibility = 'hidden';
  } else {
    q.hidden = !!hb.strokes.length;
    q.textContent = hb.c;
    q.style.fontFamily = 'var(--kanji)';
    q.style.fontSize = '40cqw';
    canvas.style.visibility = 'visible';
  }
}

function renderCard(arrive: boolean): void {
  const hb = payload.hub;
  const hub = $('hub');
  if (arrive) {
    hub.classList.remove('pop');
  }
  $('hubq').hidden = !!hb.strokes.length;
  $('hubq').textContent = hb.c;
  $('c').style.visibility = 'visible';
  $('cKanji').textContent = hb.c;
  $('cGloss').textContent = hb.gloss;
  $('cMeta').textContent = [hb.on.join('・'), hb.grade ? `grade ${hb.grade}` : '', `${hb.strokeCount} strokes`, payload.demo ? 'demo learner' : ''].filter(Boolean).join(' · ');
  $('cParts').textContent = hb.parts.length ? `Made of ${hb.parts.map((p) => p.shown + (ROLE_NAME[p.role] ? ` (${ROLE_NAME[p.role]})` : '')).join(' + ')}` : `A part of other kanji; no parts of its own.`;
  const items = payload.ring.items;
  const cards = items.map((it) => {
    const rc = REL_CLASS[it.relation];
    const c = h(
      'button',
      {
        class: `ccard ${rc} ${it.met ? 'met' : ''} ${it.locked ? 'locked' : ''}`,
        type: 'button',
        role: 'listitem',
        'aria-label': `${it.k}, ${it.gloss}. ${it.label}.${it.met ? '' : ' New.'}${it.locked ? ' Waits for another day.' : ''}`,
      },
      h('span', { class: 'g' }, it.k),
      h('span', { class: 'gl' }, it.gloss),
      h('span', { class: 'pill' }, it.label),
      h('span', { class: 'badge' }, it.locked ? 'later' : it.met ? '✓' : 'new'),
    );
    c.addEventListener('click', () => (it.locked ? explainCard(it) : moveTo(it.k)));
    for (const ev of ['mouseenter', 'focus'] as const) c.addEventListener(ev, () => explainCard(it));
    return c;
  });
  const total = payload.ring.counts['phonetic-series'] + payload.ring.counts['shares-part'] + payload.ring.counts['built-on'];
  if (payload.ring.pages > 1) {
    const next = (payload.ring.page + 1) % payload.ring.pages;
    cards.push(h('button', { class: 'ccard', type: 'button', style: 'align-content:center;min-height:90px', onclick: () => load(hb.c, { filter: payload.ring.relation, page: next }).catch(showError) }, h('span', { class: 'g' }, '›'), h('span', { class: 'gl' }, `${items.length} of ${total}`), h('span', { class: 'pill', style: '--rc:var(--muted)' }, 'more')));
  }
  fill($('carousel'), ...cards);
  $('carousel').scrollLeft = 0;
  setCardStatus(total ? `${items.length} of ${total} related kanji. Kanji you know come first; tap one to make it the center.` : `${hb.c} has no related kanji in this set.`);
  fill($('cActions'),
    h('button', { type: 'button', class: 'solid', onclick: () => expand().catch(showError) }, 'Expand'),
    h('button', { type: 'button', onclick: () => expand().then(() => startQuiz('form')).catch(showError) }, 'Quiz me'),
  );
}

function setCardStatus(t: string | Node): void {
  $('cStatus').replaceChildren(typeof t === 'string' ? document.createTextNode(t) : t);
}

function explainCard(it: RingItem): void {
  const frag = document.createDocumentFragment();
  frag.append(h('b', {}, `${it.k} `), `${it.gloss}. ${it.note ? it.note.charAt(0).toUpperCase() + it.note.slice(1) + '. ' : ''}`);
  if (it.locked) frag.append(`Waits for another day: easy to confuse with ${it.lockedBy}, which is new this session.`);
  else if (!it.met) frag.append('New to you.');
  setCardStatus(frag);
}

function render(arrive: boolean): void {
  applyLayout();
  if (!isFull()) {
    renderCard(arrive);
    return;
  }
  $('demo').textContent = payload.demo ? `Demo learner · ${met.size} kanji known` : `${met.size} kanji known`;
  if (arrive) {
    const hub = $('hub');
    hub.classList.remove('pop');
    void hub.offsetWidth;
    hub.classList.add('pop');
  }
  renderHubFace();
  renderTrail();
  if (quiz) {
    renderQuiz();
    return;
  }
  renderRing(arrive);
  renderLegend();
  renderHubInfo();
  renderActions();
  $('verdict').hidden = true;
  const r = payload.ring;
  const total = r.counts['phonetic-series'] + r.counts['shares-part'] + r.counts['built-on'];
  defaultStatus = total
    ? `${r.items.length} of ${total} neighbors${r.relation === 'all' ? '' : ` by “${REL_NAME[r.relation].toLowerCase()}”`}. Kanji you know come first. Pick one to move there${r.lockedCount ? `; ${r.lockedCount} that are easy to confuse with a new kanji wait for another day` : ''}.`
    : `${payload.hub.c} has no neighbors in this set.`;
  setStatus(defaultStatus);
}

// --- the question ----------------------------------------------------------------------------

async function startQuiz(kind: 'form' | 'sound'): Promise<void> {
  const q = await call<PublicQuestion>('compass_question', { target: payload.hub.c, kind, met: [...met] });
  quiz = { q };
  if (kind === 'sound') player.replay();
  render(false);
}

function renderQuiz(): void {
  clearStage();
  const qz = quiz!;
  const v = qz.verdict;
  const stage = $('stage');
  qz.q.options.forEach((o, i) => {
    const { x, y } = place(4, i, -90, 4);
    const info = v?.options.find((x2) => x2.id === o.id);
    const klass = info ? (info.correct ? 'right' : o.id === v!.chosenId ? 'wrong' : '') : '';
    const rel = info?.relation ?? 'answer';
    const rc = info ? (info.correct ? 'built' : cls(rel)) : '';
    const t = h(
      'button',
      { class: `tile opt ${rc} ${klass}`, type: 'button', style: `--x:${x}%;--y:${y}%;--i:${i}`, disabled: !!v || busy, 'aria-label': o.text },
      h('span', { class: `g ${qz.q.kind === 'sound' ? 'rd' : ''}` }, o.text),
      info ? h('span', { class: 'pill' }, info.correct ? 'the answer' : optionLabel(info)) : null,
      info && info.correct ? h('span', { class: 'badge' }, '✓') : null,
    );
    t.addEventListener('click', () => answer(o.id).catch(showError));
    stage.append(t);
    if (info) $('lines').append(line(x, y, rc || 'neutral'));
  });
  fill($('legend'));
  fill($('hubinfo'), h('span', { class: 'm' }, qz.q.prompt));
  fill($('parts'), );
  fill($('actions'), h('button', { type: 'button', onclick: () => { quiz = null; load(payload.hub.c).catch(showError); } }, 'Back to the compass'));
  setStatus(v ? '' : 'Choose one. Wrong answers are drawn only from kanji you know, so a miss tells you why.');
  renderVerdict();
}

function optionLabel(o: { relation: OptionRelation; via?: string; owner: string }): string {
  switch (o.relation) {
    case 'part': return 'part of it';
    case 'built-on': return 'built on it';
    case 'shares-part': return `shares ${o.via ?? ''}`.trim();
    case 'phonetic-series': return `sound ${o.via ?? ''}`.trim();
    case 'shares-reading': return 'sounds alike';
    default: return 'unrelated';
  }
}

async function answer(id: string): Promise<void> {
  if (!quiz || quiz.verdict || busy) return;
  busy = true;
  try {
    const v = await call<Verdict>('compass_answer', { target: payload.hub.c, kind: quiz.q.kind, met: [...met], chosen: id });
    quiz.verdict = v;
    if (v.correct) {
      met.add(payload.hub.c);
      introduced.delete(payload.hub.c);
    }
    renderHubFace();
    renderQuiz();
    $('demo').textContent = payload.demo ? `Demo learner · ${met.size} kanji known` : `${met.size} kanji known`;
    tellModel(`Quiz on ${payload.hub.c}: the learner chose ${v.options.find((o) => o.id === id)?.text} and was ${v.correct ? 'right' : `wrong. ${v.diagnosis?.fact ?? ''}`}`);
  } finally {
    busy = false;
  }
}

function renderVerdict(): void {
  const box = $('verdict');
  const qz = quiz!;
  const v = qz.verdict;
  if (!v) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const other = qz.q.kind === 'form' ? 'sound' : 'form';
  const next = h('button', { type: 'button', onclick: () => startQuiz(other).catch(showError) }, other === 'sound' ? 'Ask how it is read' : 'Ask which kanji');
  if (v.correct) {
    box.replaceChildren(
      h('div', { class: 'verdict ok' }, h('h2', {}, 'Right.'), h('p', {}, qz.q.kind === 'form' ? `${payload.hub.c} means “${payload.hub.gloss}”.` : `${payload.hub.c} is read ${v.answerText}.`), h('div', { class: 'actions' }, next)),
    );
    return;
  }
  const d = v.diagnosis!;
  const chosen = v.options.find((o) => o.id === v.chosenId)!;
  const walkLabel = d.owner !== payload.hub.c && d.relation !== 'neutral' ? `See ${d.owner} beside ${payload.hub.c} on the compass` : 'Back on the compass';
  const toCompass = h('button', { type: 'button', class: 'solid', onclick: () => {
    const focus = d.relation === 'neutral' ? undefined : d.owner;
    quiz = null;
    load(payload.hub.c, { focus }).catch(showError);
  } }, walkLabel);
  box.replaceChildren(
    h(
      'div',
      { class: 'verdict no' },
      h('h2', {}, 'Not quite.'),
      h('p', {}, `You chose `, jp(chosen.text), `. The answer is `, jp(v.answerText), '.'),
      h('p', {}, h('span', { class: `cause ${cls(d.relation)}` }, causeName(d)), ' ', d.fact),
      h('div', { class: 'actions' }, toCompass, next),
    ),
  );
}

function causeName(d: { relation: OptionRelation; via?: string }): string {
  switch (d.relation) {
    case 'part': return 'part, not the whole';
    case 'built-on': return `built-on${d.via ? ` · ${d.via}` : ''}`;
    case 'shares-part': return `shares-part${d.via ? ` · ${d.via}` : ''}`;
    case 'phonetic-series': return `phonetic-series${d.via ? ` · ${d.via}` : ''}`;
    case 'shares-reading': return 'shares-reading';
    default: return 'no relation';
  }
}

// --- start ------------------------------------------------------------------------------------

$('hub').addEventListener('click', () => player.replay());
document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    app.openLink({ url: a.href }).catch(() => {});
  }),
);

app.ontoolresult = (result) => {
  const p = result.structuredContent as Payload | undefined;
  if (result.isError || !p?.hub) {
    showError((result.content?.find((c) => c.type === 'text') as { text?: string } | undefined)?.text ?? 'The compass could not open.');
    return;
  }
  payload = p;
  met.clear();
  introduced.clear();
  p.state.met.forEach((k) => met.add(k));
  p.state.introduced.forEach((k) => introduced.add(k));
  if (!met.has(p.hub.c)) introduced.add(p.hub.c);
  trail = [p.hub.c];
  quiz = null;
  player.load(p.hub.strokes);
  player.play();
  render(true);
};
app.onhostcontextchanged = () => {
  if (payload && (isFull() ? 'full' : 'card') !== shownLayout) {
    if (!isFull()) quiz = null;
    render(false);
  }
};

app.connect().catch((e) => showError(`Could not reach the host: ${e?.message ?? e}`));
