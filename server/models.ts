import type { AssetFS } from './assets.ts';

/** What the model picker needs to know of a model without loading its meshes. */
export interface ModelEntry {
  path: string;
  /** Compiled with $staticprop and without physics prop_data: vbsp keeps it as prop_static. */
  static: boolean;
  /** Has a physics prop_data block (breakable or physics-only), which vbsp refuses for prop_static. */
  physics: boolean;
  skins: number;
  /** Hull size in units (x, y, z). */
  size: [number, number, number];
  materials: number;
}

/** Reads the header fields the picker filters on; the same static-prop rules as src/assets/mdl.ts. */
export function modelEntry(path: string, buf: Buffer): ModelEntry | null {
  if (buf.length < 240 || buf.readUInt32LE(0) !== 0x54534449) return null; // IDST
  const f = (o: number) => buf.readFloatLE(o);
  const flags = buf.readInt32LE(152);
  const pd = buf.indexOf('prop_data');
  const physics = pd >= 0 && !/"allowstatic"\s*"1"/i.test(buf.toString('latin1', pd, pd + 400));
  const size: [number, number, number] = [f(116) - f(104), f(120) - f(108), f(124) - f(112)].map((v) => Math.round(Math.abs(v) || 0)) as [number, number, number];
  return {
    path, static: (flags & 0x10) !== 0 && !physics, physics,
    skins: Math.max(1, buf.readInt32LE(224)), size, materials: buf.readInt32LE(204),
  };
}

/** Every .mdl the game can load, read once (a few seconds) and kept by the dev server. */
export function modelIndex(assets: AssetFS): ModelEntry[] {
  const out: ModelEntry[] = [];
  for (const path of assets.list('models', '.mdl')) {
    const buf = assets.read(path);
    // Most models are read only here; keep them out of the file cache.
    assets.forget(path);
    const e = buf && modelEntry(path, buf);
    if (e) out.push(e);
  }
  return out;
}
