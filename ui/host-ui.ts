import type { App } from '@modelcontextprotocol/ext-apps';

/** The sources-and-licenses control in the footer, and links that open through the host. */
export function wireHelp(app: App): void {
  const btn = document.getElementById('helpBtn')!;
  const dialog = document.getElementById('help')!;
  const close = document.getElementById('helpClose')!;
  const show = (open: boolean) => {
    dialog.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    (open ? close : btn).focus();
  };
  btn.addEventListener('click', () => show(true));
  close.addEventListener('click', () => show(false));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) show(false); // a click on the dimmed area outside the box
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dialog.hidden) {
      e.stopPropagation();
      show(false);
    }
  });
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      app.openLink({ url: a.href }).catch(() => {});
    }),
  );
}

/** What the window controls need to know and do. An app with its own fallback for hosts without fullscreen supplies its own. */
export interface WindowHooks {
  isFull(): boolean;
  canExpand(): boolean;
  expand(): Promise<void>;
  collapse(): Promise<void>;
}

/** The host's own display modes: fullscreen where it offers one (in Claude's desktop app, the panel), inline otherwise. */
export function hostWindow(app: App): WindowHooks {
  return {
    isFull: () => app.getHostContext()?.displayMode === 'fullscreen',
    canExpand: () => !!app.getHostContext()?.availableDisplayModes?.includes('fullscreen'),
    expand: async () => void (await app.requestDisplayMode({ mode: 'fullscreen' })),
    collapse: async () => void (await app.requestDisplayMode({ mode: 'inline' })),
  };
}

/**
 * The expand and close buttons in the top right of an app (ui/winctl.html). Expand toggles between the inline
 * card and the full view; close, shown only in the full view, goes back. Returns the function to call whenever
 * the state may have changed.
 */
export function wireWindowControls(hooks: WindowHooks, onError: (e: unknown) => void): () => void {
  const sync = () => {
    const full = hooks.isFull();
    document.body.dataset.display = full ? 'full' : 'inline';
    document.querySelectorAll<HTMLButtonElement>('.wc[data-act=expand]').forEach((b) => {
      b.hidden = !full && !hooks.canExpand();
      b.title = full ? 'Restore' : 'Expand';
      b.setAttribute('aria-label', b.title);
    });
  };
  document.querySelectorAll<HTMLButtonElement>('.wc').forEach((b) =>
    b.addEventListener('click', () => {
      const toggle = b.dataset.act === 'expand' && !hooks.isFull() ? hooks.expand() : hooks.collapse();
      toggle.catch(onError).finally(sync);
    }),
  );
  sync();
  return sync;
}

/**
 * Keep clear of what the host draws over the app: in Claude's fullscreen the message box covers the bottom
 * 92 px. The insets arrive in the host context and become CSS variables the page pads itself with.
 */
export function applySafeArea(app: App): void {
  const i = app.getHostContext()?.safeAreaInsets;
  const root = document.documentElement.style;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) root.setProperty(`--sa-${side}`, `${i?.[side] ?? 0}px`);
}

/** Tell the host's model what the learner just did, without a model turn: it reads the note when the learner next writes. Hosts that do not support it ignore the call. */
export function tellModel(app: App, text: string): void {
  app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => {});
}

export interface Suggestion {
  label: string;
  utterance: string;
}

/**
 * Buttons that say the next thing for the learner: a press posts the utterance to the chat as the learner's own
 * message, so the model answers it and routes it as if it had been typed. Reports how long the host took to accept
 * the message, which is not the time to the reply. `status` shows the outcome.
 */
export function wireSuggestions(app: App, box: HTMLElement, items: Suggestion[], status: (t: string) => void): void {
  box.replaceChildren(
    ...items.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'say';
      b.textContent = s.label;
      b.title = s.utterance;
      b.addEventListener('click', () => {
        const t0 = performance.now();
        b.disabled = true;
        status('Sending to the chat…');
        const failed = () => {
          b.disabled = false;
          status('This host does not let the app send a message to the chat.');
        };
        app
          .sendMessage({ role: 'user', content: [{ type: 'text', text: s.utterance }] })
          .then((r) => (r.isError ? failed() : status(`Sent to the chat; the host accepted it in ${Math.round(performance.now() - t0)} ms.`)))
          .catch(failed);
      });
      return b;
    }),
  );
}
