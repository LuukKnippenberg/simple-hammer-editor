import type { Editor } from '../editor.ts';
import { h } from './dom.ts';

/** Sidebar panel with map facts and a round-trip check (parse → write must reproduce the file exactly). */
export function mountDocumentPanel(editor: Editor, sidebar: HTMLElement): void {
  const body = h('div');
  const result = h('div', { style: { marginTop: '6px', lineHeight: '1.5' } });
  const verify = h('button', { title: 'Write the map back out and compare it with the file on disk' }, 'Verify round-trip');
  sidebar.append(h('div.section', {}, h('h3', {}, 'Document'), body, verify, result));

  const fmtBytes = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  const render = () => {
    const d = editor.doc;
    const solids = d.allSolids();
    const disp = solids.filter((s) => s.isDisplacement).length;
    const mats = new Set<string>();
    for (const s of solids) for (const side of s.sides) mats.add(side.material.toLowerCase());
    const rows: [string, string][] = [
      ['Map', `${editor.dirty ? '• ' : ''}${editor.mapName}`],
      ['Saves to', `maps/${editor.mapName}`],
      ['File size', editor.sourceText ? fmtBytes(editor.sourceText.length) : '—'],
      ['Brushes', `${solids.length.toLocaleString()} (${disp} displacements)`],
      ['Entities', d.entities.length.toLocaleString()],
      ['Materials', mats.size.toLocaleString()],
      ['Map version', d.roots.find((r) => r.name.toLowerCase() === 'versioninfo')?.get('mapversion') ?? '—'],
    ];
    body.replaceChildren(...rows.map(([k, v]) => h('div.row', {}, h('label', {}, k), h('span', {}, v))));
  };
  for (const ev of ['document', 'change', 'saved']) editor.on(ev, render);
  editor.on('document', () => result.replaceChildren());
  render();

  verify.addEventListener('click', () => {
    const t0 = performance.now();
    const out = editor.doc.serialize();
    const ms = Math.round(performance.now() - t0);
    const src = editor.sourceText;
    if (!src) {
      result.replaceChildren(h('span', { style: { color: 'var(--muted)' } }, 'No source file to compare with.'));
    } else if (out === src) {
      result.replaceChildren(
        h('b', { style: { color: 'var(--ok)' } }, '✓ Byte-identical'),
        h('br'),
        h('span', { style: { color: 'var(--muted)' } }, `${src.length.toLocaleString()} bytes written in ${ms} ms`),
      );
    } else {
      const a = src.split(/\r?\n/), b = out.split(/\r?\n/);
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      result.replaceChildren(
        h('b', { style: { color: editor.dirty ? 'var(--accent)' : 'var(--danger)' } }, editor.dirty ? 'Differs (unsaved edits)' : '✗ Differs'),
        h('br'),
        h('span', { style: { color: 'var(--muted)' } }, `first difference at line ${i + 1}`),
      );
    }
  });
}
