import type { Editor } from '../editor.ts';
import {
  FEATURE_INFO, MARKER_INFO, AUTO_DETAIL, QUALITY_PAINT, SURFACE_INFO, Feature, Surface, emptySketch, generateFromSketch, placeMarkers, sketchBlocks, SOFIA_GRID, streetGrid, symmetricCells,
  type MarkerKind, type Sketch, type SketchTheme,
} from '../gen/sketch.ts';
import { ARCHITECTURES, FACADE_STYLES, type ArchitectureName, type BuildingQuality, type FacadeStyle } from '../gen/buildings.ts';
import { h, toast } from './dom.ts';
import { VmfDocument } from '../vmf/map.ts';
import { drawSketchPois, sketchPoiInput, sketchPoiPanel } from './sketchPoiLayer.ts';
import { placePois } from '../gen/poi/sketchPois.ts';
import { SURROUND_STYLES, type EdgeSide, type SurroundStyle } from '../gen/surroundings.ts';
import { SHAPE_SURFACES, ellipsePoints, railwayWidth, type ShapeSurface } from '../gen/sketchShapes.ts';
import { CARRIAGEWAYS, GUTTERS, KERBS, PAVEMENTS, STREET_PRESETS, type StreetMaterial } from '../gen/streetMaterials.ts';

type Layer = 'height' | 'surface' | 'feature' | 'detail' | 'marker' | 'poi' | 'shape';
type ShapeTool = 'street' | 'railway' | 'area' | 'round';
type Shape = 'brush' | 'rect' | 'fill';
const LEVEL_COLORS = ['#1d2f22', '#4f7a3a', '#a3a14e', '#c98a45', '#f0e2c0'];

/** The current sketch is kept on the editor so it survives closing the dialog and is saved with the map. */
/**
 * Map sketch dialog: paint height levels (with ramps), ground surfaces, features (buildings, trees,
 * walls, debris, cars) and markers on a 128-unit grid, then generate the 3D map from it.
 */
