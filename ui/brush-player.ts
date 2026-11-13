import { createBrush } from 'brush-core';

/** KanjiVG stroke type and centerline, in writing order. */
export type Stroke = [type: string, d: string];

export interface PlayerState {
  completed: number;
  total: number;
  running: boolean;
  /** 0–1 progress through the stroke being brushed, 0 when none is. */
  inStroke: number;
}

// Brush defaults from brush-kanji's build.py: the size interpolates between 木 (4 strokes) and 靄 (24).
const baseFor = (n: number) => Math.round(Math.min(4.5, 3.5 * Math.pow(4 / n, 0.37)) * 100) / 100;

const INK = '#141414';
const ACCENT = '#98342c';
const GHOST = '#e6d6cb';

/**
 * Learner-paced playback over the brush engine. The engine (ui/vendor/brush-engine.js, from the brush-kanji
 * skill) builds and paints single strokes; this class decides which stroke is on the page and how fast it
 * runs: play, pause, step either way, scrub, replay. The newest stroke is shown in the accent color until the
 * next one starts, so a paused or stepped page says which stroke it is looking at.
 */
export class BrushPlayer {
  private ctx: CanvasRenderingContext2D;
  private ink = createBrush({ base: 3, speed: 0.1, gap: 300, ink: INK });
  private accent = this.ink;
  private ghost = this.ink;
  private done = document.createElement('canvas');
  private layer = document.createElement('canvas');
  private ghostCanvas = document.createElement('canvas');
  private ghostFor = -1;
  private dctx = this.done.getContext('2d')!;
  private lctx = this.layer.getContext('2d')!;
  private strokes: any[] = [];
  private gapMs = 300;
  private scale = 1;
  private dpr = 1;
  private doneCount = 0;
  private completed = 0;
  private tau = 0;
  private gap = 0;
  private last = 0;
  private raf = 0;
  running = false;
  private stopAfter = false;
  speed = 1;
  guide = false;
  ghostOn = true;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private canvas: HTMLCanvasElement, private onChange: (s: PlayerState) => void = () => {}) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  load(strokes: Stroke[]): void {
    cancelAnimationFrame(this.raf);
    const n = Math.max(1, strokes.length);
    const cfg = { base: baseFor(n), speed: n <= 8 ? 0.075 : 0.1, gap: n <= 8 ? 380 : 200, ink: INK };
    this.gapMs = cfg.gap;
    // build() reads the brush size when it runs, so make the brushes per character with the right config.
    // Only the ink brush builds strokes; the others just paint them in another color, so their measuring
    // elements can go straight away.
    this.ink.dispose();
    this.ink = createBrush(cfg);
    this.accent = createBrush({ ...cfg, ink: ACCENT });
    this.ghost = createBrush({ ...cfg, ink: GHOST });
    this.accent.dispose();
    this.ghost.dispose();
    this.strokes = strokes.map((s, i) => this.ink.build(s, i));
    this.completed = 0;
    this.tau = 0;
    this.gap = 0;
    this.running = false;
    this.doneCount = 0;
    this.ghostFor = -1;
    // resize() does nothing when the canvas keeps its size, so the previous kanji's finished strokes and its
    // preview would stay on their layers and the new kanji would be brushed on top of them.
    for (const c of [this.done, this.ghostCanvas]) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    this.resize();
    this.render();
    this.notify();
  }

  get total(): number {
    return this.strokes.length;
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * this.dpr);
    const h = Math.round(r.height * this.dpr);
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.ghostFor = -1;
    for (const c of [this.canvas, this.done, this.layer, this.ghostCanvas]) {
      c.width = w;
      c.height = h;
    }
    this.scale = w / 109;
    this.doneCount = 0;
    this.rebuildDone(this.neededDone());
    this.render();
  }

  // --- drawing ---------------------------------------------------------------------------------

  /** Ink is not quite opaque, so crossings darken a little, and its edge bleeds slightly into the paper. */
  private inkOnto(g: CanvasRenderingContext2D, edge: string): void {
    g.save();
    g.globalAlpha = 0.97;
    g.shadowColor = edge;
    g.shadowBlur = 1.1 * this.dpr;
    g.drawImage(this.layer, 0, 0);
    g.restore();
  }

  private paint(g: CanvasRenderingContext2D, brush: ReturnType<typeof createBrush>, st: any, k: number, edge: string): void {
    this.lctx.clearRect(0, 0, this.layer.width, this.layer.height);
    brush.renderStroke(this.lctx, st, k, this.scale);
    this.inkOnto(g, edge);
  }

  private accentLast(): boolean {
    return this.completed > 0 && this.completed < this.strokes.length && !(this.running && this.gap <= 0);
  }
  private neededDone(): number {
    return this.completed - (this.accentLast() ? 1 : 0);
  }

  private rebuildDone(n: number): void {
    this.dctx.clearRect(0, 0, this.done.width, this.done.height);
    for (let i = 0; i < n; i++) this.paint(this.dctx, this.ink, this.strokes[i], this.strokes[i].n, this.ink.INK_EDGE);
    this.doneCount = n;
  }

  private render(): void {
    if (!this.strokes.length || !this.canvas.width) return;
    const need = this.neededDone();
    if (need === this.doneCount + 1) {
      const st = this.strokes[this.doneCount];
      this.paint(this.dctx, this.ink, st, st.n, this.ink.INK_EDGE);
      this.doneCount = need;
    } else if (need !== this.doneCount) this.rebuildDone(need);

    const g = this.ctx;
    const { width: w, height: h } = this.canvas;
    g.clearRect(0, 0, w, h);
    if (this.guide) {
      g.save();
      g.strokeStyle = '#e3cbbf';
      g.lineWidth = this.dpr;
      g.setLineDash([4 * this.dpr, 4 * this.dpr]);
      g.beginPath();
      g.moveTo(w / 2, 0);
      g.lineTo(w / 2, h);
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
      g.stroke();
      g.restore();
    }
    if (this.ghostOn) {
      // The strokes still to come, pale, so the learner sees where the character is going. Cached per position.
      if (this.ghostFor !== this.completed) {
        const gg = this.ghostCanvas.getContext('2d')!;
        gg.clearRect(0, 0, w, h);
        for (const st of this.strokes.slice(this.completed)) this.paint(gg, this.ghost, st, st.n, 'rgba(230,214,203,.5)');
        this.ghostFor = this.completed;
      }
      g.drawImage(this.ghostCanvas, 0, 0);
    }
    g.drawImage(this.done, 0, 0);
    if (this.accentLast() && this.tau === 0) {
      const st = this.strokes[this.completed - 1];
      this.paint(g, this.accent, st, st.n, 'rgba(152,52,44,.5)');
    } else if (this.completed < this.strokes.length && this.tau > 0) {
      const st = this.strokes[this.completed];
      let k = 0;
      while (k < st.n && st.T[k + 1] <= this.tau) k++;
      this.paint(g, this.accent, st, k, 'rgba(152,52,44,.5)');
    }
  }

  private notify(): void {
    const st = this.strokes[this.completed];
    this.onChange({
      completed: this.completed,
      total: this.strokes.length,
      running: this.running,
      inStroke: st && this.tau > 0 ? Math.min(1, this.tau / st.total) : 0,
    });
  }

  // --- time ------------------------------------------------------------------------------------

  private tick = (now: number): void => {
    const dt = Math.min(64, now - this.last) * this.speed;
    this.last = now;
    if (this.running) {
      if (this.gap > 0) this.gap -= dt;
      else if (this.completed < this.strokes.length) {
        const st = this.strokes[this.completed];
        this.tau = this.reduced ? st.total : this.tau + dt;
        if (this.tau >= st.total) {
          this.completed++;
          this.tau = 0;
          this.gap = this.reduced ? 700 : this.gapMs;
          if (this.stopAfter || this.completed >= this.strokes.length) this.running = false;
        }
      }
    }
    this.render();
    this.notify();
    if (this.running) this.raf = requestAnimationFrame(this.tick);
  };

  private go(): void {
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  // --- the learner's controls ------------------------------------------------------------------

  play(): void {
    if (this.completed >= this.strokes.length) this.seek(0);
    this.running = true;
    this.stopAfter = false;
    if (this.completed === 0 && this.tau === 0) this.gap = 250;
    this.go();
  }
  pause(): void {
    this.running = false;
    this.go();
  }
  toggle(): void {
    if (this.running) this.pause();
    else this.play();
  }
  /** Brush the next stroke at the current speed, then stop. */
  stepForward(): void {
    if (this.completed >= this.strokes.length) return;
    this.running = true;
    this.stopAfter = true;
    this.gap = 0;
    this.go();
  }
  stepBack(): void {
    this.running = false;
    if (this.tau > 0) this.tau = 0;
    else this.completed = Math.max(0, this.completed - 1);
    this.go();
  }
  seek(n: number): void {
    this.running = false;
    this.completed = Math.max(0, Math.min(this.strokes.length, n));
    this.tau = 0;
    this.gap = 0;
    this.go();
  }
  replay(): void {
    this.seek(0);
    this.play();
  }
  setGuide(on: boolean): void {
    this.guide = on;
    this.go();
  }
  setGhost(on: boolean): void {
    this.ghostOn = on;
    this.go();
  }
  /** Show the finished character without animation. */
  finish(): void {
    this.seek(this.strokes.length);
  }
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ink.dispose();
  }
}
