import { Vector3 } from 'three';
import { KVNode, KVPair } from '../../vmf/keyvalues.ts';
import { VmfDocument, vecStr } from '../../vmf/map.ts';
import type { ParamValue } from '../../lw/kits.ts';
import { Rng } from '../rng.ts';
import { buildPoi, newSpec, poiType, POI_TYPES } from './registry.ts';
import { encodePoi, POI_ID_KEY, POI_KEY } from './spec.ts';
import { handleNode } from './handle.ts';
import type { Landscape, PoiSpec, Rect, Rotation } from './types.ts';
import './catalogue.ts';

/**
 * POIs in generated maps (the 2D sketch and *Generate map*): where they go, the terrain under them, and
 * building them straight into a document (no editor, no undo).
 */

export interface PoiPlacement {
  type: string;
  /** Rectangle in the generator's own coordinates. */
  rect: Rect;
  rotation?: Rotation;
  seed: number;
  landscape?: Landscape;
  params?: Record<string, ParamValue>;
}

/** A placement as a full spec at ground height z (the rectangle is used as given, not clamped). */
export function placementSpec(p: PoiPlacement, z: number, shift: { x: number; y: number } = { x: 0, y: 0 }): PoiSpec | null {
  const t = poiType(p.type);
  if (!t) return null;
  const spec = newSpec(t, p.rect, z, { rotation: p.rotation ?? 0, seed: p.seed, landscape: p.landscape, params: p.params });
  spec.uid = `g${(p.seed >>> 0).toString(36)}${Math.round(p.rect.x0 / 64)}${Math.round(p.rect.y0 / 64)}`.replace(/-/g, 'm');
  spec.rect = { x0: p.rect.x0 + shift.x, y0: p.rect.y0 + shift.y, x1: p.rect.x1 + shift.x, y1: p.rect.y1 + shift.y };
  return spec;
}

/**
 * Wraps a terrain height function so it is flat at each POI's height inside its rectangle (blending back over
 * `margin`) and lowered in the POI's cuts (sea, pits, canals). `z` gives a POI's height from the unlevelled
 * terrain (its centre).
 */
export function levelForPois(height: (x: number, y: number) => number, placements: PoiPlacement[], margin = 192): { height: (x: number, y: number) => number; levels: number[]; weight: (x: number, y: number) => number } {
  const plans = placements.map((p) => {
    const z = Math.round(height((p.rect.x0 + p.rect.x1) / 2, (p.rect.y0 + p.rect.y1) / 2));
    const spec = placementSpec(p, z);
    const terrain = spec ? buildPoi(VmfDocument.empty(), spec).terrain : undefined;
    return { rect: p.rect, z, level: terrain?.paint !== false, cuts: terrain?.cuts ?? [] };
  });
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return {
    levels: plans.map((p) => p.z),
    /** How much the POIs set the height at a point (1 inside one, falling to 0 at the margin). */
    weight: (x, y) => {
      let w = 0;
      for (const p of plans) {
        if (!p.level) continue;
        const out = Math.max(p.rect.x0 - x, x - p.rect.x1, p.rect.y0 - y, y - p.rect.y1, 0);
        if (out < margin) w = Math.max(w, smooth(1 - out / margin));
      }
      return w;
    },
    height: (x, y) => {
      let h = height(x, y);
      for (const p of plans) {
        if (!p.level) continue;
        const out = Math.max(p.rect.x0 - x, x - p.rect.x1, p.rect.y0 - y, y - p.rect.y1, 0);
        if (out >= margin) continue;
        h += (p.z - h) * smooth(1 - out / margin);
      }
      for (const p of plans) for (const c of p.cuts) {
        const out = Math.max(c.rect.x0 - x, x - c.rect.x1, c.rect.y0 - y, y - c.rect.y1, 0);
        if (out >= 96) continue;
        const target = h + (c.z - h) * smooth(1 - out / 96);
        h = Math.min(h, target);
      }
      return h;
    },
  };
}

/** A point entity node (layout.ts has the same; not imported, layout.ts imports this module). */
function entity(doc: VmfDocument, classname: string, origin: Vector3, keys: Record<string, string>): KVNode {
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', classname));
  for (const [k, v] of Object.entries(keys)) e.items.push(new KVPair(k, v));
  e.items.push(new KVPair('origin', vecStr(origin)));
  return e;
}

