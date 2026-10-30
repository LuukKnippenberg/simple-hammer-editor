import type { Editor } from '../editor.ts';
import { OWNERS } from '../lw/kits.ts';
import {
  CONDITIONS, END_NODES, defaultCondition, describeCondition, emptyMission, newId, stageById,
  type Condition, type ConditionKind, type MissionGraph, type Stage, type Transition,
} from '../lw/mission.ts';
import { h } from './dom.ts';

const NODE_W = 240;
const END_LABEL: Record<string, string> = { victory: '🏆 Victory', defeat: '💀 Defeat' };

export interface MissionFlowHooks {
  /** Phase 7: draw a reach area in the viewport; resolves with the box, or null when cancelled. */
  pickArea?: () => Promise<[number, number, number, number, number] | null>;
  /** Phase 7: build the graph into entities. */
  build?: () => void;
  /** Phase 8: check the graph and the map. */
  check?: () => { severity: 'error' | 'warning'; text: string; stage?: string }[];
}

/**
 * The mission flowchart: stages as cards on a pannable canvas, transitions as arrows to the next stage or
 * to Victory / Defeat. Drag cards to arrange them, drag a transition's handle onto a card to send it there.
 * The side panel edits the selected stage: its messages, objectives and transitions with their conditions.
 */
export function mountMissionFlow(editor: Editor, hooks: MissionFlowHooks = {}): { open(): void; close(): void; dialog: HTMLElement } {
  const backdrop = h('div.modal-backdrop', { hidden: true });
  const dialog = h('div.modal.graph.mission-flow');
  backdrop.append(dialog);
  document.body.append(backdrop);

  const canvas = h('div.mf-canvas');
  const plane = h('div.mf-plane');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('mf-edges');
  plane.append(svg);
  canvas.append(plane);
  const side = h('div.mf-side');
  const status = h('span.hint');
  let selected: string | null = null;
  let pan = { x: 40, y: 40 };
  let zoom = 1;
  const applyView = () => (plane.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`);
  let issues: ReturnType<NonNullable<MissionFlowHooks['check']>> = [];

  const graph = (): MissionGraph => (editor.mission ??= emptyMission());
  const changed = () => {
    editor.dirty = true;
    editor.emit('mission');
    render();
  };
  const endPos = (id: string) => {
    const g = graph();
    const maxX = Math.max(0, ...g.stages.map((s) => s.x));
    const ys = g.stages.map((s) => s.y);
    const mid = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 120;
    return { x: maxX + NODE_W + 120, y: id === 'victory' ? mid - 60 : mid + 100 };
  };

  // --- Canvas -------------------------------------------------------------------------------------------
  const nodeEls = new Map<string, HTMLElement>();
  const handleEls = new Map<string, HTMLElement>();

  const drawEdges = () => {
    const g = graph();
    const prect = plane.getBoundingClientRect();
    const paths: string[] = [];
    for (const s of g.stages) {
      for (const t of s.transitions) {
        const hEl = handleEls.get(t.id), target = nodeEls.get(t.to);
        if (!hEl || !target) continue;
        const a = hEl.getBoundingClientRect(), b = target.getBoundingClientRect();
        const x1 = (a.left + a.width / 2 - prect.left) / zoom, y1 = (a.top + a.height / 2 - prect.top) / zoom;
        const x2 = (b.left - prect.left) / zoom, y2 = (b.top - prect.top) / zoom + 22;
        const dx = Math.max(60, Math.abs(x2 - x1) / 2);
        const cls = t.to === 'victory' ? 'win' : t.to === 'defeat' ? 'lose' : '';
        paths.push(`<path class="${cls}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/><circle class="${cls}" cx="${x2}" cy="${y2}" r="4"/>`);
      }
    }
    svg.innerHTML = paths.join('');
  };

  const dragNode = (el: HTMLElement, s: Stage) => {
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.mf-handle, button, input, textarea, select')) return;
      e.stopPropagation();
      e.preventDefault();
      selected = s.id;
      const start = { x: e.clientX, y: e.clientY, sx: s.x, sy: s.y };
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 3) return;
        s.x = Math.round((start.sx + (ev.clientX - start.x) / zoom) / 8) * 8;
        s.y = Math.round((start.sy + (ev.clientY - start.y) / zoom) / 8) * 8;
        el.style.left = `${s.x}px`;
        el.style.top = `${s.y}px`;
        moved = true;
        drawEdges();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) changed(); else render();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  };

  /** Drag a transition's handle onto a card to send the transition there. */
  const dragHandle = (handle: HTMLElement, t: Transition) => {
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const prect = plane.getBoundingClientRect();
      const a = handle.getBoundingClientRect();
      const x1 = (a.left + a.width / 2 - prect.left) / zoom, y1 = (a.top + a.height / 2 - prect.top) / zoom;
      const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      ghost.setAttribute('class', 'ghost');
      svg.append(ghost);
      const move = (ev: PointerEvent) => ghost.setAttribute('d', `M${x1},${y1} L${(ev.clientX - prect.left) / zoom},${(ev.clientY - prect.top) / zoom}`);
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        ghost.remove();
        const node = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.mf-node') as HTMLElement | null;
        if (node?.dataset.id && node.dataset.id !== t.id) {
          t.to = node.dataset.id;
          changed();
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas && e.target !== plane && e.target !== svg) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    const move = (ev: PointerEvent) => {
      pan = { x: start.px + ev.clientX - start.x, y: start.py + ev.clientY - start.y };
      applyView();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  // Wheel zooms around the cursor.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const next = Math.max(0.3, Math.min(1.6, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    pan = { x: mx - ((mx - pan.x) * next) / zoom, y: my - ((my - pan.y) * next) / zoom };
    zoom = next;
    applyView();
  }, { passive: false });

  /** Zooms and pans so every card fits. */
  const fit = () => {
    const els = [...nodeEls.values()];
    if (!els.length) return;
    const xs = els.map((el) => el.offsetLeft), ys = els.map((el) => el.offsetTop);
    const x2 = els.map((el) => el.offsetLeft + el.offsetWidth), y2 = els.map((el) => el.offsetTop + el.offsetHeight);
    const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...x2) - minX, hh = Math.max(...y2) - minY;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    zoom = Math.max(0.3, Math.min(1.2, (cw - 60) / w, (ch - 60) / hh));
    pan = { x: (cw - w * zoom) / 2 - minX * zoom, y: (ch - hh * zoom) / 2 - minY * zoom };
    applyView();
    drawEdges();
  };

  const renderCanvas = () => {
    const g = graph();
    for (const el of nodeEls.values()) el.remove();
    nodeEls.clear();
    handleEls.clear();
    const issueFor = (id: string) => issues.filter((i) => i.stage === id);
    for (const s of g.stages) {
      const bad = issueFor(s.id);
      const el = h(`div.mf-node${s.id === selected ? '.selected' : ''}${bad.some((i) => i.severity === 'error') ? '.error' : bad.length ? '.warn' : ''}` as 'div', {
        style: { left: `${s.x}px`, top: `${s.y}px`, width: `${NODE_W}px` },
        title: bad.map((i) => i.text).join('\n'),
      });
      el.dataset.id = s.id;
      el.append(h('div.mf-title', {}, s.id === g.start ? h('span.mf-start', {}, 'START') : null, s.title || '(untitled)'));
      if (s.messages.length) el.append(h('div.mf-msg', { title: s.messages.join('\n\n') }, `💬 ${s.messages[0].slice(0, 70)}${s.messages[0].length > 70 ? '…' : ''}${s.messages.length > 1 ? ` (+${s.messages.length - 1})` : ''}`));
      for (const o of s.objectives) el.append(h('div.mf-obj', {}, `🎯 ${o.text}`));
      for (const t of s.transitions) {
        const handle = h('span.mf-handle', { title: 'Drag onto a stage to send this transition there' });
        handleEls.set(t.id, handle);
        dragHandle(handle, t);
        el.append(h(`div.mf-tr${t.to === 'victory' ? '.win' : t.to === 'defeat' ? '.lose' : ''}` as 'div', {}, h('span', {}, `${CONDITIONS[t.condition.kind].icon} ${describeCondition(t.condition)}`), handle));
      }
      dragNode(el, s);
      nodeEls.set(s.id, el);
      plane.append(el);
    }
    for (const id of END_NODES) {
      const p = endPos(id);
      const el = h(`div.mf-node.mf-end.${id}` as 'div', { style: { left: `${p.x}px`, top: `${p.y}px` } }, h('div.mf-title', {}, END_LABEL[id]));
      el.dataset.id = id;
      nodeEls.set(id, el);
      plane.append(el);
    }
    applyView();
    requestAnimationFrame(drawEdges);
  };

  // --- Side panel ---------------------------------------------------------------------------------------
  const ownerSelect = (value: string, set: (v: string) => void) => {
    const sel = h('select', {}, ...OWNERS.slice(0, 6).map((o) => h('option', { value: o.value }, o.label))) as HTMLSelectElement;
    sel.value = value;
    sel.addEventListener('change', () => set(sel.value));
    return sel;
  };
  const names = () => {
    const out = new Map<string, number>();
    for (const e of editor.doc.entities) {
      const n = e.get('targetname');
      if (n && !n.startsWith('mf_')) out.set(n, (out.get(n) ?? 0) + 1);
    }
    return out;
  };
  const targetInput = (value: string, set: (v: string) => void, filter?: (cls: string) => boolean) => {
    const list = h('datalist', { id: newId('dl') });
    const counts = names();
    for (const [n, c] of [...counts].sort()) {
      const cls = editor.doc.entities.find((e) => e.get('targetname') === n)?.classname ?? '';
      if (!filter || filter(cls)) list.append(h('option', { value: n }, `${cls}${c > 1 ? ` ×${c}` : ''}`));
    }
    const input = h('input', { value, list: list.id, placeholder: 'targetname' }) as HTMLInputElement;
    input.addEventListener('change', () => set(input.value.trim()));
    return h('span.mf-target', {}, input, list);
  };

  const conditionForm = (t: Transition): HTMLElement[] => {
    const c = t.condition;
    const set = (patch: Partial<Condition>) => { Object.assign(c, patch); changed(); };
    const row = (label: string, ...els: (HTMLElement | string | null)[]) => h('div.row', {}, h('label', {}, label), ...els);
    const num = (value: number, min: number, onSet: (v: number) => void) => {
      const i = h('input', { type: 'number', value: String(value), min: String(min) }) as HTMLInputElement;
      i.addEventListener('change', () => onSet(Math.max(min, Number(i.value) || min)));
      return i;
    };
    switch (c.kind) {
      case 'reach': return [
        row('Who', ownerSelect(c.owner, (v) => set({ owner: v }))),
        row('Area', h('span.hint', {}, c.area ? `${c.area[2] - c.area[0]} × ${c.area[3] - c.area[1]} at ${Math.round((c.area[0] + c.area[2]) / 2)}, ${Math.round((c.area[1] + c.area[3]) / 2)}` : 'none'),
          hooks.pickArea ? h('button', { onclick: async () => { const a = await hooks.pickArea!(); if (a) set({ area: [a[0], a[1], a[2], a[3]], z: a[4] }); } }, c.area ? 'Redraw' : 'Draw in viewport') : null),
      ];
      case 'destroy': case 'lost': return [row('Target', targetInput(c.target, (v) => set({ target: v })))];
      case 'capture': return [
        row('Point', targetInput(c.target, (v) => set({ target: v }), (cls) => cls === 'control_point')),
        row('By', ownerSelect(c.owner, (v) => set({ owner: v }))),
      ];
      case 'destroy_faction': return [row('Player', ownerSelect(c.owner, (v) => set({ owner: v })))];
      case 'troops': {
        const cmp = h('select', {}, h('option', { value: 'atleast' }, 'at least'), h('option', { value: 'atmost' }, 'at most')) as HTMLSelectElement;
        cmp.value = c.compare;
        cmp.addEventListener('change', () => set({ compare: cmp.value as 'atleast' | 'atmost' }));
        return [row('Player', ownerSelect(c.owner, (v) => set({ owner: v }))), row('Population', cmp, num(c.count, 0, (v) => set({ count: v })))];
      }
      case 'survive': return [row('Seconds', num(c.seconds, 1, (v) => set({ seconds: v })))];
      case 'resources': return [row('Player', ownerSelect(c.owner, (v) => set({ owner: v }))), row('Amount', num(c.amount, 0, (v) => set({ amount: v })))];
    }
  };

  const renderSide = () => {
    const g = graph();
    const s = selected ? stageById(g, selected) : undefined;
    if (!s) {
      side.replaceChildren(
        h('h3', {}, 'Mission flow'),
        h('p.hint', {}, 'Each card is a stage of the mission. When a stage starts it shows its messages and objectives; its transitions wait for their condition and lead to the next stage, to Victory or to Defeat.'),
        h('p.hint', {}, 'Click a card to edit it. Drag cards to arrange them, drag the background to pan, drag a transition\'s dot onto a card to connect it.'),
        h('p.hint', {}, `${g.stages.length} stage${g.stages.length === 1 ? '' : 's'}, ${g.stages.reduce((n, x) => n + x.transitions.length, 0)} transitions.`),
      );
      return;
    }
    const title = h('input', { value: s.title }) as HTMLInputElement;
    title.addEventListener('change', () => { s.title = title.value; changed(); });
    const messages = s.messages.map((m, i) => {
      const ta = h('textarea', { rows: 3 }) as HTMLTextAreaElement;
      ta.value = m;
      ta.addEventListener('change', () => { s.messages[i] = ta.value; changed(); });
      return h('div.mf-item', {}, ta, h('button', { title: 'Remove', onclick: () => { s.messages.splice(i, 1); changed(); } }, '×'));
    });
    const objectives = s.objectives.map((o, i) => {
      const input = h('input', { value: o.text }) as HTMLInputElement;
      input.addEventListener('change', () => { o.text = input.value; changed(); });
      return h('div.mf-item', {}, input, h('button', { title: 'Remove', onclick: () => { s.objectives.splice(i, 1); changed(); } }, '×'));
    });
    const targets = [...g.stages.filter((x) => x.id !== s.id).map((x) => [x.id, x.title] as const), ['victory', END_LABEL.victory] as const, ['defeat', END_LABEL.defeat] as const];
    const transitions = s.transitions.map((t, i) => {
      const kind = h('select', {}, ...Object.entries(CONDITIONS).map(([k, c]) => h('option', { value: k }, `${c.icon} ${c.label}`))) as HTMLSelectElement;
      kind.value = t.condition.kind;
      kind.addEventListener('change', () => { t.condition = defaultCondition(kind.value as ConditionKind); changed(); });
      const to = h('select', {}, ...targets.map(([id, label]) => h('option', { value: id }, label))) as HTMLSelectElement;
      to.value = t.to;
      to.addEventListener('change', () => { t.to = to.value; if (to.value === 'defeat') t.completes = false; changed(); });
      const done = h('input', { type: 'checkbox', checked: t.completes }) as HTMLInputElement;
      done.addEventListener('change', () => { t.completes = done.checked; changed(); });
      return h('div.mf-transition', {},
        h('div.row', {}, kind, h('button', { title: 'Remove', onclick: () => { s.transitions.splice(i, 1); changed(); } }, '×')),
        h('div.hint', {}, CONDITIONS[t.condition.kind].hint),
        ...conditionForm(t),
        h('div.row', {}, h('label', {}, 'Then go to'), to),
        h('div.row', {}, h('label', {}, 'Objectives'), done, h('span.hint', {}, t.completes ? 'completed' : 'failed')));
    });
    side.replaceChildren(
      h('h3', {}, 'Stage'),
      h('div.row', {}, h('label', {}, 'Title'), title),
      h('div.row', {},
        h('button', { disabled: g.start === s.id, onclick: () => { g.start = s.id; changed(); } }, g.start === s.id ? 'Start stage' : 'Make start'),
        h('button', { onclick: () => { g.stages = g.stages.filter((x) => x !== s); for (const x of g.stages) x.transitions = x.transitions.filter((t) => t.to !== s.id); if (g.start === s.id) g.start = g.stages[0]?.id ?? ''; selected = null; changed(); } }, 'Delete stage')),
      h('h3', {}, 'Messages', h('span.hint', {}, ' shown when the stage starts')),
      ...messages,
      h('button', { onclick: () => { s.messages.push(''); changed(); } }, '+ Message'),
      h('h3', {}, 'Objectives', h('span.hint', {}, ' shown while the stage runs')),
      ...objectives,
      h('button', { onclick: () => { s.objectives.push({ id: newId('o'), text: 'New objective' }); changed(); } }, '+ Objective'),
      h('h3', {}, 'Transitions', h('span.hint', {}, ' the first condition met wins')),
      ...transitions,
      h('button', { onclick: () => { s.transitions.push({ id: newId('t'), condition: defaultCondition('reach'), to: 'victory', completes: true }); changed(); } }, '+ Transition'),
    );
  };

  const render = () => {
    renderCanvas();
    renderSide();
    const g = graph();
    status.textContent = `${g.stages.length} stages · ${issues.filter((i) => i.severity === 'error').length} errors · ${issues.filter((i) => i.severity === 'warning').length} warnings`;
  };

  const addStage = () => {
    const g = graph();
    const last = g.stages[g.stages.length - 1];
    const s: Stage = { id: newId('s'), title: `Stage ${g.stages.length + 1}`, x: (last?.x ?? 0) + NODE_W + 80, y: last?.y ?? 120, messages: [], objectives: [], transitions: [] };
    g.stages.push(s);
    if (!g.start) g.start = s.id;
    selected = s.id;
    changed();
  };

  const close = () => { backdrop.hidden = true; };
  dialog.append(
    h('div.modal-head', {},
      h('b', {}, 'Mission flow'),
      status,
      h('button', { onclick: addStage }, '+ Stage'),
      h('button', { title: 'Fit the whole flowchart in view', onclick: () => fit() }, '\u2922 Fit'),
      hooks.check ? h('button', { onclick: () => { issues = hooks.check!(); render(); } }, '✓ Check') : null,
      hooks.build ? h('button.primary', { onclick: () => { hooks.build!(); issues = hooks.check?.() ?? []; render(); } }, '⚙ Build into map') : null,
      h('button', { onclick: close }, '✕')),
    h('div.mf-body', {}, canvas, side),
  );
  editor.on('document', () => { selected = null; issues = []; });

  return {
    dialog,
    open() {
      graph();
      backdrop.hidden = false;
      issues = hooks.check?.() ?? [];
      render();
      requestAnimationFrame(fit);
    },
    close,
  };
}
