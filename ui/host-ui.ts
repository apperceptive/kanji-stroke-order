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