/**
 * Builds a POI into a document: its func_detail (with the stored spec, so it can be edited in the editor
 * afterwards), its world brushes and its entities. `ground` gives the terrain height at a world point.
 */
export function addPoiToDoc(doc: VmfDocument, spec: PoiSpec, ground: (x: number, y: number) => number): void {
  const out = buildPoi(doc, spec, ground);
  for (const n of out.world) doc.world.items.push(n);
  const e = new KVNode('entity');
  e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', 'func_detail'),
    new KVPair(POI_KEY, encodePoi(spec)), new KVPair(POI_ID_KEY, spec.uid), ...out.detail);
  doc.roots.push(e, handleNode(doc, spec));
  for (const pe of out.entities) {
    if (pe.solids?.length) {
      const b = new KVNode('entity');
      b.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', pe.classname));
      for (const [k, v] of Object.entries(pe.keys)) b.items.push(new KVPair(k, v));
      b.items.push(new KVPair(POI_ID_KEY, spec.uid), ...pe.solids);
      doc.roots.push(b);
    } else {
      doc.roots.push(entity(doc, pe.classname, pe.origin ?? new Vector3(), { ...pe.keys, [POI_ID_KEY]: spec.uid }));
    }
  }
  if (out.waterLevel !== undefined && !doc.roots.some((r) => r.get('classname') === 'water_lod_control')) {
    const c = new Vector3((spec.rect.x0 + spec.rect.x1) / 2, (spec.rect.y0 + spec.rect.y1) / 2, out.waterLevel + 64).round();
    doc.roots.push(entity(doc, 'water_lod_control', c, { cheapwaterstartdistance: '2000', cheapwaterenddistance: '3500' }));
  }
}

/** POI types for a generated map's theme, by how well they read in an RTS skirmish. */
const THEME_TYPES: Record<'city' | 'rural', string[]> = {
  city: ['square', 'parking', 'market', 'playground', 'checkpoint', 'junkyard', 'construction', 'gasstation', 'basketball', 'rations', 'tankfarm'],
  rural: ['park', 'rebelcamp', 'farmstead', 'graveyard', 'thumper', 'crashsite', 'logging', 'lookout', 'junkyard', 'football', 'powernode'],
};

/**
 * Picks POIs for a generated map: free rectangles (from `free`, in generator coordinates) get a type of the
 * theme that fits them, larger rectangles first, at most `count`; the one nearest the map centre gets a
 * capture point.
 */
export function choosePois(free: Rect[], theme: 'city' | 'rural', count: number, seed: number, centre: { x: number; y: number }): PoiPlacement[] {
  const rng = new Rng(seed * 31 + 7);
  const types = THEME_TYPES[theme].map((id) => POI_TYPES.find((t) => t.id === id)!).filter(Boolean);
  const out: PoiPlacement[] = [];
  const used = new Set<string>();
  for (const r of [...free].sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))) {
    if (out.length >= count) break;
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    // Types whose minimum fits (either way round), ones not used yet first.
    const fits = types.filter((t) => (t.minSize[0] <= w && t.minSize[1] <= h) || (t.minSize[0] <= h && t.minSize[1] <= w));
    if (!fits.length) continue;
    const fresh = fits.filter((t) => !used.has(t.id));
    const t = rng.pick(fresh.length ? fresh : fits);
    used.add(t.id);
    const turned = !(t.minSize[0] <= w && t.minSize[1] <= h);
    const rotation = (turned ? rng.pick([90, 270]) : rng.pick([0, 180])) as Rotation;
    const [lw, lh] = turned ? [Math.min(h, t.maxSize[0]), Math.min(w, t.maxSize[1])] : [Math.min(w, t.maxSize[0]), Math.min(h, t.maxSize[1])];
    const [ww, wh] = turned ? [lh, lw] : [lw, lh];
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const rect = { x0: Math.round((cx - ww / 2) / 64) * 64, y0: Math.round((cy - wh / 2) / 64) * 64, x1: 0, y1: 0 };
    rect.x1 = rect.x0 + Math.floor(ww / 64) * 64;
    rect.y1 = rect.y0 + Math.floor(wh / 64) * 64;
    out.push({ type: t.id, rect, rotation, seed: rng.int(1, 99999), landscape: theme === 'city' ? 'city' : t.landscapes[0], params: {} });
  }
  // The capture point on the POI nearest the centre.
  let best = -1, bestD = Infinity;
  out.forEach((p, i) => {
    const d = Math.hypot((p.rect.x0 + p.rect.x1) / 2 - centre.x, (p.rect.y0 + p.rect.y1) / 2 - centre.y);
    if (d < bestD && POI_TYPES.find((t) => t.id === p.type)?.gameplay?.capture) { bestD = d; best = i; }
  });
  if (best >= 0) out[best].params = { ...out[best].params, capture: true };
  return out;
}

