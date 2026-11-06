import { App } from '@modelcontextprotocol/ext-apps';
import { BrushPlayer, type PlayerState, type Stroke } from './brush-player';
import { applySafeArea, wireHelp } from './host-ui';

interface StrokeResult {
  character: string;
  gloss: string;
  on: string[];
  kun: string[];
  reading: string;
  strokes: Stroke[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// KanjiVG stroke type symbols, named for a learner. The first symbol decides; a few families share a name.
const NAMES: Record<string, string> = {
  '㇐': 'horizontal', '㇑': 'vertical', '㇒': 'left sweep', '㇓': 'left sweep', '㇔': 'dot', '㇏': 'right sweep',
  '㇀': 'rising stroke', '㇕': 'turn', '㇆': 'turn with hook', '㇖': 'hook', '㇚': 'vertical hook', '㇟': 'curved hook',
  '㇂': 'curved hook', '㇛': 'hook', '㇗': 'turn', '㇙': 'turn', '㇄': 'turn', '㇅': 'turn', '㇈': 'turn', '㇊': 'turn',
  '㇋': 'turn', '㇌': 'turn', '㇍': 'turn', '㇎': 'turn', '㇇': 'turn', '㇉': 'turn', '㇁': 'hook', '㇃': 'turn',
};
const nameOf = (type: string) => NAMES[[...type.split('/').pop()!][0]] ?? 'stroke';

const app = new App({ name: 'Nihongoism stroke player', version: '0.1.0' });
const canvas = $<HTMLCanvasElement>('c');
let strokes: Stroke[] = [];
let last: PlayerState = { completed: 0, total: 0, running: false, inStroke: 0 };

const player = new BrushPlayer(canvas, (s) => {
  last = s;
  paint(s);
});

function paint(s: PlayerState): void {
  const busy = s.inStroke > 0;
  const shown = busy ? s.completed + 1 : s.completed;
  $('where').innerHTML = s.total ? (shown === 0 ? `<b>${s.total}</b> strokes` : s.completed === s.total ? `All <b>${s.total}</b> strokes` : `Stroke <b>${shown}</b> of ${s.total}`) : '';
  $('type').textContent = shown > 0 && strokes[shown - 1] ? nameOf(strokes[shown - 1][0]) : '';
  const play = $<HTMLButtonElement>('play');
  play.textContent = s.running ? 'Pause' : s.completed >= s.total && s.total ? 'Again' : s.completed > 0 || busy ? 'Resume' : 'Play';
  $<HTMLButtonElement>('back').disabled = s.completed === 0 && !busy;
  $<HTMLButtonElement>('step').disabled = s.completed >= s.total;
  const scrub = $<HTMLInputElement>('scrub');
  scrub.max = String(s.total);
  scrub.value = String(s.completed);
  scrub.setAttribute('aria-valuetext', `${s.completed} of ${s.total} strokes drawn`);
  document.querySelectorAll<HTMLElement>('#chips .chip').forEach((c, i) => {
    c.classList.toggle('on', i === shown - 1);
    c.classList.toggle('next', i === s.completed && !busy && s.completed < s.total);
  });
}

function show(r: StrokeResult): void {
  strokes = r.strokes;
  $('kj').textContent = r.character;
  $('gl').textContent = r.gloss;
  $('meta').textContent = [r.reading, `${r.strokes.length} strokes`].filter(Boolean).join(' · ');
  const chips = $('chips');
  chips.replaceChildren(
    ...r.strokes.map((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = `${i + 1} ${nameOf(s[0])}`;
      b.title = `Show strokes up to ${i + 1}`;
      b.addEventListener('click', () => player.seek(i + 1));
      return b;
    }),
  );
  $('err').hidden = true;
  player.load(r.strokes);
  player.play();
}

function fail(msg: string): void {
  $('err').textContent = msg;
  $('err').hidden = false;
}

$('play').addEventListener('click', () => player.toggle());
$('replay').addEventListener('click', () => player.replay());
$('back').addEventListener('click', () => player.stepBack());
$('step').addEventListener('click', () => player.stepForward());
$<HTMLInputElement>('scrub').addEventListener('input', (e) => player.seek(Number((e.target as HTMLInputElement).value)));
$<HTMLSelectElement>('speed').addEventListener('change', (e) => (player.speed = Number((e.target as HTMLSelectElement).value)));
$<HTMLInputElement>('ghost').addEventListener('change', (e) => player.setGhost((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('grid').addEventListener('change', (e) => player.setGuide((e.target as HTMLInputElement).checked));
// Space plays and pauses, arrows step: a keyboard path through the same controls.
document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); player.toggle(); }
  else if (e.key === 'ArrowRight') player.stepForward();
  else if (e.key === 'ArrowLeft') player.stepBack();
});
wireHelp(app);

app.ontoolresult = (result) => {
  const r = result.structuredContent as StrokeResult | undefined;
  if (result.isError || !r?.strokes?.length) fail(result.content?.find((c) => c.type === 'text')?.text ?? 'No stroke data.');
  else show(r);
};

app.onhostcontextchanged = () => applySafeArea(app);
app.connect().then(() => applySafeArea(app)).catch((e) => fail(`Could not reach the host: ${e?.message ?? e}`));
