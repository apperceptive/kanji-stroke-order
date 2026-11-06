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

/**
 * Keep clear of what the host draws over the app: in Claude's fullscreen the message box covers the bottom
 * 92 px. The insets arrive in the host context and become CSS variables the page pads itself with.
 */
export function applySafeArea(app: App): void {
  const i = app.getHostContext()?.safeAreaInsets;
  const root = document.documentElement.style;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) root.setProperty(`--sa-${side}`, `${i?.[side] ?? 0}px`);
}
