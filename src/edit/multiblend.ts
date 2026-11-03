import { KVNode } from '../vmf/keyvalues.ts';

/**
 * MultiBlend terrain: up to four textures on one displacement, mixed per vertex. The engine shader
 * (stdshaders/multiblend_ps30.fxc, common_deferred_fxc.h) walks the slots in order: slot 1 takes as much
 * as its weight allows, then slot 2, then slot 3, and slot 4 gets whatever is left. So with all weights
 * at 0 a vertex shows slot 4, which the editor calls the base layer.
 *
 * Editor layers map to slots like this: layer 0 (base) → slot 4, layers 1..3 → slots 1..3.
 * VMF rows per vertex: `multiblend` (4 weights), `alphablend` (4, unused here), `multiblend_color_0..3` (RGB tints).
 */

export const MULTIBLEND_CHANNELS = 4;

/** Folder (under materials/) for blend materials made in the editor; they live in the repo's content/ folder. */
export const BLEND_FOLDER = 'she/blend';

/** Softness map shared by the shipped Lambda Wars multiblends; its alpha sets how soft the edges are. */
export const DEFAULT_SPEC = 'nature/forest_grass_10a_spec';

/** How soft a painted layer's edge is: picks its softness map ($spectextureN). */
export type BlendEdge = 'crisp' | 'medium' | 'soft';

export const BLEND_EDGES: BlendEdge[] = ['crisp', 'medium', 'soft'];

/**
 * The softness map each edge writes. The shader shows a layer from (1 − map alpha) of paint upwards: Soft (alpha
 * 0.87) from 13%, Medium (0.41) from 59%, Crisp (no map: the engine binds black) only where fully painted.
 */
export const EDGE_SPECS: Record<BlendEdge, string | null> = { crisp: null, medium: 'nature/forest_grass_10b_spec', soft: DEFAULT_SPEC };

/** The edge a softness map gives; other maps (a few game blends use nature/mud_spec_01) count as Soft. */
export function edgeFromSpec(spec: string | undefined): BlendEdge {
  if (!spec) return 'crisp';
  return spec.toLowerCase() === EDGE_SPECS.medium ? 'medium' : 'soft';
}

export interface BlendLayer {
  texture: string;
  /** Texture size ($scaleN divides the texture coordinates: 2 is twice as large). */
  scale: number;
  /** Degrees ($rotationN), around the texture's centre. */
  rotation: number;
  /** Layers 1–3 only (the base has none); missing means Soft, what the editor wrote before edges existed. */
  edge?: BlendEdge;
}

export interface BlendDef {
  /** File name below materials/she/blend/, without extension. */
  name: string;
  /** Base layer first, then up to three layers painted on top. */
  layers: BlendLayer[];
  /** Detail sprites (%detailtype), e.g. grass01b. */
  detailtype?: string;
}

export const materialForBlend = (name: string) => `${BLEND_FOLDER}/${name}`.toUpperCase();

export function safeBlendName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'blend';
}

/**
 * The VMT text for a blend definition: only the keys the MultiBlend shader reads ($basetextureN, $spectextureN,
 * $scaleN, $rotationN, $fow) plus the compile keys vbsp reads. The base is slot 4 and keeps the Soft map (it only
 * adds shine there); layers 1–3 are slots 1–3. Unused slots repeat the base without a softness map and are never painted.
 */
export function blendVmt(def: BlendDef): string {
  const [base, ...top] = def.layers;
  const slots: { l: BlendLayer; spec: string | null }[] = [0, 1, 2].map((i) => top[i]
    ? { l: top[i], spec: EDGE_SPECS[top[i].edge ?? 'soft'] }
    : { l: base, spec: null });
  slots.push({ l: base, spec: DEFAULT_SPEC });
  const q = (k: string, v: string | number) => `\t"${k}" "${v}"\n`;
  let out = '"MultiBlend"\n{\n' + q('%keywords', 'wars');
  slots.forEach(({ l, spec }, i) => {
    const n = i ? String(i + 1) : '';
    out += q(`$basetexture${n}`, l.texture) + (spec ? q(`$spectexture${n}`, spec) : '') + q(`$scale${n}`, l.scale.toFixed(2)) + q(`$rotation${n}`, l.rotation.toFixed(1));
  });
  out += q('%tooltexture', base.texture) + q('$fow', '_rt_fog_of_war');
  if (def.detailtype) out += q('%detailtype', def.detailtype);
  return out + '}\n';
}

/** Reads a blend definition back from a MultiBlend VMT's parameters (slot order → layer order). */
export function blendFromParams(name: string, p: Map<string, string>): BlendDef {
  const slot = (i: number): BlendLayer => {
    const n = i ? String(i + 1) : '';
    return { texture: p.get(`$basetexture${n}`) ?? '', scale: parseFloat(p.get(`$scale${n}`) ?? '1') || 1, rotation: parseFloat(p.get(`$rotation${n}`) ?? '0') || 0 };
  };
  const base = slot(3);
  // Unused slots are copies of the base (see blendVmt). Only trailing ones are dropped: layer i must stay
  // slot i, and a layer may reuse the base texture at another size or angle to break up its tiling.
  const same = (l: BlendLayer) => !l.texture || (l.texture.toLowerCase() === base.texture.toLowerCase() && l.scale === base.scale && l.rotation === base.rotation);
  const top = [0, 1, 2].map((i) => ({ ...slot(i), edge: edgeFromSpec(p.get(`$spectexture${i ? i + 1 : ''}`)) }));
  while (top.length && same(top[top.length - 1])) top.pop();
  const layers = [base, ...top];
  const detailtype = p.get('%detailtype');
  return detailtype ? { name, layers, detailtype } : { name, layers };
}

