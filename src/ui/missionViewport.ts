import { Box3, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { CONDITIONS, describeCondition, newId, stageById, type Condition, type Stage, type Transition } from '../lw/mission.ts';
import { addNextStage, canCapture, canDestroy, conditionLoci, nameFor, playOrder, setVictory, type OrderedStage } from '../lw/missionView.ts';
import { missionChanged } from '../lw/missionAction.ts';
import { pickArea } from '../edit/areaPick.ts';
import { pickEntity } from '../edit/entityPick.ts';
import { isTyping } from '../render/cameraControls.ts';
import { MissionMarkers, frameBoxFor, type MarkerStage } from '../render/missionMarkers.ts';
import { h, toast } from './dom.ts';

const END_LABEL: Record<string, string> = { victory: '🏆 Victory', defeat: '💀 Defeat' };
type QuickKind = 'reach' | 'destroy' | 'capture';
const QUICK: Record<QuickKind, string> = { reach: '📍 reach an area', destroy: '💥 destroy a target', capture: '⚑ capture a point' };

export interface MissionViewportHooks {
  /** Opens the full flowchart. */
  openFlow(): void;
}

/**
 * The Objectives panel in the viewport (M): the mission's stages in play order, stepped through with
 * PageUp / PageDown. The current stage's conditions are framed and drawn in 3D and can be retargeted from
 * the view (draw a new area, click a new target); "+ Next objective here" adds a stage after it. Edits go to
 * `editor.mission`, the same graph the flow designer shows.
 */
export function mountMissionViewport(editor: Editor, viewport: HTMLElement, hooks: MissionViewportHooks) {
  const box = h('div.overlay.br.mission-vp', { hidden: true });
  viewport.append(box);
  const markers = new MissionMarkers(editor);
  // Labels keep clear of the panel; its rect is read when it resizes, not every frame.
  const canvas = editor.renderer.domElement;
  const panelRect = () => {
    const p = box.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    markers.avoid = box.hidden || !p.width ? [] : [{ x0: p.left - c.left, y0: p.top - c.top, x1: p.right - c.left, y1: p.bottom - c.top }];
    markers.relayout();
  };
  const watch = new ResizeObserver(panelRect);
  watch.observe(box);
  watch.observe(canvas);
  /** The stage being looked at, by id so edits that reorder the list keep it. */
  let currentId: string | null = null;
  let busy = '';
  let quick: QuickKind = 'reach';

  const order = (): OrderedStage[] => (editor.mission ? playOrder(editor.mission) : []);
  const index = (list: OrderedStage[]) => Math.max(0, list.findIndex((o) => o.stage.id === currentId));
  const changed = () => missionChanged(editor);
  const titleOf = (id: string) => END_LABEL[id] ?? (editor.mission && stageById(editor.mission, id)?.title) ?? id;

  const lociOf = (s: Stage) => s.transitions.flatMap((t) => conditionLoci(t.condition, editor.doc.entities).map((locus) => ({ locus, defeat: t.to === 'defeat' })));

  const draw = (list: OrderedStage[]) => {
    if (box.hidden || !list.length) { markers.hide(); return; }
    const cur = index(list);
    const stages: MarkerStage[] = list.map((o, i) => ({ n: i + 1, title: o.stage.title, loci: lociOf(o.stage) }));
    markers.show(stages, cur + 1);
  };

  /**
   * Looks down on a box from the south, steeply as the game's camera does so walls hide less, with the box
   * left of centre to stay clear of the panel. The top view just frames it.
   */
  const look = (b: Box3) => {
    if (editor.view === 'top') { editor.frameBox(b); return; }
    const c = b.getCenter(new Vector3()).setZ(b.min.z), s = b.getSize(new Vector3());
    const r = Math.max(s.x, s.y) * 0.7 + 200;
    const target = c.clone().add(new Vector3(0.93, -0.36, 0).multiplyScalar(r * 0.3));
    editor.setView(new Vector3(target.x - r * 0.25, target.y - r * 0.65, c.z + r * 1.1), target);
  };

  /** Frames the camera on where the current stage's conditions happen. */
  const locate = (quiet = false) => {
    const list = order();
    const s = list[index(list)]?.stage;
    if (!s) return;
    const forwardLoci = s.transitions.filter((t) => t.to !== 'defeat').flatMap((t) => conditionLoci(t.condition, editor.doc.entities));
    const all = lociOf(s).map((l) => l.locus);
    const b = frameBoxFor(editor, forwardLoci.some((l) => l.kind !== 'none') ? forwardLoci : all);
    if (b) look(b);
    else if (!quiet) toast(editor.container, `No location: ${(all.find((l) => l.kind === 'none') as { hint: string } | undefined)?.hint ?? 'nothing to show'}`, 2500);
  };

  const go = (i: number) => {
    const list = order();
    if (!list.length) return;
    currentId = list[Math.max(0, Math.min(list.length - 1, i))].stage.id;
    render();
    locate(true);
  };
  const step = (d: number) => go(index(order()) + d);

  /** Runs a pick from the view with the panel showing what is expected. */
  const picking = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    busy = label;
    render();
    try { return await fn(); } finally { busy = ''; render(); }
  };

  /** A clicked target's name, naming it first (one undo step) when it has none. */
  const targetName = (e: MapEntity): string => {
    if (e.classname === 'trigger_capture_area') {
      const cp = editor.doc.entities.find((x) => x.classname === 'control_point' && x.get('targetname') === e.get('control_point'));
      if (cp) e = cp;
    }
    const have = e.get('targetname');
    if (have) return have;
    const name = nameFor(e, editor.doc.entities.map((x) => x.get('targetname') ?? '').filter(Boolean));
    const end = editor.history.begin('Name mission target', [], [e]);
    e.set('targetname', name);
    end();
    editor.changed();
    toast(editor.container, `Named the ${e.classname} “${name}”`, 2500);
    return name;
  };

  const pickTarget = (kind: 'destroy' | 'lost' | 'capture') => kind === 'capture'
    ? picking('Click a capture point', () => pickEntity(editor, (e) => canCapture(e.classname), 'a capture point'))
    : picking('Click a unit, unit maker or breakable object', () => pickEntity(editor, (e) => canDestroy(e.classname), 'a unit, unit maker or breakable object'));

  const redrawArea = async (c: Extract<Condition, { kind: 'reach' }>) => {
    const a = await picking('Drag a box over the new area', () => pickArea(editor));
    if (!a) return;
    c.area = [a[0], a[1], a[2], a[3]];
    c.z = a[4];
    changed();
    locate(true);
  };
  const retarget = async (c: Extract<Condition, { kind: 'destroy' | 'lost' | 'capture' }>) => {
    const e = await pickTarget(c.kind);
    if (!e) return;
    c.target = targetName(e);
    changed();
    locate(true);
  };

  /** "+ Next objective here": picks the place, then adds a stage after the current one that ends there. */
  const addNext = async (after: Stage) => {
    const g = editor.mission!;
    let cond: Condition, objective: string, title: string;
    if (quick === 'reach') {
      const a = await picking('Drag a box where the next objective is', () => pickArea(editor));
      if (!a) return;
      cond = { kind: 'reach', area: [a[0], a[1], a[2], a[3]], z: a[4], owner: '2' };
      objective = 'Reach the marked area';
      title = 'Reach the area';
    } else {
      const e = await pickTarget(quick);
      if (!e) return;
      const name = targetName(e);
      cond = quick === 'capture' ? { kind: 'capture', target: name, owner: '2' } : { kind: 'destroy', target: name };
      objective = `${quick === 'capture' ? 'Capture' : 'Destroy'} ${name}`;
      title = objective;
    }
    const s = addNextStage(g, after, cond, objective, title);
    currentId = s.id;
    changed();
    locate(true);
    toast(editor.container, `Added “${title}” after “${after.title}”`, 2500);
  };

  const conditionRow = (c: Condition, t: Transition): HTMLElement[] => {
    const loci = conditionLoci(c, editor.doc.entities);
    const hint = loci.find((l) => l.kind === 'none') as { hint: string } | undefined;
    const based = loci.find((l) => l.kind === 'entities' && l.base);
    const btns: HTMLElement[] = [];
    if (c.kind === 'reach') btns.push(h('button', { disabled: !!busy, onclick: () => void redrawArea(c) }, c.area ? '▭ Redraw area' : '▭ Draw area'));
    if (c.kind === 'destroy' || c.kind === 'lost' || c.kind === 'capture') btns.push(h('button', { disabled: !!busy, onclick: () => void retarget(c) }, '⌖ Pick target'));
    const rows: (HTMLElement | null)[] = [
      h('div', {}, `${CONDITIONS[c.kind].icon} ${describeCondition(c)}`, t.condition === c ? h('span.to', {}, ` → ${titleOf(t.to)}`) : null),
      hint && c.kind !== 'all' ? h('div.hint', {}, hint.hint) : null,
      based ? h('div.hint', {}, 'Shown at the base: anywhere counts') : null,
      btns.length ? h('div.row', {}, ...btns) : null,
    ];
    return rows.filter((x): x is HTMLElement => !!x);
  };

  const render = () => {
    if (box.hidden) return;
    const g = editor.mission;
    const list = order();
    const head = (count: string | null, ...extra: HTMLElement[]) => h('div.mvp-head', {},
      h('b', {}, '🎯 Objectives'), count ? h('span.hint', {}, count) : null, ...extra,
      h('button', { title: 'Close (M)', onclick: () => toggle(false) }, '✕'));
    if (!g || !list.length) {
      box.replaceChildren(head(null), h('p.hint', {}, 'This map has no mission flow yet.'), h('button.primary', { onclick: hooks.openFlow }, '◇ Create mission flow'));
      markers.hide();
      return;
    }
    const i = index(list);
    currentId = list[i].stage.id;
    const s = list[i].stage;
    const items = list.map((o, k) => h(`div.mvp-item${k === i ? '.current' : ''}${o.main ? '' : '.branch'}${o.reachable ? '' : '.unreachable'}` as 'div', {
      title: o.reachable ? (o.main ? 'On the main line' : 'A branch') : 'Nothing leads here',
      onclick: () => go(k),
    }, h('span.n', {}, String(k + 1)), h('span', {}, o.stage.title || '(untitled)'), h('span.hint', {}, o.stage.objectives[0]?.text ?? '')));
    const listEl = h('div.mvp-list', {}, ...items);

    const title = h('input.mvp-title', { value: s.title, title: 'Stage title' }) as HTMLInputElement;
    title.addEventListener('change', () => { s.title = title.value; changed(); });
    const objectives = s.objectives.map((o, k) => {
      const input = h('input', { value: o.text, placeholder: 'Objective text' }) as HTMLInputElement;
      input.addEventListener('change', () => { o.text = input.value; changed(); });
      return h('div.mvp-obj', {}, h('span', {}, '🎯'), input, h('button', { title: 'Remove', onclick: () => { s.objectives.splice(k, 1); changed(); } }, '×'));
    });
    const transitions = s.transitions.map((t) => h(`div.mvp-tr${t.to === 'victory' ? '.win' : t.to === 'defeat' ? '.lose' : ''}` as 'div', {},
      ...(t.condition.kind === 'all'
        ? [h('div', {}, `${CONDITIONS.all.icon} all of these`, h('span.to', {}, ` → ${titleOf(t.to)}`)), ...t.condition.conditions.map((x) => h('div.mvp-part', {}, ...conditionRow(x, t)))]
        : conditionRow(t.condition, t))));

    const kind = h('select', { title: 'What the next objective is' }, ...Object.entries(QUICK).map(([k, v]) => h('option', { value: k }, v))) as HTMLSelectElement;
    kind.value = quick;
    kind.addEventListener('change', () => { quick = kind.value as QuickKind; kind.blur(); });
    const fw = s.transitions.filter((t) => t.to !== 'defeat');
    const isEnd = fw.length > 0 && fw.every((t) => t.to === 'victory');

    box.replaceChildren(
      head(`${i + 1} / ${list.length}`,
        h('button', { title: 'Previous objective (PageUp)', disabled: i === 0, onclick: () => step(-1) }, '◀'),
        h('button', { title: 'Next objective (PageDown)', disabled: i === list.length - 1, onclick: () => step(1) }, '▶')),
      listEl,
      h('div.mvp-stage', {}, s.id === g.start ? h('span.mf-start', {}, 'START') : null, title,
        h('button', { title: 'Frame the camera on it', onclick: () => locate() }, '⌖')),
      ...objectives,
      h('button.mvp-small', { onclick: () => { s.objectives.push({ id: newId('o'), text: 'New objective' }); changed(); } }, '+ Objective'),
      ...(transitions.length ? transitions : [h('p.hint', {}, 'No transitions: this stage never ends.')]),
      ...(busy ? [h('div.mvp-busy', {}, `${busy} in the viewport · Esc cancels`)] : []),
      h('div.mvp-add', {},
        h('div.row', {}, kind, h('button.primary', { disabled: !!busy, title: 'Add a stage after this one that ends when this happens', onclick: () => void addNext(s) }, '+ Next objective here')),
        h('div.row', {},
          h('button', { disabled: isEnd || !!busy, title: 'This stage ends the mission: its way forward goes to Victory', onclick: () => { setVictory(s); changed(); } }, isEnd ? '🏆 Ends in victory' : '🏆 Set as victory'),
          h('button', { onclick: hooks.openFlow }, '◇ Flow'))),
      h('div.hint', {}, 'PageUp / PageDown step · M hides'),
    );
    listEl.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
    for (const input of box.querySelectorAll('input')) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    draw(list);
  };

  const toggle = (show = box.hidden) => {
    box.hidden = !show;
    if (show) { render(); locate(true); } else markers.hide();
    editor.emit('missionview');
  };

  editor.on('document', () => { currentId = null; });
  for (const ev of ['mission', 'document']) editor.on(ev, render);
  // Entity edits can move or rename targets.
  editor.on('change', () => { if (!box.hidden) draw(order()); });

  window.addEventListener('keydown', (e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-backdrop:not([hidden])')) return;
    if (e.key === 'm' || e.key === 'M') { toggle(); e.preventDefault(); }
    else if (!box.hidden && !busy && (e.key === 'PageUp' || e.key === 'PageDown')) { step(e.key === 'PageUp' ? -1 : 1); e.preventDefault(); }
  });

  return {
    el: box,
    get open() { return !box.hidden; },
    toggle,
    go,
    locate,
  };
}
