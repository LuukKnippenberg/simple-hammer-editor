import { SKETCH_CELL, type Sketch, type SketchPoi } from '../gen/sketch.ts';
import { POI_TYPES, poiType } from '../gen/poi/registry.ts';
import { LANDSCAPES } from '../gen/poi/types.ts';
import { h } from './dom.ts';
import '../gen/poi/catalogue.ts';

/**
 * The sketch's POI layer: drag a rectangle to place the chosen point of interest, right-click one to
 * remove it. Kept apart from sketchDialog.ts, which only routes the layer's drawing and input here.
 */
export const sketchPoiState = { type: 'square', rotation: 0 as 0 | 90 | 180 | 270 };

/** The rectangle in cells a drag makes for the chosen type, grown to its minimum and cut to its maximum size. */
export function poiCells(s: Sketch, x0: number, y0: number, x1: number, y1: number): SketchPoi | null {
  const t = poiType(sketchPoiState.type);
  if (!t) return null;
  const turned = sketchPoiState.rotation === 90 || sketchPoiState.rotation === 270;
  const [minW, minH] = (turned ? [t.minSize[1], t.minSize[0]] : t.minSize).map((v) => Math.ceil(v / SKETCH_CELL));
  const [maxW, maxH] = (turned ? [t.maxSize[1], t.maxSize[0]] : t.maxSize).map((v) => Math.floor(v / SKETCH_CELL));
  let w = Math.abs(x1 - x0) + 1, hh = Math.abs(y1 - y0) + 1;
  w = Math.max(minW, Math.min(maxW, w));
  hh = Math.max(minH, Math.min(maxH, hh));
  const x = Math.max(0, Math.min(s.w - w, Math.min(x0, x1))), y = Math.max(0, Math.min(s.h - hh, Math.min(y0, y1)));
  return { type: t.id, x, y, w, h: hh, rotation: sketchPoiState.rotation, seed: Math.floor(Math.random() * 100000) };
}

/** Handles a finished drag (or right-click) on the POI layer. */
export function sketchPoiInput(s: Sketch, a: { x: number; y: number }, b: { x: number; y: number }, erase: boolean): void {
  s.pois ??= [];
  const hit = s.pois.findIndex((p) => b.x >= p.x && b.x < p.x + p.w && b.y >= p.y && b.y < p.y + p.h);
  if (erase) {
    if (hit >= 0) s.pois.splice(hit, 1);
    return;
  }
  const p = poiCells(s, a.x, a.y, b.x, b.y);
  if (p) s.pois.push(p);
}

/** Draws the sketch's POIs (and a drag preview) on the canvas; `Y` maps a cell row to its top pixel. */
export function drawSketchPois(ctx: CanvasRenderingContext2D, s: Sketch, PX: number, Y: (y: number) => number, active: boolean): void {
  for (const p of s.pois ?? []) {
    const t = poiType(p.type);
    const x = p.x * PX, y = Y(p.y + p.h - 1), w = p.w * PX, hh = p.h * PX;
    ctx.fillStyle = active ? 'rgba(110, 231, 160, 0.28)' : 'rgba(110, 231, 160, 0.14)';
    ctx.fillRect(x, y, w, hh);
    ctx.strokeStyle = '#6ee7a0';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, hh - 2);
    ctx.lineWidth = 1;
    ctx.fillStyle = '#e8fff0';
    ctx.font = `bold ${Math.max(10, Math.min(16, PX))}px Segoe UI`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${t?.icon ?? '?'} ${t?.label ?? p.type}`, x + w / 2, y + hh / 2);
  }
}

/** The layer's side panel: the type picker (by landscape) and the rotation. */
export function sketchPoiPanel(rerender: () => void): HTMLElement {
  const types = h('select', {}, ...LANDSCAPES.map((l) => h('optgroup', { label: l.label },
    ...POI_TYPES.filter((t) => t.landscapes[0] === l.id).map((t) => h('option', { value: t.id }, `${t.icon} ${t.label}`))))) as HTMLSelectElement;
  types.value = sketchPoiState.type;
  types.addEventListener('change', () => { sketchPoiState.type = types.value; rerender(); });
  const rot = h('select', {}, ...[0, 90, 180, 270].map((r) => h('option', { value: r }, `${r}°`))) as HTMLSelectElement;
  rot.value = String(sketchPoiState.rotation);
  rot.addEventListener('change', () => { sketchPoiState.rotation = Number(rot.value) as 0 | 90 | 180 | 270; });
  const t = poiType(sketchPoiState.type);
  return h('div', {}, h('div.row', {}, h('label', {}, 'Type'), types), h('div.row', {}, h('label', {}, 'Rotation'), rot),
    h('p.hint', {}, `${t?.hint ?? ''} Drag a rectangle (at least ${t ? t.minSize.map((v) => Math.ceil(v / SKETCH_CELL)).join('×') : '?'} cells); right-click one to remove it. Its settings can be changed in the editor after generating.`));
}