/** Moves vertex `i`'s weights towards showing `layer` (0 = base) by `f` (0..1). */
export function paintLayer(w: Float32Array, i: number, layer: number, f: number): void {
  const o = i * 4;
  if (layer <= 0) {
    for (let k = 0; k < 3; k++) w[o + k] -= w[o + k] * f;
  } else {
    const s = Math.min(3, layer) - 1;
    // Earlier slots win over later ones, so they have to give way.
    for (let k = 0; k < s; k++) w[o + k] -= w[o + k] * f;
    w[o + s] += (1 - w[o + s]) * f;
  }
  w[o + 3] = 1;
}

/** How much each slot shows at a vertex, with the engine's ordering (no texture alphas: soft blend). */
export function slotShares(w: Float32Array, i: number): number[] {
  let remaining = 1;
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    const r = Math.min(remaining, Math.max(0, Math.min(1, w[i * 4 + k])));
    out.push(r);
    remaining -= r;
  }
  out.push(remaining);
  return out;
}

export function readBlendRows(disp: KVNode, size: number): Float32Array {
  const out = new Float32Array(size * size * 4);
  const node = disp.child('multiblend');
  if (!node) return out;
  for (let r = 0; r < size; r++) {
    const vals = (node.get('row' + r) ?? '').trim().split(/\s+/);
    for (let k = 0; k < size * 4 && k < vals.length; k++) out[r * size * 4 + k] = parseFloat(vals[k]) || 0;
  }
  return out;
}

function setRows(disp: KVNode, name: string, size: number, row: (r: number) => string): void {
  let block = disp.child(name);
  if (!block) {
    block = new KVNode(name);
    // Keep Hammer's order: the multiblend blocks follow allowed_verts.
    disp.items.push(block);
  }
  for (let r = 0; r < size; r++) block.set('row' + r, row(r));
}

/** Writes the weights plus the companion rows VBSP expects (flat alphablend, white tints). */
export function writeBlendRows(disp: KVNode, size: number, w: Float32Array): void {
  const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
  setRows(disp, 'multiblend', size, (r) => Array.from(w.subarray(r * size * 4, (r + 1) * size * 4), fmt).join(' '));
  if (!disp.child('alphablend')) setRows(disp, 'alphablend', size, () => Array(size * 4).fill('0').join(' '));
  for (let c = 0; c < MULTIBLEND_CHANNELS; c++) {
    if (!disp.child(`multiblend_color_${c}`)) setRows(disp, `multiblend_color_${c}`, size, () => Array(size * 3).fill('1').join(' '));
  }
}

/** Removes the multiblend rows (when a patch goes back to a two-texture blend). */
export function clearBlendRows(disp: KVNode): void {
  const drop = new Set(['multiblend', 'alphablend', ...Array.from({ length: MULTIBLEND_CHANNELS }, (_, c) => `multiblend_color_${c}`)]);
  disp.items = disp.items.filter((it) => !(it instanceof KVNode && drop.has(it.name.toLowerCase())));
}

// --- Noise --------------------------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal noise in 0..1, features roughly `scale` units across. Depends on world position only. */
export function fbm(x: number, y: number, scale: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1 / scale;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * f, y * f, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

export interface NoiseLayer {
  /** Editor layer 1..3. */
  layer: number;
  /** Share of the ground it covers, 0..1. */
  coverage: number;
  /** Patch size in units. */
  scale: number;
  seed: number;
}

/** Fractal noise is bunched around 0.5; this maps a coverage to the matching threshold. */
function threshold(coverage: number): number {
  const c = Math.min(1, Math.max(0, coverage));
  // Approximate inverse of the fbm value distribution (close to a normal with sd ≈ 0.12 around 0.5).
  const z = c <= 0 ? 4 : c >= 1 ? -4 : -Math.sqrt(2) * erfinv(2 * c - 1);
  return 0.5 + z * 0.12;
}

function erfinv(x: number): number {
  const a = 0.147, ln = Math.log(1 - x * x);
  const t = 2 / (Math.PI * a) + ln / 2;
  return Math.sign(x) * Math.sqrt(Math.sqrt(t * t - ln / a) - t);
}

/** Weight of one noise layer at a point: 0 outside its patches, rising to 1 over a soft edge. */
export function noiseWeight(x: number, y: number, n: NoiseLayer, softness = 0.06): number {
  if (n.coverage <= 0) return 0;
  const v = fbm(x, y, n.scale, n.seed);
  const t = threshold(n.coverage);
  const s = Math.min(1, Math.max(0, (v - (t - softness)) / (2 * softness)));
  return s * s * (3 - 2 * s);
}
