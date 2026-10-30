import type { Editor } from '../editor.ts';
import { convertToDynamic, nonStaticProps, runChecks, type Check } from '../edit/preflight.ts';
import { h, toast } from './dom.ts';
import { missionRes } from './missionPanel.ts';
import { VmfDocument } from '../vmf/map.ts';
import { applyMapSettings } from '../lw/mapSettings.ts';

export interface CompileOutcome {
  ok: boolean;
  leaked: boolean;
  name: string;
  seconds: number;
}

/** Compiles the open map through the dev server and streams the tool output into `onLine`. */
export async function compileCurrent(
  editor: Editor,
  opts: { name: string; quality: 'fast' | 'final'; navmesh: boolean },
  onLine: (kind: string, text: string) => void,
): Promise<CompileOutcome | null> {
  if (opts.name.toLowerCase().startsWith('sp_')) {
    await fetch(`/api/mapres?name=${encodeURIComponent(opts.name)}`, { method: 'POST', body: missionRes(editor, opts.name.toLowerCase()) });
    onLine('step', `Wrote maps/${opts.name.toLowerCase()}.res (mission list entry)`);
  }
  // Map settings the map lacks are added to the compiled copy only.
  const copy = VmfDocument.parse(editor.doc.serialize());
  const added = applyMapSettings(copy);
  if (added.length) onLine('step', `Map settings added with default values: ${added.join(', ')}`);
  const q = new URLSearchParams({ name: opts.name, quality: opts.quality, navmesh: opts.navmesh ? '1' : '0' });
  const res = await fetch(`/api/compile?${q}`, { method: 'POST', body: copy.serialize() });
  if (!res.ok || !res.body) {
    onLine('error', (await res.json().catch(() => ({ error: res.statusText }))).error);
    return null;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result: CompileOutcome | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const l of lines) {
      if (!l) continue;
      const m = JSON.parse(l) as { kind: string; text: string };
      if (m.kind === 'result') result = JSON.parse(m.text);
      else onLine(m.kind, m.text);
    }
  }
  return result;
}

export function launchMap(name: string): Promise<boolean> {
  return fetch(`/api/launch?name=${encodeURIComponent(name)}`, { method: 'POST' }).then((r) => r.ok);
}

/** "Compile & test" dialog: pre-flight checks with one-click fixes, compile options, live log. */
export function mountCompileDialog(editor: Editor): { open(): void } {
  const backdrop = h('div.modal-backdrop', { hidden: true });
  const dialog = h('div.modal');
  backdrop.append(dialog);
  document.body.append(backdrop);
  const close = () => (backdrop.hidden = true);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const name = h('input', { style: { width: '180px' } }) as HTMLInputElement;
  const quality = h('select', {}, h('option', { value: 'fast' }, 'Fast (preview)'), h('option', { value: 'final' }, 'Final (release quality)')) as HTMLSelectElement;
  const navmesh = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const launch = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const checksEl = h('div.checks');
  const log = h('pre.compile-log');
  const status = h('div.compile-status');
  const installEl = h('span.hint', { title: 'Change it with the Game picker in the top bar' });
  // Read on every open: the install can change from another tab.
  const showInstall = () => void fetch('/api/config').then((r) => r.json()).then((cfg: { install: string | null }) => {
    installEl.textContent = cfg.install ?? 'No Lambda Wars install found';
  });
  const compileBtn = h('button.primary', {}, 'Compile') as HTMLButtonElement;
  const playBtn = h('button', { disabled: true }, '▶ Launch game') as HTMLButtonElement;
  let lastName = '';

  const renderChecks = async () => {
    const checks: Check[] = runChecks(editor);
    const bad = await nonStaticProps(editor);
    checks.push({
      id: 'static', label: 'Static props use static models', severity: 'warning', ok: !bad.length,
      detail: bad.length ? `${bad.length} prop_static use a physics-only model; vbsp would delete them. Converting them to prop_dynamic keeps them.` : 'All prop_static models were compiled with $staticprop.',
      fixLabel: 'Convert to prop_dynamic',
      fix: bad.length ? () => convertToDynamic(editor, bad) : undefined,
    });
    const fixable = checks.filter((c) => !c.ok && c.fix);
    checksEl.replaceChildren();
    checksEl.append(
      ...checks.map((c) => h('div.check' + (c.ok ? '.ok' : c.severity === 'error' ? '.err' : '.warn') as 'div', {},
        h('span.icon', {}, c.ok ? '✓' : c.severity === 'error' ? '✗' : '!'),
        h('div', { style: { flex: '1' } }, h('b', {}, c.label), h('div.hint', {}, c.detail)),
        !c.ok && c.fix ? h('button', { onclick: () => { c.fix!(); void renderChecks(); } }, c.fixLabel ?? 'Fix') : null)),
    );
    if (fixable.length > 1) checksEl.append(h('button', { onclick: () => { for (const c of fixable) c.fix!(); void renderChecks(); } }, 'Fix all'));
  };

  const append = (kind: string, text: string) => {
    const line = h('div.l-' + kind as 'div', {}, text);
    log.append(line);
    if (log.childElementCount > 4000) log.firstElementChild?.remove();
    log.scrollTop = log.scrollHeight;
    if (kind === 'step' || kind === 'warn' || kind === 'error' || kind === 'done') status.textContent = text;
  };

  compileBtn.addEventListener('click', async () => {
    compileBtn.disabled = true;
    playBtn.disabled = true;
    log.replaceChildren();
    const t0 = performance.now();
    const r = await compileCurrent(editor, { name: name.value, quality: quality.value as 'fast' | 'final', navmesh: navmesh.checked }, append)
      .catch((e) => { append('error', String(e)); return null; });
    compileBtn.disabled = false;
    if (!r?.ok) {
      status.textContent = 'Compile failed – see the log.';
      return;
    }
    lastName = r.name;
    playBtn.disabled = false;
    status.textContent = `Compiled maps/${r.name}.bsp in ${((performance.now() - t0) / 1000).toFixed(1)} s${r.leaked ? ' (leaked)' : ''}`;
    editor.emit('compiled');
    if (launch.checked) void launchMap(r.name).then((ok) => toast(editor.container, ok ? `Launching Lambda Wars on ${r.name}…` : 'Could not launch the game'));
  });
  playBtn.addEventListener('click', () => lastName && void launchMap(lastName));

  dialog.append(
    h('div.modal-head', {}, h('b', {}, 'Compile & test in Lambda Wars'), h('button', { onclick: close }, '✕')),
    h('div.section', {}, h('h3', {}, 'Checks'), checksEl),
    h('div.section', {}, h('h3', {}, 'Options'),
      h('div.row', {}, h('label', {}, 'Game'), installEl),
      h('div.row', {}, h('label', {}, 'Map name'), name),
      h('div.row', {}, h('label', {}, 'Quality'), quality),
      h('div.row', {}, h('label', {}, 'Navmesh'), navmesh, h('span.hint', {}, 'build so units can move')),
      h('div.row', {}, h('label', {}, 'Then'), launch, h('span.hint', {}, 'launch the game on the map'))),
    h('div.row', {}, compileBtn, playBtn, status),
    log,
  );

  return {
    open() {
      name.value = editor.mapName.replace(/\.vmf$/i, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      void renderChecks();
      showInstall();
      backdrop.hidden = false;
    },
  };
}
