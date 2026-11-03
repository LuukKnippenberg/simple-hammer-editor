import { noiseWeight, paintLayer, type BlendDef, type BlendEdge, type NoiseLayer } from './multiblend.ts';

/**
 * The material blender's preview ground: a flat grid of MultiBlend weights (four per vertex, like a displacement's
 * `multiblend` rows) that the dialog fills from a fixed sample, the Ground tool's noise, one band per layer, or
 * scratch brushing. Nothing here touches the map.
 */

export interface PreviewGrid {
  cols: number;
  rows: number;
  /** World position of vertex 0 (the -x, -y corner) and the spacing between vertices. */
  x0: number;
  y0: number;
  step: number;
  /** Slot weights per vertex (slots 1–3, then 4 always 1), as writeBlendRows stores them. */
  weights: Float32Array;
}

/** Preview patch size: 1536 units across, deep enough to fill the tilted view. */
export const PREVIEW_W = 1536;
export const PREVIEW_D = 1280;
/** Vertex spacing: 32 units, a power-4 displacement on a 512 patch (the engine blends linearly in between). */
export const PREVIEW_STEP = 32;

export function previewGrid(): PreviewGrid {
  const cols = PREVIEW_W / PREVIEW_STEP + 1, rows = PREVIEW_D / PREVIEW_STEP + 1;
  const weights = new Float32Array(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) weights[i * 4 + 3] = 1;
  return { cols, rows, x0: -PREVIEW_W / 2, y0: -PREVIEW_D / 2, step: PREVIEW_STEP, weights };
}

export const vertexX = (g: PreviewGrid, i: number) => g.x0 + (i % g.cols) * g.step;
export const vertexY = (g: PreviewGrid, i: number) => g.y0 + Math.floor(i / g.cols) * g.step;

/** Sets every vertex's slot weights from `fn(x, y)` → [slot 1, slot 2, slot 3]. */
function fill(g: PreviewGrid, fn: (x: number, y: number) => number[]): void {
  for (let i = 0; i < g.cols * g.rows; i++) {
    const w = fn(vertexX(g, i), vertexY(g, i));
    for (let k = 0; k < 3; k++) g.weights[i * 4 + k] = Math.min(1, Math.max(0, w[k] ?? 0));
    g.weights[i * 4 + 3] = 1;
  }
}

/** 1 inside `r` of a point, falling to 0 over `ramp` units outside it: what a few brush strokes leave. */
const ramp = (d: number, r: number, width: number) => Math.min(1, Math.max(0, (r + width - d) / width));

function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** Layer 1's stroke across the patch, as world points. */
const STROKE = [[-640, 120], [-360, 260], [-80, 60], [220, 180], [520, -40], [680, 160]];
/** Layer 2's patches: x, y, radius. */
const SPOTS = [[260, 420, 150], [-460, 420, 110], [520, -330, 120]];

/**
 * The fixed sample: a painted stroke (layer 1), three patches (layer 2) and a band along the near edge (layer 3),
 * each fading out over a few vertices so the Edge setting shows. Slots past the blend's layers stay unpainted.
 */
export function sampleWeights(g: PreviewGrid, layers: number): void {
  fill(g, (x, y) => {
    let stroke = Infinity;
    for (let k = 1; k < STROKE.length; k++) stroke = Math.min(stroke, segmentDistance(x, y, STROKE[k - 1][0], STROKE[k - 1][1], STROKE[k][0], STROKE[k][1]));
    const spots = Math.max(...SPOTS.map(([sx, sy, r]) => ramp(Math.hypot(x - sx, y - sy), r, 120)));
    const band = ramp(y - (-430 + Math.sin(x / 170) * 50), 0, 140);
    return [ramp(stroke, 90, 150), spots, band].map((w, k) => (k < layers - 1 ? w : 0));
  });
}

