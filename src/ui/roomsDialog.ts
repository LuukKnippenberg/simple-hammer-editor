import { Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity, MapSolid } from '../vmf/map.ts';
import { solidBounds } from '../edit/brushes.ts';
import { h, toast } from './dom.ts';
import { roomLayout, type RoomBuildingSpec, type RoomSpec, type Side, type StreetDoor } from '../gen/rooms/model.ts';
import { ROOM_TYPES, roomType, type LinkKind } from '../gen/rooms/types.ts';
import { ROOM_PRESETS, presetSpec } from '../gen/rooms/presets.ts';
import { roomsOf } from '../gen/rooms/store.ts';
import { applyRooms, newRoomsUid, regenerateRooms, selectRooms } from '../gen/rooms/action.ts';

/**
 * Interior building dialog: a floor plan on a grid of 128-unit cells. Drag rooms onto it, give each a type, click
 * outer walls for street doors, choose how neighbouring rooms meet, then build (or rebuild) the building. The plan
 * shows walls, doorways, archways and window bands as they will be built, and what is wrong with it.
 */

type Mode = 'rooms' | 'doors' | 'erase';

/** What the dialog builds for: an existing building, a block brush to replace, or a new one in front of the camera. */
export interface RoomsTarget { detail?: MapEntity | null; brush?: MapSolid | null }

let mounted: { open(t: RoomsTarget): void } | null = null;

/** Opens the dialog (mounting it the first time). */
export function openRoomsDialog(editor: Editor, target: RoomsTarget = {}): void {
  mounted ??= mountRoomsDialog(editor);
  mounted.open(target);
}

const clone = (s: RoomBuildingSpec): RoomBuildingSpec => JSON.parse(JSON.stringify(s));