export function mountSketchDialog(editor: Editor): { open(): void; dialog: HTMLElement; generate(): void } {
  const backdrop = h('div.modal-backdrop', { hidden: true });
  const dialog = h('div.modal.sketch');
  backdrop.append(dialog);
  document.body.append(backdrop);
  const close = () => (backdrop.hidden = true);

  let s: Sketch = editor.sketch ?? emptySketch(48, 48, 'city');
  let layer: Layer = 'height';
  let shape: Shape = 'brush';
  let size = 2;
  let symmetry: 'none' | 'mirror' | 'rotate' = 'none';
  let level = 1;
  let ramp = false;
  let surface: Surface = Surface.Road;
  let feature: Feature = Feature.Building;
  let marker: MarkerKind = 'zombies';
  let quality: 1 | 2 | 3 = 1;
  // Shapes: the tool, the shape being drawn (points in cells), and the settings new shapes get.
  let shapeTool: ShapeTool = 'street';
  let draft: [number, number][] = [];
  let roundFrom: [number, number] | null = null;
  let roundTo: [number, number] | null = null;
  let streetWidth = 256, streetPavement = 64, streetRadius = 256, railTracks = 2;
  let areaSurface: ShapeSurface = 'grass';
  /** Points snap to half cells. */
  const snapHalf = (v: number) => Math.round(v * 2) / 2;
  const undo: string[] = [];
  const snapshot = () => { undo.push(JSON.stringify(s)); if (undo.length > 60) undo.shift(); };

  const canvas = h('canvas.sketch-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const wrap = h('div.sketch-canvas-wrap', {}, canvas);
  const side = h('div.sketch-side');
  const info = h('div.hint');
  let PX = 14;

  const draw = (preview?: { x0: number; y0: number; x1: number; y1: number }) => {
    const availW = wrap.clientWidth - 16, availH = wrap.clientHeight - 16;
    if (availW > 0 && availH > 0) PX = Math.max(4, Math.floor(Math.min(availW / s.w, availH / s.h)));
    canvas.width = s.w * PX;
    canvas.height = s.h * PX;
    const Y = (y: number) => (s.h - 1 - y) * PX; // row 0 is south
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      ctx.fillStyle = SURFACE_INFO[s.surface[i] as Surface].color;
      ctx.fillRect(x * PX, Y(y), PX, PX);
      // Height as a light-to-dark wash.
      const lv = s.levels[i];
      ctx.fillStyle = LEVEL_COLORS[Math.min(4, lv)];
      ctx.globalAlpha = layer === 'height' ? 0.62 : 0.28;
      ctx.fillRect(x * PX, Y(y), PX, PX);
      ctx.globalAlpha = 1;
      if (s.ramps[i]) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        for (let k = -PX; k < PX; k += 4) { ctx.moveTo(x * PX + k, Y(y) + PX); ctx.lineTo(x * PX + k + PX, Y(y)); }
        ctx.save(); ctx.beginPath(); ctx.rect(x * PX, Y(y), PX, PX); ctx.clip();
        for (let k = -PX; k < PX; k += 4) { ctx.moveTo(x * PX + k, Y(y) + PX); ctx.lineTo(x * PX + k + PX, Y(y)); }
        ctx.stroke(); ctx.restore();
      }
      const f = s.features[i] as Feature;
      if (f !== Feature.None) {
        ctx.fillStyle = FEATURE_INFO[f].color;
        const m = f === Feature.Building ? 1 : f === Feature.Wall ? PX * 0.32 : PX * 0.22;
        if (f === Feature.Trees) { ctx.beginPath(); ctx.arc(x * PX + PX / 2, Y(y) + PX / 2, PX * 0.36, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(x * PX + m, Y(y) + m, PX - 2 * m, PX - 2 * m);
      }
    }
    // Cliffs: dark edges where neighbouring levels differ and neither cell is a ramp.
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      if (x + 1 < s.w && s.levels[i] !== s.levels[i + 1] && !s.ramps[i] && !s.ramps[i + 1]) { ctx.moveTo((x + 1) * PX, Y(y)); ctx.lineTo((x + 1) * PX, Y(y) + PX); }
      if (y + 1 < s.h && s.levels[i] !== s.levels[i + s.w] && !s.ramps[i] && !s.ramps[i + s.w]) { ctx.moveTo(x * PX, Y(y)); ctx.lineTo((x + 1) * PX, Y(y)); }
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    // Faint grid every 4 cells (512 units).
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    for (let x = 0; x <= s.w; x += 4) { ctx.moveTo(x * PX + 0.5, 0); ctx.lineTo(x * PX + 0.5, canvas.height); }
    for (let y = 0; y <= s.h; y += 4) { ctx.moveTo(0, canvas.height - y * PX + 0.5); ctx.lineTo(canvas.width, canvas.height - y * PX + 0.5); }
    ctx.stroke();
    for (const m of s.markers) {
      const mi = MARKER_INFO[m.kind];
      const cx = m.x * PX, cy = canvas.height - m.y * PX;
      ctx.fillStyle = mi.color;
      ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(7, PX * 0.6), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.max(9, PX * 0.7)}px Segoe UI`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(mi.letter, cx, cy + 1);
    }
    drawSketchPois(ctx, s, PX, Y, layer === 'poi');
    // Free shapes: streets as their width, areas filled with their surface; the shape being drawn dashed.
    const cy = (y: number) => canvas.height - y * PX;
    const active = layer === 'shape';
    for (const sh of s.shapes ?? []) {
      if (sh.kind === 'street') {
        ctx.strokeStyle = active ? 'rgba(155,148,136,0.95)' : 'rgba(155,148,136,0.7)';
        ctx.lineWidth = Math.max(2, ((sh.width + 2 * sh.pavement) / 128) * PX);
        ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
        ctx.beginPath();
        sh.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * PX, cy(y)) : ctx.moveTo(x * PX, cy(y))));
        ctx.stroke();
        ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
        ctx.stroke(); ctx.setLineDash([]);
      } else if (sh.kind === 'railway') {
        // The ballast bed with a sleeper pattern over it.
        ctx.strokeStyle = active ? 'rgba(120,108,96,0.95)' : 'rgba(120,108,96,0.7)';
        ctx.lineWidth = Math.max(2, (railwayWidth(sh.tracks) / 128) * PX);
        ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
        ctx.beginPath();
        sh.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * PX, cy(y)) : ctx.moveTo(x * PX, cy(y))));
        ctx.stroke();
        ctx.strokeStyle = '#3a3029'; ctx.lineWidth = Math.max(2, ctx.lineWidth * 0.7); ctx.setLineDash([2, 4]);
        ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = SHAPE_SURFACES.find((q) => q.id === sh.surface)?.color ?? '#888';
        ctx.globalAlpha = active ? 0.9 : 0.7;
        ctx.beginPath();
        sh.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * PX, cy(y)) : ctx.moveTo(x * PX, cy(y))));
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#d8d2c6'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      }
    }
    const pending = roundFrom && roundTo ? ellipsePoints(roundFrom[0], roundFrom[1], roundTo[0], roundTo[1]) : draft;
    if (active && pending.length) {
      ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      pending.forEach(([x, y], i) => (i ? ctx.lineTo(x * PX, cy(y)) : ctx.moveTo(x * PX, cy(y))));
      if (shapeTool !== 'street' && shapeTool !== 'railway' && pending.length > 2) ctx.closePath();
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
      ctx.fillStyle = '#e8a33d';
      for (const [x, y] of draft) { ctx.beginPath(); ctx.arc(x * PX, cy(y), 3, 0, Math.PI * 2); ctx.fill(); }
    }
    if (layer === 'detail') {
      // Painted cells as a wash; each block outlined in the quality it will be built at.
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        const v = s.quality?.[y * s.w + x] as 1 | 2 | 3 | undefined;
        if (!v) continue;
        ctx.fillStyle = QUALITY_PAINT[v].color;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x * PX, Y(y), PX, PX);
        ctx.globalAlpha = 1;
      }
      const color = (q: BuildingQuality) => Object.values(QUALITY_PAINT).find((p) => p.quality === q)!.color;
      ctx.lineWidth = 3;
      for (const b of sketchBlocks(s)) {
        ctx.strokeStyle = color(b.quality);
        ctx.strokeRect(b.x0 * PX + 1.5, Y(b.y1 - 1) + 1.5, (b.x1 - b.x0) * PX - 3, (b.y1 - b.y0) * PX - 3);
      }
      ctx.lineWidth = 1;
    }
    if (preview) {
      ctx.strokeStyle = '#e8a33d';
      ctx.setLineDash([4, 3]);
      const x0 = Math.min(preview.x0, preview.x1), x1 = Math.max(preview.x0, preview.x1), y0 = Math.min(preview.y0, preview.y1), y1 = Math.max(preview.y0, preview.y1);
      ctx.strokeRect(x0 * PX, Y(y1), (x1 - x0 + 1) * PX, (y1 - y0 + 1) * PX);
      ctx.setLineDash([]);
    }
    const n = (f: Feature) => s.features.filter((x) => x === f).length;
    info.textContent = `${s.w}×${s.h} cells (${s.w * 128}×${s.h * 128} units) · ${n(Feature.Building)} building cells · ${s.markers.length} markers · ${s.pois?.length ?? 0} POIs`;
  };

  /** Applies the current layer's value to one cell (plus its symmetric copies). */
  const applyCell = (x: number, y: number, erase: boolean) => {
    for (const [cx, cy] of symmetricCells(s, x, y, symmetry)) {
      if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.h) continue;
      const i = cy * s.w + cx;
      if (layer === 'height') {
        if (ramp) s.ramps[i] = erase ? 0 : 1;
        else { s.levels[i] = erase ? 0 : level; s.ramps[i] = 0; }
      } else if (layer === 'surface') s.surface[i] = erase ? (s.theme === 'city' ? Surface.Paved : Surface.Grass) : surface;
      else if (layer === 'feature') s.features[i] = erase ? Feature.None : feature;
      else if (layer === 'detail') (s.quality ??= new Array(s.w * s.h).fill(0))[i] = erase ? 0 : quality;
    }
  };
  const paintAt = (x: number, y: number, erase: boolean) => {
    const r = size - 1, o = Math.floor(r / 2);
    for (let dy = 0; dy <= r; dy++) for (let dx = 0; dx <= r; dx++) applyCell(x - o + dx, y - o + dy, erase);
  };
  const fillFrom = (x: number, y: number, erase: boolean) => {
    const key = (i: number) => layer === 'height' ? `${s.levels[i]}:${s.ramps[i]}` : layer === 'surface' ? String(s.surface[i]) : layer === 'detail' ? String(s.quality?.[i] ?? 0) : String(s.features[i]);
    const start = y * s.w + x, target = key(start);
    const seen = new Uint8Array(s.w * s.h);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const cx = i % s.w, cy = Math.floor(i / s.w);
      applyCell(cx, cy, erase);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = ny * s.w + nx;
        if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h || seen[k] || key(k) !== target) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
  };

  const cellOf = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const fx = ((e.clientX - r.left) / r.width) * s.w, fy = s.h - ((e.clientY - r.top) / r.height) * s.h;
    return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
  };
  let down: { x: number; y: number; erase: boolean } | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  /** Ends the shape being drawn: a street needs two points, an area three. */
  const finishShape = () => {
    if (shapeTool === 'street' && draft.length >= 2) (s.shapes ??= []).push({ kind: 'street', points: draft, width: streetWidth, pavement: streetPavement, radius: streetRadius });
    if (shapeTool === 'railway' && draft.length >= 2) (s.shapes ??= []).push({ kind: 'railway', points: draft, tracks: railTracks, radius: streetRadius });
    if (shapeTool === 'area' && draft.length >= 3) (s.shapes ??= []).push({ kind: 'area', points: draft, surface: areaSurface });
    draft = [];
    draw();
  };
  /** The shape nearest a point (within a cell of one of its points or segments), for right-click removal. */
  const shapeNear = (fx: number, fy: number) => (s.shapes ?? []).findIndex((sh) => sh.points.some(([x, y], i, a) => {
    const [x2, y2] = a[(i + 1) % a.length];
    const dx = x2 - x, dy = y2 - y, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((fx - x) * dx + (fy - y) * dy) / len2));
    return Math.hypot(fx - (x + t * dx), fy - (y + t * dy)) < (sh.kind === 'street' ? Math.max(1, sh.width / 256) : sh.kind === 'railway' ? Math.max(1, railwayWidth(sh.tracks) / 256) : 1);
  }));
  canvas.addEventListener('dblclick', () => { if (layer === 'shape') finishShape(); });
  canvas.addEventListener('pointerdown', (e) => {
    const c = cellOf(e);
    const erase = e.button === 2;
    if (layer === 'shape') {
      if (erase) {
        if (draft.length) { draft = []; draw(); return; }
        const i = shapeNear(c.fx, c.fy);
        if (i >= 0) { snapshot(); s.shapes!.splice(i, 1); draw(); }
        return;
      }
      const p: [number, number] = [snapHalf(c.fx), snapHalf(c.fy)];
      if (shapeTool === 'round') { roundFrom = p; roundTo = p; canvas.setPointerCapture(e.pointerId); draw(); return; }
      if (!draft.length) snapshot();
      const last = draft[draft.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) draft.push(p);
      draw();
      return;
    }
    snapshot();
    if (layer === 'marker') {
      const near = s.markers.findIndex((m) => Math.hypot(m.x - c.fx, m.y - c.fy) < 0.9);
      if (near >= 0) s.markers.splice(near, 1);
      if (!erase && near < 0) s.markers.push({ kind: marker, x: Math.round(c.fx * 2) / 2, y: Math.round(c.fy * 2) / 2 });
      draw();
      return;
    }
    if (layer === 'poi' && erase) { sketchPoiInput(s, c, c, true); draw(); return; }
    if (shape === 'fill' && layer !== 'poi') { fillFrom(c.x, c.y, erase); draw(); return; }
    down = { x: c.x, y: c.y, erase };
    canvas.setPointerCapture(e.pointerId);
    if (shape === 'brush' && layer !== 'poi') { paintAt(c.x, c.y, erase); draw(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (layer === 'shape' && roundFrom) { const c = cellOf(e); roundTo = [snapHalf(c.fx), snapHalf(c.fy)]; draw(); return; }
    if (!down) return;
    const c = cellOf(e);
    if (shape === 'brush' && layer !== 'poi') { paintAt(c.x, c.y, down.erase); draw(); }
    else draw({ x0: down.x, y0: down.y, x1: c.x, y1: c.y });
  });
  canvas.addEventListener('pointerup', (e) => {
    if (layer === 'shape' && roundFrom) {
      const c = cellOf(e);
      const to: [number, number] = [snapHalf(c.fx), snapHalf(c.fy)];
      if (Math.abs(to[0] - roundFrom[0]) >= 1 && Math.abs(to[1] - roundFrom[1]) >= 1) {
        snapshot();
        (s.shapes ??= []).push({ kind: 'area', points: ellipsePoints(roundFrom[0], roundFrom[1], to[0], to[1]), surface: areaSurface });
      }
      roundFrom = roundTo = null;
      draw();
      return;
    }
    if (!down) return;
    if (layer === 'poi') sketchPoiInput(s, down, cellOf(e), false);
    else if (shape === 'rect') {
      const c = cellOf(e);
      for (let y = Math.min(down.y, c.y); y <= Math.max(down.y, c.y); y++) for (let x = Math.min(down.x, c.x); x <= Math.max(down.x, c.x); x++) applyCell(x, y, down.erase);
    }
    down = null;
    draw();
  });
  window.addEventListener('keydown', (e) => {
    if (backdrop.hidden) return;
    if (layer === 'shape' && e.key === 'Enter') { finishShape(); e.preventDefault(); return; }
    if (layer === 'shape' && e.key === 'Escape' && draft.length) { draft = []; draw(); e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undo.length) {
      s = JSON.parse(undo.pop()!);
      e.preventDefault();
      draw();
    }
  });

  // --- Side panel -----------------------------------------------------------------------------------
  const seg = <T extends string | number>(opts: [T, string][], get: () => T, set: (v: T) => void) => {
    const el = h('div.seg');
    const render = () => el.replaceChildren(...opts.map(([v, l]) => h((v === get() ? 'button.active' : 'button') as 'button', { onclick: () => { set(v); render(); renderSide(); } }, l)));
    render();
    return el;
  };
  const swatches = <T extends number | string>(entries: [T, { label: string; color: string }][], get: () => T, set: (v: T) => void) =>
    h('div.palette', {}, ...entries.map(([v, inf]) => h((v === get() ? 'button.pal.active' : 'button.pal') as 'button', { onclick: () => { set(v); renderSide(); } },
      h('span.swatch', { style: { background: inf.color } }), inf.label)));

  const renderSide = () => {
    const layerOpts: [Layer, string][] = [['height', 'Height'], ['surface', 'Surface'], ['feature', 'Features'], ['detail', 'Detail'], ['marker', 'Markers'], ['poi', 'POIs'], ['shape', 'Shapes']];
    let paint: HTMLElement;
    const shapeNum = (value: number, set: (v: number) => void, min: number, max: number, step = 16) => {
      const i = h('input', { type: 'number', value, min, max, step }) as HTMLInputElement;
      i.addEventListener('change', () => set(Math.max(min, Math.min(max, Number(i.value) || min))));
      return i;
    };
    if (layer === 'height') {
      paint = h('div', {},
        h('div.palette', {}, ...[0, 1, 2, 3, 4].map((l) => h((!ramp && l === level ? 'button.pal.active' : 'button.pal') as 'button', { onclick: () => { level = l; ramp = false; renderSide(); } },
          h('span.swatch', { style: { background: LEVEL_COLORS[l] } }), `Level ${l} (${l * s.levelHeight})`)),
          h((ramp ? 'button.pal.active' : 'button.pal') as 'button', { onclick: () => { ramp = true; renderSide(); } }, h('span.swatch.ramp'), 'Ramp')),
        h('p.hint', {}, 'Level changes become cliffs; paint Ramp over a step to make it walkable.'));
    } else if (layer === 'surface') {
      paint = swatches(Object.entries(SURFACE_INFO).map(([k, v]) => [Number(k) as Surface, v]), () => surface, (v) => (surface = v));
    } else if (layer === 'feature') {
      paint = swatches(Object.entries(FEATURE_INFO).filter(([k]) => Number(k) !== Feature.None).map(([k, v]) => [Number(k) as Feature, v]), () => feature, (v) => (feature = v));
    } else if (layer === 'detail') {
      paint = h('div', {}, swatches(Object.entries(QUALITY_PAINT).map(([k, v]) => [Number(k) as 1 | 2 | 3, v]), () => quality, (v) => (quality = v)),
        h('p.hint', {}, `Paint high detail where the mission goes and filler elsewhere; right drag removes paint. A block takes its most detailed paint; unpainted ones follow Building detail (auto: high within ${AUTO_DETAIL.high} cells of markers and POIs, medium within ${AUTO_DETAIL.medium}). Outlines show the result.`));
    } else if (layer === 'poi') {
      paint = sketchPoiPanel(renderSide);
    } else if (layer === 'shape') {
      const settings = shapeTool === 'street'
        ? h('div', {},
          h('div.row', {}, h('label', {}, 'Width'), shapeNum(streetWidth, (v) => (streetWidth = v), 128, 640), h('span.unit', {}, 'units')),
          h('div.row', {}, h('label', {}, 'Pavement'), shapeNum(streetPavement, (v) => (streetPavement = v), 0, 192), h('span.unit', {}, 'each side')),
          h('div.row', {}, h('label', {}, 'Bends'), shapeNum(streetRadius, (v) => (streetRadius = v), 0, 1024, 64), h('span.unit', {}, 'radius')))
        : shapeTool === 'railway'
          ? h('div', {},
            h('div.row', {}, h('label', {}, 'Tracks'), shapeNum(railTracks, (v) => (railTracks = v), 1, 4, 1)),
            h('div.row', {}, h('label', {}, 'Bends'), shapeNum(streetRadius, (v) => (streetRadius = v), 0, 2048, 64), h('span.unit', {}, 'radius')))
          : swatches(SHAPE_SURFACES.map((q) => [q.id, q] as [ShapeSurface, { label: string; color: string }]), () => areaSurface, (v) => (areaSurface = v));
      const hint = shapeTool === 'street' ? 'Click the street\'s points (half cells), double-click or Enter to finish. Bends are rounded by the radius; buildings are cut along it.'
        : shapeTool === 'railway' ? 'Click the line\'s points, double-click or Enter to finish: tracks on ballast with rails. Lines that reach the edge run on out of the map; start one at a train hall\'s end opening to lead its tracks out.'
        : shapeTool === 'area' ? 'Click the outline\'s points, double-click or Enter to finish (it is kept convex). Buildings keep off it.'
          : 'Drag a rectangle: the area is the ellipse inside it. Buildings keep off it.';
      paint = h('div', {},
        h('div.row', {}, h('label', {}, 'Draw'), seg<ShapeTool>([['street', 'Street'], ['railway', 'Railway'], ['area', 'Area'], ['round', 'Round area']], () => shapeTool, (v) => { shapeTool = v; draft = []; })),
        settings,
        h('p.hint', {}, hint + ' Right-click a shape to remove it, Escape drops the one being drawn.'),
        h('div.row', {}, h('span.muted', {}, `${s.shapes?.length ?? 0} shapes`),
          h('button', { onclick: () => { if (s.shapes?.length && confirm('Remove all shapes?')) { snapshot(); s.shapes = []; draw(); renderSide(); } } }, 'Clear shapes')));
    } else {
      paint = h('div', {}, swatches(Object.entries(MARKER_INFO) as [MarkerKind, { label: string; color: string }][], () => marker, (v) => (marker = v)),
        h('p.hint', {}, 'Click to place, click a marker again to remove it.'));
    }
    const theme = h('select', {}, h('option', { value: 'city' }, 'City (cobblestone)'), h('option', { value: 'rural' }, 'Rural (grass)')) as HTMLSelectElement;
    theme.value = s.theme;
    theme.addEventListener('change', () => {
      snapshot();
      // The theme's default ground (cobble in the city, grass in the countryside) follows the theme.
      const from = s.theme === 'city' ? Surface.Paved : Surface.Grass;
      s.theme = theme.value as SketchTheme;
      const to = s.theme === 'city' ? Surface.Paved : Surface.Grass;
      s.surface = s.surface.map((v) => (v === from ? to : v));
      draw();
    });
    const facade = h('select', {}, h('option', { value: '' }, 'Mixed'), ...Object.keys(FACADE_STYLES).map((k) => h('option', { value: k }, k))) as HTMLSelectElement;
    facade.value = s.facade ?? '';
    facade.addEventListener('change', () => (s.facade = (facade.value || undefined) as FacadeStyle | undefined));
    const arch = h('select', {}, ...Object.entries(ARCHITECTURES).map(([k, a]) => h('option', { value: k }, a.label))) as HTMLSelectElement;
    arch.value = s.architecture ?? 'mixed';
    arch.addEventListener('change', () => (s.architecture = arch.value as ArchitectureName));
    const interiors = h('select', { title: 'Enterable open-top houses on small lots of 1–2 floors' },
      h('option', { value: '' }, 'From architecture'), h('option', { value: 'none' }, 'None'), h('option', { value: 'some' }, 'Some'), h('option', { value: 'all' }, 'All')) as HTMLSelectElement;
    interiors.value = s.interiors ?? '';
    interiors.addEventListener('change', () => (s.interiors = (interiors.value || undefined) as Sketch['interiors']));
    const yards = h('select', { title: 'What fills courtyards and back yards' },
      h('option', { value: '' }, 'Sheds'), h('option', { value: 'green' }, 'Green: lawns, trees, playgrounds, parking')) as HTMLSelectElement;
    yards.value = s.yards ?? '';
    yards.addEventListener('change', () => (s.yards = (yards.value || undefined) as Sketch['yards']));
    const openYards = h('input', { type: 'range', min: 0, max: 0.6, step: 0.1, value: s.openYards ?? 0, title: 'Share of the side lots of ring blocks left open, so courtyards open onto the street' }) as HTMLInputElement;
    openYards.addEventListener('change', () => (s.openYards = Number(openYards.value) || undefined));
    const blockSize = h('select', { title: 'Longest side of one block of buildings; blocks of 7 cells and more can be rings around a courtyard' },
      ...[8, 12, 16].map((n) => h('option', { value: n }, `${n} cells`))) as HTMLSelectElement;
    blockSize.value = String(s.blockSize ?? 8);
    blockSize.addEventListener('change', () => { s.blockSize = Number(blockSize.value); draw(); });
    const streets = h('select', { title: 'Sofia: wider pavements on wide streets, parked cars along the kerbs, bollards' },
      h('option', { value: '' }, 'Classic'), h('option', { value: 'sofia' }, 'Sofia: parked cars, bollards')) as HTMLSelectElement;
    streets.value = s.streets === 'sofia' ? 'sofia' : '';
    streets.addEventListener('change', () => (s.streets = (streets.value || undefined) as Sketch['streets']));
    // Street materials: a preset, then each part on its own.
    const sm = () => (s.streetMaterials ??= {});
    const matSel = (list: StreetMaterial[], key: 'carriageway' | 'pavement' | 'kerb' | 'gutter', title: string) => {
      const sel = h('select', { title }, h('option', { value: '' }, 'Default'), ...list.map((m) => h('option', { value: m.id }, m.label))) as HTMLSelectElement;
      sel.value = s.streetMaterials?.[key] ?? '';
      sel.addEventListener('change', () => { sm()[key] = sel.value || undefined; });
      return sel;
    };
    const streetPreset = h('select', { title: 'The look of the streets in one choice' }, h('option', { value: '' }, 'Choose a set…'),
      ...STREET_PRESETS.map((p) => h('option', { value: p.id }, p.label))) as HTMLSelectElement;
    streetPreset.addEventListener('change', () => {
      const p = STREET_PRESETS.find((q) => q.id === streetPreset.value);
      if (p) { s.streetMaterials = { ...p.materials }; renderSide(); }
    });
    const corner = h('input', { type: 'number', min: 0, max: 160, step: 16, value: s.streetMaterials?.corner ?? 0, title: 'Radius of the kerbs at street corners (0: square)' }) as HTMLInputElement;
    corner.addEventListener('change', () => { sm().corner = Math.max(0, Math.min(160, Number(corner.value) || 0)); });

    // Beyond the playable area: one style for the whole map, another per side where wanted.
    const surround = h('select', { title: 'What lies beyond the edge of the playable area' },
      ...SURROUND_STYLES.map((st) => h('option', { value: st.id, title: st.hint }, st.label))) as HTMLSelectElement;
    surround.value = s.surroundings?.style ?? 'none';
    surround.addEventListener('change', () => { s.surroundings = { ...(s.surroundings ?? {}), style: surround.value as SurroundStyle }; renderSide(); });
    const sideSel = (side: EdgeSide) => {
      const sel = h('select', { title: `Beyond the ${({ n: 'north', e: 'east', s: 'south', w: 'west' })[side]} edge` },
        h('option', { value: '' }, side.toUpperCase()), ...SURROUND_STYLES.map((st) => h('option', { value: st.id }, `${side.toUpperCase()}: ${st.label}`))) as HTMLSelectElement;
      sel.value = s.surroundings?.sides?.[side] ?? '';
      sel.addEventListener('change', () => {
        const sides = { ...(s.surroundings?.sides ?? {}) };
        if (sel.value) sides[side] = sel.value as SurroundStyle; else delete sides[side];
        s.surroundings = { style: s.surroundings?.style ?? 'none', ...s.surroundings, sides };
      });
      return sel;
    };
    // The street grid: blocks between streets over the whole sketch.
    const g = { ...SOFIA_GRID, seed: s.seed };
    const gridNum = (key: 'block' | 'street' | 'boulevard' | 'every', min: number, max: number) => num(g[key], (v) => (g[key] = v), min, max);
    const parks = h('input', { type: 'range', min: 0, max: 0.5, step: 0.05, value: g.parks }) as HTMLInputElement;
    parks.addEventListener('change', () => (g.parks = Number(parks.value)));
    const layOut = () => {
      if (!confirm('Lay the whole sketch out as a street grid? Buildings, roads and surfaces are replaced (heights, markers and POIs stay).')) return;
      snapshot();
      streetGrid(s, g);
      // The layout the grid is made for: big blocks that can be rings, green yards, Sofia streets, filler away from the action.
      s.blockSize = Math.max(s.blockSize ?? 8, g.block + 2);
      s.yards = 'green';
      s.openYards = s.openYards ?? 0.3;
      s.streets = 'sofia';
      s.buildingDetail = 'auto';
      renderSide();
      draw();
    };
    const detailSel = h('select', { title: 'How detailed unpainted buildings are (paint the Detail layer to choose per block)' },
      h('option', { value: 'high' }, 'High everywhere'), h('option', { value: 'auto' }, 'Auto: by distance to the action')) as HTMLSelectElement;
    detailSel.value = s.buildingDetail ?? 'high';
    detailSel.addEventListener('change', () => { s.buildingDetail = detailSel.value as Sketch['buildingDetail']; draw(); });
    const num = (value: number, set: (v: number) => void, min = 1, max = 99) => {
      const i = h('input', { type: 'number', value, min, max }) as HTMLInputElement;
      i.addEventListener('change', () => set(Math.max(min, Math.min(max, parseInt(i.value, 10) || min))));
      return i;
    };
    const sizeSel = h('select', {}, ...[32, 48, 64].map((n) => h('option', { value: n, selected: n === s.w }, `${n}×${n} (${n * 128} units)`))) as HTMLSelectElement;
    sizeSel.addEventListener('change', () => {
      const n = parseInt(sizeSel.value, 10);
      if (n === s.w) return;
      snapshot();
      const old = s;
      s = { ...emptySketch(n, n, old.theme), seed: old.seed, levelHeight: old.levelHeight, floors: old.floors, facade: old.facade, architecture: old.architecture, interiors: old.interiors, buildingDetail: old.buildingDetail, blockSize: old.blockSize, yards: old.yards, openYards: old.openYards, streets: old.streets, surroundings: old.surroundings, streetMaterials: old.streetMaterials };
      if (old.quality) s.quality = new Array(n * n).fill(0);
      for (let y = 0; y < Math.min(n, old.h); y++) for (let x = 0; x < Math.min(n, old.w); x++) {
        const a = y * n + x, b = y * old.w + x;
        s.levels[a] = old.levels[b]; s.ramps[a] = old.ramps[b]; s.surface[a] = old.surface[b]; s.features[a] = old.features[b];
        if (s.quality) s.quality[a] = old.quality![b];
      }
      s.markers = old.markers.filter((m) => m.x < n && m.y < n);
      s.pois = (old.pois ?? []).filter((p) => p.x + p.w <= n && p.y + p.h <= n);
      draw();
    });
    side.replaceChildren(
      h('div.section', {}, h('h3', {}, 'Layer'), seg(layerOpts, () => layer, (v) => { layer = v; draw(); })),
      h('div.section', {}, h('h3', {}, 'Paint'), paint,
        layer !== 'marker' && layer !== 'poi' && layer !== 'shape' ? h('div.row', {}, h('label', {}, 'Tool'), seg<Shape>([['brush', 'Brush'], ['rect', 'Rectangle'], ['fill', 'Fill']], () => shape, (v) => (shape = v))) : null,
        layer !== 'marker' && layer !== 'poi' && layer !== 'shape' ? h('div.row', {}, h('label', {}, 'Brush size'), seg<number>([[1, '1'], [2, '2'], [3, '3'], [5, '5']], () => size, (v) => (size = v))) : null,
        h('div.row', {}, h('label', {}, 'Symmetry'), seg<'none' | 'mirror' | 'rotate'>([['none', 'None'], ['mirror', 'Mirror'], ['rotate', 'Rotate']], () => symmetry, (v) => (symmetry = v)))),
      h('div.section', {}, h('h3', {}, 'Map'),
        h('div.row', {}, h('label', {}, 'Theme'), theme),
        h('div.row', {}, h('label', {}, 'Size'), sizeSel),
        h('div.row', {}, h('label', {}, 'Level height'), num(s.levelHeight, (v) => (s.levelHeight = v), 32, 512)),
        h('div.row', {}, h('label', {}, 'Floors'), num(s.floors[0], (v) => (s.floors[0] = v), 1, 12), h('span.muted', {}, 'to'), num(s.floors[1], (v) => (s.floors[1] = v), 1, 12)),
        h('div.row', {}, h('label', {}, 'Architecture'), arch),
        h('div.row', {}, h('label', {}, 'Interiors'), interiors),
        h('div.row', {}, h('label', {}, 'Building detail'), detailSel),
        h('div.row', {}, h('label', {}, 'Block size'), blockSize),
        h('div.row', {}, h('label', {}, 'Yards'), yards),
        h('div.row', {}, h('label', {}, 'Open courtyards'), openYards),
        h('div.row', {}, h('label', {}, 'Streets'), streets),
        h('div.row', {}, h('label', {}, 'Street look'), streetPreset),
        h('div.row', {}, h('label', {}, 'Carriageway'), matSel(CARRIAGEWAYS, 'carriageway', 'What the carriageway is made of')),
        h('div.row', {}, h('label', {}, 'Pavement'), matSel(PAVEMENTS, 'pavement', 'What the pavements are made of')),
        h('div.row', {}, h('label', {}, 'Kerb'), matSel(KERBS, 'kerb', 'The kerb stones')),
        h('div.row', {}, h('label', {}, 'Gutter'), matSel(GUTTERS, 'gutter', 'A strip of setts or cobbles along the kerbs')),
        h('div.row', {}, h('label', {}, 'Round corners'), corner, h('span.unit', {}, 'units')),
        h('div.row', {}, h('label', {}, 'Surroundings'), surround),
        h('div.row', {}, h('label', {}, 'Per side'), ...(['n', 'e', 's', 'w'] as EdgeSide[]).map(sideSel)),
        h('div.row', {}, h('label', {}, 'Facade'), facade),
        h('div.row', {}, h('label', {}, 'Seed'), num(s.seed, (v) => (s.seed = v), 1, 1e9))),
      h('div.section', {}, h('h3', {}, 'Street grid'),
        h('p.hint', {}, 'Blocks between streets over the whole map, after central Sofia at about half scale. Streets are road cells; every few is a boulevard with a planted median; some blocks are parks.'),
        h('div.row', {}, h('label', {}, 'Block'), gridNum('block', 5, 24), h('span.unit', {}, 'cells')),
        h('div.row', {}, h('label', {}, 'Street'), gridNum('street', 2, 8), h('span.unit', {}, 'cells')),
        h('div.row', {}, h('label', {}, 'Boulevard'), gridNum('boulevard', 0, 12), h('span.muted', {}, 'every'), gridNum('every', 1, 9)),
        h('div.row', {}, h('label', {}, 'Parks'), parks),
        h('button', { onclick: layOut }, 'Lay out street grid')),
      h('div.row', {}, h('button', { onclick: () => { if (confirm('Clear the sketch?')) { snapshot(); s = emptySketch(s.w, s.h, s.theme); draw(); } } }, 'Clear')),
      h('button.primary.big', { onclick: generate }, '⚙ Generate 3D map'),
      info,
    );
  };

  function generate(): void {
    if (editor.dirty && editor.sketch !== s && !confirm('Replace the current map with the generated one? Unsaved changes are lost.')) return;
    const t0 = performance.now();
    const r = generateFromSketch(s);
    placeMarkers({ doc: r.doc }, s, r);
    placePois(r.doc, s, r);
    // Markers were added through wrappers; re-read so every wrapper is fresh.
    const doc = VmfDocument.parse(r.doc.serialize());
    const name = editor.mapName.endsWith('.vmf') && editor.sketch ? editor.mapName : 'sketch_map.vmf';
    editor.loadDocument(doc, name, '');
    editor.sketch = s;
    editor.dirty = true;
    editor.emit('change');
    close();
    toast(editor.container, `Generated ${doc.allSolids().length} brushes and ${doc.entities.length} entities in ${Math.round(performance.now() - t0)} ms`);
  }

  dialog.append(
    h('div.modal-head', {}, h('b', {}, 'Map sketch'), h('span.hint', {}, 'Left drag paints, right drag erases, Ctrl+Z undoes. North is up; each cell is 128 units.'), h('button', { onclick: close }, '✕')),
    h('div.sketch-body', {}, wrap, side),
  );
  renderSide();
  new ResizeObserver(() => { if (!backdrop.hidden) draw(); }).observe(wrap);

  return {
    open() {
      if (editor.sketch && editor.sketch !== s) s = editor.sketch;
      backdrop.hidden = false;
      renderSide();
      draw();
      requestAnimationFrame(() => requestAnimationFrame(() => draw()));
    },
    generate,
    dialog,
  };
}

