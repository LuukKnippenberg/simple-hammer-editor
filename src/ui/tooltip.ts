import { h } from './dom.ts';

/**
 * Fast styled tooltips in place of the browser's `title` one. An element opts in with `data-tip`
 * (and `data-tip-key` for its keyboard shortcut, several keys separated by spaces); `tip()` builds
 * those attributes plus a matching `aria-label`. A tip text "Name: details" shows the name in bold.
 */
export function tip(label: string, key?: string): Record<string, string | undefined> {
  return { 'data-tip': label, 'data-tip-key': key, 'aria-label': key ? `${label} (${key})` : label };
}

const SHOW_MS = 120;
/** A tip that closed this recently makes the next one show at once, as when running down the tool column. */
const CHAIN_MS = 300;
let installed = false;

/** Wires the one shared tooltip element to every `[data-tip]` element in the page. Safe to call twice. */
export function installTooltips(): void {
  if (installed) return;
  installed = true;
  const el = h('div.tip', { role: 'tooltip' });
  el.hidden = true;
  document.body.append(el);
  let target: HTMLElement | null = null;
  let timer = 0;
  let closedAt = -Infinity;

  const hide = () => {
    clearTimeout(timer);
    target = null;
    if (!el.hidden) closedAt = performance.now();
    el.hidden = true;
  };
  const show = (t: HTMLElement) => {
    const text = t.dataset.tip ?? '';
    const i = text.indexOf(': ');
    el.replaceChildren(
      i > 0 ? h('div', {}, h('b', {}, text.slice(0, i)), h('div.tip-more', {}, text.slice(i + 2))) : h('div', {}, text),
      ...(t.dataset.tipKey ? [h('span.tip-keys', {}, ...t.dataset.tipKey.split(' ').map((k) => h('kbd', {}, k)))] : []),
    );
    el.hidden = false;
    const r = t.getBoundingClientRect();
    const w = el.offsetWidth, ht = el.offsetHeight, pad = 6;
    let x = r.right + 8;
    if (x + w > innerWidth - pad) x = Math.max(pad, r.left - 8 - w);
    const y = Math.min(Math.max(pad, r.top + r.height / 2 - ht / 2), innerHeight - ht - pad);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  const tipOf = (n: EventTarget | null) => (n as Element | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
  document.addEventListener('pointerover', (e) => {
    const t = tipOf(e.target);
    if (t === target) return;
    hide();
    if (!t || e.pointerType === 'touch') return;
    target = t;
    if (performance.now() - closedAt < CHAIN_MS) show(t);
    else timer = window.setTimeout(() => target === t && show(t), SHOW_MS);
  });
  document.addEventListener('pointerout', (e) => {
    // Onto another tipped element: pointerover swaps the tip instead.
    if (target && !tipOf(e.relatedTarget)) hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}