/** The Ground tool's noise fill (its coverage and patch size per layer). */
export function noiseWeights(g: PreviewGrid, noise: NoiseLayer[], layers: number): void {
  fill(g, (x, y) => [0, 1, 2].map((k) => {
    const n = noise.find((l) => l.layer === k + 1);
    return n && k < layers - 1 ? noiseWeight(x, y, n) : 0;
  }));
}

/** One band per layer across the patch, base first, to compare sizes and rotations side by side. */
export function splitWeights(g: PreviewGrid, layers: number): void {
  const band = (x: number) => Math.min(layers - 1, Math.floor(((x - g.x0) / PREVIEW_W) * layers));
  fill(g, (x) => [0, 1, 2].map((k) => (band(x) === k + 1 ? 1 : 0)));
}

/** One dab of the scratch brush: paints `layer` (0 erases back to the base) with the Ground tool's falloff. */
export function paintDab(g: PreviewGrid, x: number, y: number, radius: number, layer: number, strength: number): void {
  for (let i = 0; i < g.cols * g.rows; i++) {
    const t = ((vertexX(g, i) - x) ** 2 + (vertexY(g, i) - y) ** 2) / (radius * radius);
    if (t < 1) paintLayer(g.weights, i, layer, (1 - t) * (1 - t) * strength);
  }
}

/** Alpha of each edge's softness map (measured from the game's VTFs): the shader shows a layer from 1 − alpha. */
export const EDGE_ALPHA: Record<BlendEdge, number> = { crisp: 0, medium: 0.41, soft: 0.87 };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much each slot shows at a vertex, as the shader works it out (ComputeMultiBlendFactor) for ground textures
 * without alpha: slot k shows smoothstep(1 − softness alpha, 1, weight) of what the earlier slots left.
 */
export function shownShares(def: BlendDef, w: Float32Array, i: number): number[] {
  let remaining = 1;
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    const layer = def.layers[k + 1];
    const a = w[i * 4 + k];
    const sa = layer ? EDGE_ALPHA[layer.edge ?? 'soft'] : 0;
    const f = !layer || a <= 0 ? 0 : sa > 0 ? smoothstep(1 - sa, 1, a) : a >= 1 ? 1 : 0;
    const r = Math.min(remaining, f);
    out.push(r);
    remaining -= r;
  }
  out.push(remaining);
  return out;
}

/**
 * Line segments [x0, y0, x1, y1, …] around where `layer` (0 = base) shows more than half, traced on the vertex
 * grid (marching squares). Crisp layers only show where fully painted, so their outline hugs the painted vertices.
 */
export function layerOutline(g: PreviewGrid, def: BlendDef, layer: number): number[] {
  const slot = layer === 0 ? 3 : layer - 1;
  const n = g.cols * g.rows;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = shownShares(def, g.weights, i)[slot] - 0.5;
  const out: number[] = [];
  const lerp = (a: number, b: number) => a / (a - b);
  for (let r = 0; r < g.rows - 1; r++) {
    for (let c = 0; c < g.cols - 1; c++) {
      const i = r * g.cols + c;
      // Corners counter-clockwise from the -x, -y one, and the edge crossings between them.
      const val = [v[i], v[i + 1], v[i + 1 + g.cols], v[i + g.cols]];
      const pos = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
      const cross: number[][] = [];
      for (let e = 0; e < 4; e++) {
        const a = val[e], b = val[(e + 1) % 4];
        if ((a >= 0) === (b >= 0)) continue;
        const t = lerp(a, b), [ax, ay] = pos[e], [bx, by] = pos[(e + 1) % 4];
        cross.push([g.x0 + (ax + (bx - ax) * t) * g.step, g.y0 + (ay + (by - ay) * t) * g.step]);
      }
      // Two crossings: one segment; four (a saddle): two.
      for (let k = 0; k + 1 < cross.length; k += 2) out.push(cross[k][0], cross[k][1], cross[k + 1][0], cross[k + 1][1]);
    }
  }
  return out;
}
