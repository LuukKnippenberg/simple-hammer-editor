import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { fgdClass } from '../assets/fgd.ts';
import { entitiesByName, getConnections, incomingConnections, resolveTarget, setConnections, validateConnections, type Connection } from '../vmf/io.ts';
import { h } from './dom.ts';

/** Outputs table (editable) and the list of connections that fire into this entity. */
export function ioSection(editor: Editor, e: MapEntity): HTMLElement {
  const list = getConnections(e);
  const cls = fgdClass(e.classname);
  const byName = entitiesByName(editor.doc);
  const problems = validateConnections(editor.doc).filter((p) => p.entity === e);
  const names = [...byName.keys()].sort();
  const datalist = h('datalist', { id: `targets-${e.id}` }, ...names.map((n) => h('option', { value: n })),
    ...['!self', '!activator', '!caller', '!player'].map((n) => h('option', { value: n })));

  const commit = (label: string, next: Connection[]) => {
    const end = editor.history.begin(label, [], [e]);
    setConnections(e, next);
    end();
    editor.changed();
  };

  const rows = list.map((c, i) => {
    const update = (patch: Partial<Connection>) => commit('Edit output', list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const outSel = h('select', { title: 'Output (event on this entity)' }) as HTMLSelectElement;
    const outputs = cls?.outputs.map((o) => o.name) ?? [];
    for (const o of outputs.includes(c.output) ? outputs : [c.output, ...outputs]) outSel.append(h('option', { value: o }, o));
    outSel.value = c.output;
    outSel.addEventListener('change', () => update({ output: outSel.value }));

    const target = h('input', { value: c.target, placeholder: 'target', title: 'Target entity name' }) as HTMLInputElement;
    target.setAttribute('list', datalist.id);
    target.addEventListener('change', () => update({ target: target.value.trim() }));

    const inSel = h('select', { title: 'Input on the target' }) as HTMLSelectElement;
    const t = resolveTarget(byName, c.target);
    const tcls = Array.isArray(t) && t.length ? fgdClass(t[0].classname) : undefined;
    const inputs = tcls?.inputs.map((x) => x.name) ?? [];
    for (const n of inputs.includes(c.input) || !c.input ? inputs : [c.input, ...inputs]) inSel.append(h('option', { value: n }, n));
    if (!inputs.length && !c.input) inSel.append(h('option', { value: '' }, '—'));
    inSel.value = c.input;
    inSel.addEventListener('change', () => update({ input: inSel.value }));

    const param = h('input', { value: c.param, placeholder: 'param', title: 'Parameter override' }) as HTMLInputElement;
    param.addEventListener('change', () => update({ param: param.value }));
    const delay = h('input', { type: 'number', value: String(c.delay), step: '0.1', min: '0', title: 'Delay (seconds)' }) as HTMLInputElement;
    delay.addEventListener('change', () => update({ delay: Math.max(0, parseFloat(delay.value) || 0) }));
    const once = h('input', { type: 'checkbox', checked: c.times === 1, title: 'Fire only once' }) as HTMLInputElement;
    once.addEventListener('change', () => update({ times: once.checked ? 1 : -1 }));
    const del = h('button', { title: 'Remove', onclick: () => commit('Remove output', list.filter((_, j) => j !== i)) }, '✕');
    const bad = problems.find((p) => p.index === i);
    return h((bad ? 'div.io-row.bad' : 'div.io-row') as 'div', { title: bad?.message ?? '' },
      h('div.io-line', {}, outSel, h('span.muted', {}, '→'), target),
      h('div.io-line', {}, inSel, param),
      h('div.io-line', {}, h('label', {}, 'delay'), delay, h('label', {}, 'once'), once, del),
      bad ? h('div.io-error', {}, bad.message) : null);
  });

  const add = () => {
    const first = cls?.outputs[0]?.name ?? 'OnTrigger';
    commit('Add output', [...list, { output: first, target: '', input: '', param: '', delay: 0, times: -1 }]);
  };

  const incoming = incomingConnections(editor.doc, e);
  return h('div.section', {},
    h('h3', {}, `Outputs (${list.length})`),
    datalist,
    ...rows,
    h('button', { onclick: add }, '+ Add output'),
    incoming.length ? h('h3', { style: { marginTop: '10px' } }, `Fired by (${incoming.length})`) : null,
    ...incoming.slice(0, 30).map(({ from, c }) => h('div.io-in', { onclick: () => editor.selection.set([], [from]) },
      h('b', {}, from.get('targetname') ?? from.classname), ` ${c.output} → ${c.input}${c.param ? `(${c.param})` : ''}${c.delay ? ` +${c.delay}s` : ''}`)),
  );
}