function mountRoomsDialog(editor: Editor): { open(t: RoomsTarget): void } {
  const backdrop = h('div.modal-backdrop', { hidden: true });
  const dialog = h('div.modal.sketch.rooms');
  backdrop.append(dialog);
  document.body.append(backdrop);
  const close = () => (backdrop.hidden = true);

  let target: RoomsTarget = {};
  let s: RoomBuildingSpec = presetSpec('station', 0, 0, 0, newRoomsUid());
  let gw = 24, gh = 24;
  let mode: Mode = 'rooms';
  let newType = 'waiting';
  let selected: string | null = null;
  const undo: string[] = [];
  const snapshot = () => { undo.push(JSON.stringify(s)); if (undo.length > 60) undo.shift(); };

  const canvas = h('canvas.sketch-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const wrap = h('div.sketch-canvas-wrap', {}, canvas);
  const side = h('div.sketch-side');
  let PX = 24;

  const roomAt = (x: number, y: number) => s.rooms.find((r) => x >= r.cells.x0 && x < r.cells.x1 && y >= r.cells.y0 && y < r.cells.y1) ?? null;
  const fit = () => {
    gw = Math.max(gw, ...s.rooms.map((r) => r.cells.x1 + 2));
    gh = Math.max(gh, ...s.rooms.map((r) => r.cells.y1 + 2));
  };

  // --- Drawing -------------------------------------------------------------------------------------------
  let drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  const draw = () => {
    const availW = wrap.clientWidth - 16, availH = wrap.clientHeight - 16;
    if (availW > 0 && availH > 0) PX = Math.max(6, Math.floor(Math.min(availW / gw, availH / gh)));
    canvas.width = gw * PX;
    canvas.height = gh * PX;
    const Y = (y: number) => (gh - y) * PX; // row 0 is south: cell y's bottom edge
    ctx.fillStyle = '#1b1e22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#2a2f35';
    ctx.lineWidth = 1;
    for (let x = 0; x <= gw; x++) { ctx.beginPath(); ctx.moveTo(x * PX + 0.5, 0); ctx.lineTo(x * PX + 0.5, canvas.height); ctx.stroke(); }
    for (let y = 0; y <= gh; y++) { ctx.beginPath(); ctx.moveTo(0, y * PX + 0.5); ctx.lineTo(canvas.width, y * PX + 0.5); ctx.stroke(); }
    for (const r of s.rooms) {
      const t = roomType(r.type), c = r.cells;
      ctx.fillStyle = t.color + (r.id === selected ? 'ff' : 'b0');
      ctx.fillRect(c.x0 * PX, Y(c.y1), (c.x1 - c.x0) * PX, (c.y1 - c.y0) * PX);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(10, Math.min(14, PX * 0.6))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cx = ((c.x0 + c.x1) / 2) * PX, cy = (Y(c.y1) + Y(c.y0)) / 2;
      ctx.fillText(r.name || t.label, cx, cy - 8);
      ctx.fillStyle = '#ffffffaa';
      ctx.fillText(`${t.label} · ${c.x1 - c.x0}×${c.y1 - c.y0}`, cx, cy + 9);
    }
    // Walls, doorways and window bands as they will be built (world units to canvas).
    const layout = roomLayout({ ...s, origin: { x: 0, y: 0, z: 0 } });
    const toX = (wx: number) => (wx / s.cell) * PX, toY = (wy: number) => Y(wy / s.cell);
    const line = (axis: 'x' | 'y', at: number, a: number, b: number, color: string, width: number, dash: number[] = []) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath();
      if (axis === 'x') { ctx.moveTo(toX(a), toY(at)); ctx.lineTo(toX(b), toY(at)); } else { ctx.moveTo(toX(at), toY(a)); ctx.lineTo(toX(at), toY(b)); }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    for (const w of layout.walls) {
      line(w.axis, w.at, w.from, w.to, '#0d0f11', Math.max(3, PX * 0.25));
      for (const o of w.openings) {
        const band = o.z0 > layout.floor - layout.base + 1;
        line(w.axis, w.at, o.from, o.to, band ? '#6fb7ff' : '#1b1e22', band ? 2 : Math.max(4, PX * 0.3));
      }
    }
    for (const d of layout.doorways) {
      const color = d.kind === 'street' ? '#ffd24a' : d.kind === 'arch' ? '#e8e8e8' : d.kind === 'open' ? '#ffffff55' : '#bfbfbf';
      line(d.axis, d.at, d.from, d.to, color, 2, d.kind === 'arch' ? [4, 3] : []);
    }
    if (selected) {
      const r = s.rooms.find((q) => q.id === selected);
      if (r) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(r.cells.x0 * PX + 1, Y(r.cells.y1) + 1, (r.cells.x1 - r.cells.x0) * PX - 2, (r.cells.y1 - r.cells.y0) * PX - 2); }
    }
    if (drag) {
      const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1) + 1, y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1) + 1;
      ctx.fillStyle = roomType(newType).color + '80';
      ctx.fillRect(x0 * PX, Y(y1), (x1 - x0) * PX, (y1 - y0) * PX);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(x0 * PX + 0.5, Y(y1) + 0.5, (x1 - x0) * PX, (y1 - y0) * PX);
      ctx.setLineDash([]);
    }
    issues.replaceChildren(...(layout.issues.length ? layout.issues.map((i) => h('div.issue', {}, '⚠ ' + i)) : [h('div.hint', {}, s.rooms.length ? '✓ Ready to build' : 'Drag on the grid to add a room')]));
  };

  // --- Mouse -----------------------------------------------------------------------------------------------
  const cellAt = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * gw, fy = gh - ((e.clientY - r.top) / r.height) * gh;
    return { x: Math.floor(fx), y: Math.floor(fy), fx: fx - Math.floor(fx), fy: fy - Math.floor(fy) };
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    const c = cellAt(e);
    if (c.x < 0 || c.y < 0 || c.x >= gw || c.y >= gh) return;
    const hit = roomAt(c.x, c.y);
    if (e.button === 2 || mode === 'erase') {
      if (hit) { snapshot(); removeRoom(hit.id); }
      return;
    }
    if (mode === 'doors') { toggleDoor(c); return; }
    if (hit) { selected = hit.id; renderSide(); draw(); return; }
    drag = { x0: c.x, y0: c.y, x1: c.x, y1: c.y };
    draw();
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const c = cellAt(e);
    drag.x1 = Math.max(0, Math.min(gw - 1, c.x));
    drag.y1 = Math.max(0, Math.min(gh - 1, c.y));
    draw();
  });
  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const cells = { x0: Math.min(d.x0, d.x1), y0: Math.min(d.y0, d.y1), x1: Math.max(d.x0, d.x1) + 1, y1: Math.max(d.y0, d.y1) + 1 };
    const clash = s.rooms.some((r) => cells.x0 < r.cells.x1 && r.cells.x0 < cells.x1 && cells.y0 < r.cells.y1 && r.cells.y0 < cells.y1);
    if (clash) { toast(editor.container, 'Rooms can\'t overlap: drag on empty cells', 1800); draw(); return; }
    if (cells.x1 - cells.x0 < 2 || cells.y1 - cells.y0 < 2) { toast(editor.container, 'A room is at least 2 × 2 cells', 1800); draw(); return; }
    snapshot();
    let n = s.rooms.length + 1;
    while (s.rooms.some((r) => r.id === `room${n}`)) n++;
    s.rooms.push({ id: `room${n}`, type: newType, cells });
    selected = `room${n}`;
    renderSide();
    draw();
  });
  window.addEventListener('keydown', (e) => {
    if (backdrop.hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undo.length) { s = JSON.parse(undo.pop()!); renderSide(); draw(); e.preventDefault(); }
    if (e.key === 'Escape') close();
  });

  function removeRoom(id: string): void {
    s.rooms = s.rooms.filter((r) => r.id !== id);
    s.links = s.links.filter((l) => l.a !== id && l.b !== id);
    s.doors = s.doors.filter((d) => roomAt(d.x, d.y));
    if (selected === id) selected = null;
    renderSide();
    draw();
  }

  /** A click near a cell's outer edge adds a door there (two cells wide where there is room), or removes it. */
  function toggleDoor(c: { x: number; y: number; fx: number; fy: number }): void {
    const room = roomAt(c.x, c.y);
    if (!room) return;
    const dist: [Side, number][] = [['w', c.fx], ['e', 1 - c.fx], ['s', c.fy], ['n', 1 - c.fy]];
    const sideOf = dist.sort((a, b) => a[1] - b[1])[0][0];
    const step: Record<Side, [number, number]> = { n: [0, 1], s: [0, -1], e: [1, 0], w: [-1, 0] };
    const out = (x: number, y: number) => roomAt(x, y) === room && !roomAt(x + step[sideOf][0], y + step[sideOf][1]);
    if (!out(c.x, c.y)) { toast(editor.container, 'Street doors go in outer walls', 1500); return; }
    snapshot();
    const along = sideOf === 'n' || sideOf === 's' ? [1, 0] : [0, 1];
    const covers = (d: StreetDoor, x: number, y: number) => d.side === sideOf && Array.from({ length: d.width }, (_, k) => [d.x + along[0] * k, d.y + along[1] * k]).some(([px, py]) => px === x && py === y);
    const existing = s.doors.find((d) => covers(d, c.x, c.y));
    if (existing) s.doors = s.doors.filter((d) => d !== existing);
    else s.doors.push({ x: c.x, y: c.y, side: sideOf, width: out(c.x + along[0], c.y + along[1]) ? 2 : 1 });
    draw();
  }

  // --- Side panel ------------------------------------------------------------------------------------------
  const issues = h('div.room-issues');
  const seg = <T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void) =>
    h('div.seg', {}, ...opts.map(([v, l]) => h((v === get() ? 'button.active' : 'button') as 'button', { onclick: () => { set(v); renderSide(); draw(); } }, l)));
  const num = (value: number, set: (v: number) => void, min: number, max: number, step = 1) => {
    const i = h('input', { type: 'number', value, min, max, step }) as HTMLInputElement;
    i.addEventListener('change', () => { set(Math.max(min, Math.min(max, Number(i.value) || min))); draw(); });
    return i;
  };
  /** The rooms that share a wall with a room. */
  const neighbours = (r: RoomSpec) => s.rooms.filter((q) => q !== r && (
    ((q.cells.x0 === r.cells.x1 || q.cells.x1 === r.cells.x0) && Math.min(q.cells.y1, r.cells.y1) > Math.max(q.cells.y0, r.cells.y0)) ||
    ((q.cells.y0 === r.cells.y1 || q.cells.y1 === r.cells.y0) && Math.min(q.cells.x1, r.cells.x1) > Math.max(q.cells.x0, r.cells.x0))));

  function renderSide(): void {
    const preset = h('select', {}, ...ROOM_PRESETS.map((p) => h('option', { value: p.id, title: p.hint }, p.label))) as HTMLSelectElement;
    const usePreset = () => {
      if (s.rooms.length && !confirm('Replace the rooms with the preset?')) return;
      snapshot();
      const p = presetSpec(preset.value, s.origin.x, s.origin.y, s.origin.z, s.uid, s.seed);
      s = { ...p, bands: s.bands };
      selected = null;
      fit();
      renderSide();
      draw();
    };
    const palette = h('div.palette', {}, ...ROOM_TYPES.map((t) => {
      const active = selected ? s.rooms.find((r) => r.id === selected)?.type === t.id : newType === t.id;
      return h((active ? 'button.pal.active' : 'button.pal') as 'button', {
        title: t.hint,
        onclick: () => {
          newType = t.id;
          const r = selected && s.rooms.find((q) => q.id === selected);
          if (r) { snapshot(); r.type = t.id; }
          renderSide();
          draw();
        },
      }, h('span.swatch', { style: { background: t.color } }), t.label);
    }));
    const sel = selected ? s.rooms.find((r) => r.id === selected) ?? null : null;
    let roomSection: HTMLElement | null = null;
    if (sel) {
      const name = h('input', { type: 'text', value: sel.name ?? '', placeholder: roomType(sel.type).label }) as HTMLInputElement;
      name.addEventListener('change', () => { sel.name = name.value.trim() || undefined; draw(); });
      const links = neighbours(sel).map((q) => {
        const own = s.links.find((l) => (l.a === sel.id && l.b === q.id) || (l.a === q.id && l.b === sel.id));
        const pick = h('select', {}, h('option', { value: '' }, 'By room types'), ...(['door', 'arches', 'open', 'wall'] as LinkKind[]).map((k) => h('option', { value: k }, { door: 'Doorway', arches: 'Archways', open: 'Open (no wall)', wall: 'Closed wall' }[k]))) as HTMLSelectElement;
        pick.value = own?.kind ?? '';
        pick.addEventListener('change', () => {
          snapshot();
          s.links = s.links.filter((l) => l !== own);
          if (pick.value) s.links.push({ a: sel.id, b: q.id, kind: pick.value as LinkKind });
          renderSide();
          draw();
        });
        return h('div.row', {}, h('label', {}, `→ ${q.name || roomType(q.type).label}`), pick);
      });
      roomSection = h('div.section', {}, h('h3', {}, 'Room'),
        h('div.row', {}, h('label', {}, 'Name'), name),
        h('p.hint', {}, `${roomType(sel.type).label}: ${roomType(sel.type).hint}. Pick another type above to change it.`),
        ...links,
        h('div.row', {}, h('button', { onclick: () => { snapshot(); removeRoom(sel.id); } }, 'Delete room'), h('button', { onclick: () => { selected = null; renderSide(); draw(); } }, 'Deselect')));
    }
    const bands = h('div.row', {}, h('label', {}, 'Window bands'), ...(['n', 'e', 's', 'w'] as Side[]).map((d) => {
      const c = h('input', { type: 'checkbox', checked: s.bands.includes(d), title: 'A band of windows high in the outer walls facing this way' }) as HTMLInputElement;
      c.addEventListener('change', () => { s.bands = c.checked ? [...s.bands, d] : s.bands.filter((b) => b !== d); draw(); });
      return h('span', {}, c, d.toUpperCase());
    }));
    const existing = !!target.detail;
    side.replaceChildren(
      h('div.section', {}, h('h3', {}, 'Preset'), h('div.row', {}, preset, h('button', { onclick: usePreset }, 'Use'))),
      h('div.section', {}, h('h3', {}, 'Draw'),
        seg<Mode>([['rooms', 'Rooms'], ['doors', 'Street doors'], ['erase', 'Erase']], () => mode, (v) => (mode = v)),
        h('p.hint', {}, mode === 'rooms' ? 'Drag on empty cells to add a room of the type below; click a room to select it.' : mode === 'doors' ? 'Click near an outer wall to add a street door there, again to remove it.' : 'Click a room to remove it (right-click does this in any mode).'),
        palette),
      roomSection ?? '',
      h('div.section', {}, h('h3', {}, 'Building'),
        h('div.row', {}, h('label', {}, 'Wall height'), num(s.height, (v) => (s.height = v), 256, 640, 16)),
        bands,
        h('div.row', {}, h('label', {}, 'Grid'), num(gw, (v) => (gw = v), 6, 64), h('span.muted', {}, '×'), num(gh, (v) => (gh = v), 6, 64)),
        h('div.row', {}, h('label', {}, 'Seed'), num(s.seed, (v) => (s.seed = v), 1, 1e9), h('button', { title: 'New seed', onclick: () => { s.seed = Math.floor(Math.random() * 100000); renderSide(); } }, '🎲'))),
      h('div.section', {}, h('h3', {}, 'Check'), issues),
      h('button.primary.big', { onclick: build }, existing ? '⟳ Rebuild interior building' : '🏛 Build interior building'),
    );
  }

  function build(): void {
    const layout = roomLayout(s);
    if (!s.rooms.length) { toast(editor.container, 'Add a room first'); return; }
    if (layout.issues.length && !confirm(`Build anyway?\n\n${layout.issues.join('\n')}`)) return;
    const t0 = performance.now();
    let detail: MapEntity | null;
    if (target.detail) {
      detail = regenerateRooms(editor, target.detail, clone(s), 'Rebuild interior building');
    } else {
      const spec = clone(s);
      // On a block brush: from its south-west corner on its floor, replacing it; else in front of the camera.
      const b = target.brush;
      if (b) {
        const box = solidBounds(b);
        spec.origin = { x: Math.round(box.min.x), y: Math.round(box.min.y), z: Math.round(box.min.z) };
      } else {
        const hit = editor.pickBrush(new Vector2(0, 0));
        const p = hit?.point ?? new Vector3();
        const w = Math.max(...spec.rooms.map((r) => r.cells.x1)) * spec.cell, d = Math.max(...spec.rooms.map((r) => r.cells.y1)) * spec.cell;
        spec.origin = { x: Math.round((p.x - w / 2) / 64) * 64, y: Math.round((p.y - d / 2) / 64) * 64, z: Math.round(p.z) };
      }
      let made = null as MapEntity | null;
      editor.history.group('Build interior building', () => {
        made = applyRooms(editor, spec, 'Build interior building').detail;
        if (b) editor.history.remove('Remove block', [b]);
      });
      detail = made;
      if (detail) selectRooms(editor, detail);
    }
    if (detail) {
      target = { detail };
      toast(editor.container, `Built ${s.rooms.length} rooms in ${Math.round(performance.now() - t0)} ms`);
    }
    close();
  }

  dialog.append(
    h('div.modal-head', {}, h('b', {}, 'Interior building'), h('span.hint', {}, 'North is up; each cell is 128 units. The camera sees the north and west walls: they get the relief, posters and lanterns.'), h('button', { onclick: close }, '✕')),
    h('div.sketch-body', {}, wrap, side),
  );
  new ResizeObserver(() => { if (!backdrop.hidden) draw(); }).observe(wrap);

  return {
    open(t: RoomsTarget) {
      target = t;
      const stored = t.detail ? roomsOf(t.detail) : null;
      if (stored) {
        s = clone(stored);
      } else {
        s = presetSpec('station', 0, 0, 0, newRoomsUid(), Math.floor(Math.random() * 100000));
        if (t.brush) {
          // Start from the preset when it fits the brush, otherwise from an empty plan of the brush's size.
          const box = solidBounds(t.brush);
          const cw = Math.floor((box.max.x - box.min.x) / 128), ch = Math.floor((box.max.y - box.min.y) / 128);
          if (s.rooms.some((r) => r.cells.x1 > cw || r.cells.y1 > ch)) { s.rooms = []; s.doors = []; }
          gw = Math.max(6, cw); gh = Math.max(6, ch);
        }
      }
      selected = null;
      undo.length = 0;
      gw = Math.max(gw, 8); gh = Math.max(gh, 8);
      fit();
      backdrop.hidden = false;
      renderSide();
      draw();
      requestAnimationFrame(() => requestAnimationFrame(() => draw()));
    },
  };
}
