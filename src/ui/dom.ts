/** Tiny DOM helper: h('button.primary', { onclick }, 'Save'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Partial<Record<string, unknown>> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name as K);
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else el.id = r.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

let toastTimer = 0;
export function toast(container: HTMLElement, text: string, ms = 2500): void {
  let el = container.querySelector<HTMLElement>('.toast');
  if (!el) container.append((el = h('div.toast')));
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el!.style.opacity = '0'), ms);
}