/**
 * POIs for *Generate map*: the largest free rectangles (free cells at least 3 cells from a base) in one half
 * of the layout get a POI each, mirrored through the centre so both players get the same (layouts are point
 * symmetric). Returns the placements (in layout units) and the cells they cover, which the generator clears.
 */
export function planLayoutPois(w: number, h: number, cell: number, isFree: (i: number) => boolean, isBase: (i: number) => boolean, theme: 'city' | 'rural', count: number, seed: number): { placements: PoiPlacement[]; cells: Set<number> } {
  const near = (x: number, y: number) => {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && isBase(ny * w + nx)) return true;
    }
    return false;
  };
  const ok = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = (h - 1 - y) * w + (w - 1 - x);
    // Both the cell and its mirror must be free, and the rectangle stays in the lower half (so pairs don't overlap).
    ok[y * w + x] = isFree(y * w + x) && isFree(m) && !near(x, y) && y < Math.floor(h / 2) ? 1 : 0;
  }
  const rects: Rect[] = [];
  const taken = new Uint8Array(w * h);
  const pairs = Math.max(1, Math.ceil(count / 2));
  for (let n = 0; n < pairs * 3 && rects.length < pairs * 2; n++) {
    // The largest free rectangle (by area, at least 4×4 cells), found by brute force over the small grid.
    let best: [number, number, number, number] | null = null, bestA = 15;
    for (let y0 = 0; y0 < h; y0++) for (let x0 = 0; x0 < w; x0++) {
      if (!ok[y0 * w + x0] || taken[y0 * w + x0]) continue;
      let maxX = w;
      for (let y1 = y0; y1 < h; y1++) {
        let x1 = x0;
        while (x1 < maxX && ok[y1 * w + x1] && !taken[y1 * w + x1]) x1++;
        maxX = Math.min(maxX, x1);
        if (maxX === x0) break;
        const a = (maxX - x0) * (y1 - y0 + 1);
        if (a > bestA) { bestA = a; best = [x0, y0, maxX - 1, y1]; }
      }
    }
    if (!best) break;
    const [x0, y0, x1, y1] = best;
    // Keep a one-cell margin round the POI (roads and buildings next to it).
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) if (x >= 0 && y >= 0 && x < w && y < h) taken[y * w + x] = 1;
    rects.push({ x0: x0 * cell + 32, y0: y0 * cell + 32, x1: (x1 + 1) * cell - 32, y1: (y1 + 1) * cell - 32 });
  }
  const chosen = choosePois(rects, theme, pairs, seed, { x: (w * cell) / 2, y: (h * cell) / 2 });
  const W = w * cell, H = h * cell;
  const placements: PoiPlacement[] = [];
  for (const p of chosen) {
    placements.push(p);
    // The mirror image: the rectangle turned through the map centre, the layout turned by 180°.
    const r = p.rect;
    placements.push({ ...p, rect: { x0: W - r.x1, y0: H - r.y1, x1: W - r.x0, y1: H - r.y0 }, rotation: (((p.rotation ?? 0) + 180) % 360) as Rotation });
  }
  const cells = new Set<number>();
  for (const p of placements) {
    for (let y = Math.floor(p.rect.y0 / cell); y < Math.ceil(p.rect.y1 / cell); y++) for (let x = Math.floor(p.rect.x0 / cell); x < Math.ceil(p.rect.x1 / cell); x++) cells.add(y * w + x);
  }
  return { placements: placements.slice(0, Math.max(count, 2)), cells };
}

/** Adds planned POIs to a finished generated map (world coordinates = layout + shift) and re-reads it. */
export function addPoisToMap(doc: VmfDocument, placements: PoiPlacement[], levels: number[], shift: { x: number; y: number }, layoutHeight: (x: number, y: number) => number): VmfDocument {
  placements.forEach((p, i) => {
    const spec = placementSpec(p, levels[i] ?? 0, shift);
    if (spec) addPoiToDoc(doc, spec, (x, y) => layoutHeight(x - shift.x, y - shift.y));
  });
  return VmfDocument.parse(doc.serialize());
}
