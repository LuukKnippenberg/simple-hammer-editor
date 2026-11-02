import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What the start screen shows about a map without loading it: its game mode, a height thumbnail, and whether an
 * autosave holds newer work. Pure text functions, so the tests can feed them small VMFs.
 */

export type MapMode = 'Mission' | 'Overrun' | `Annihilation ${number}p` | 'Annihilation' | 'No mode';

/** The mode from the name prefix and the content: sp_ (or a mission flowchart), or_ (or an overrun_manager), hlw_. */
export function mapMode(name: string, text: string, hasMission = false): MapMode {
  const n = name.toLowerCase();
  if (n.startsWith('sp_') || hasMission) return 'Mission';
  if (n.startsWith('or_') || /"classname"\s+"overrun_manager"/i.test(text)) return 'Overrun';
  if (n.startsWith('hlw_')) {
    const starts = text.match(/"classname"\s+"info_start_wars"/gi)?.length ?? 0;
    return starts ? `Annihilation ${starts}p` : 'Annihilation';
  }
  return 'No mode';
}

/** One `solid` or `entity` block of a VMF: its kind, id and full text. */
export interface VmfBlock {
  kind: 'solid' | 'entity';
  id: string;
  text: string;
}

/**
 * The world's solids and the entities of a VMF, keyed `solid:<id>` / `entity:<id>`. A brush entity's block holds
 * its solids, so they are not listed again on their own.
 */
export function vmfBlocks(text: string): Map<string, VmfBlock> {
  const out = new Map<string, VmfBlock>();
  const lines = text.split(/\r?\n/);
  let depth = 0, open: { kind: VmfBlock['kind']; depth: number; start: number; id: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '{') depth++;
    else if (line === '}') {
      depth--;
      if (open && depth === open.depth) {
        out.set(`${open.kind}:${open.id}`, { kind: open.kind, id: open.id, text: lines.slice(open.start, i + 1).join('\n') });
        open = null;
      }
    } else if (!open && (line === 'solid' || line === 'entity')) {
      open = { kind: line, depth, start: i, id: '' };
    } else if (open && !open.id && depth === open.depth + 1) {
      const id = /^"id"\s+"([^"]*)"/.exec(line);
      if (id) open.id = id[1];
    }
  }
  return out;
}

export interface VmfDiff {
  added: { solids: number; entities: number };
  deleted: number;
  changed: number;
  /** Every added, deleted and changed block. */
  total: number;
}

/** What `after` adds, deletes and changes compared with `before` (by block id and text). */
export function diffVmf(before: string, after: string): VmfDiff {
  const a = vmfBlocks(before), b = vmfBlocks(after);
  const diff: VmfDiff = { added: { solids: 0, entities: 0 }, deleted: 0, changed: 0, total: 0 };
  for (const [key, block] of b) {
    const old = a.get(key);
    if (!old) block.kind === 'solid' ? diff.added.solids++ : diff.added.entities++;
    else if (old.text !== block.text) diff.changed++;
  }
  for (const key of a.keys()) if (!b.has(key)) diff.deleted++;
  diff.total = diff.added.solids + diff.added.entities + diff.deleted + diff.changed;
  return diff;
}

/** "+ 12 brushes · + 3 entities · changed 14 · deleted 3" (empty parts left out). */
export function diffSummary(d: VmfDiff): string {
  return [
    d.added.solids && `+ ${d.added.solids} brush${d.added.solids === 1 ? '' : 'es'}`,
    d.added.entities && `+ ${d.added.entities} entit${d.added.entities === 1 ? 'y' : 'ies'}`,
    d.changed && `changed ${d.changed}`,
    d.deleted && `deleted ${d.deleted}`,
  ].filter(Boolean).join(' · ');
}

export const THUMB_W = 43;
export const THUMB_H = 28;

/** Faces with these materials are hidden in game: a sky shell would otherwise cover the whole thumbnail. */
const TOOL_MATERIAL = /^TOOLS\//i;
const PLANE = /"plane"\s+"\(([^)]*)\)\s*\(([^)]*)\)\s*\(([^)]*)\)"/;
const MATERIAL = /"material"\s+"([^"]*)"/;

/**
 * A top-down height map of the map's visible brushes: THUMB_W × THUMB_H cells, each 0..255 from low to high, or -1
 * where nothing is. Each brush fills its bounding box with its top height, which is close enough for a thumbnail.
 */
export function heightThumb(text: string): number[] {
  const boxes: [number, number, number, number, number][] = [];
  let points: number[][] = [], visible = false, plane: number[][] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === 'solid') {
      points = [];
      visible = false;
    }
    const p = PLANE.exec(line);
    if (p) plane = [p[1], p[2], p[3]].map((s) => s.trim().split(/\s+/).map(Number));
    const m = MATERIAL.exec(line);
    if (m && plane) {
      points.push(...plane);
      if (!TOOL_MATERIAL.test(m[1])) visible = true;
      plane = null;
    }
    if (line === 'editor' && points.length && visible) {
      // A solid's own "editor" block follows its sides: the brush is complete.
      const xs = points.map((q) => q[0]), ys = points.map((q) => q[1]), zs = points.map((q) => q[2]);
      boxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), Math.max(...zs)]);
      points = [];
    }
  }
  const cells = new Array<number>(THUMB_W * THUMB_H).fill(-1);
  if (!boxes.length) return cells;
  const minX = Math.min(...boxes.map((b) => b[0])), minY = Math.min(...boxes.map((b) => b[1]));
  const maxX = Math.max(...boxes.map((b) => b[2])), maxY = Math.max(...boxes.map((b) => b[3]));
  const scale = Math.max((maxX - minX) / THUMB_W, (maxY - minY) / THUMB_H) || 1;
  // Centre the map in the thumbnail.
  const offX = (THUMB_W - (maxX - minX) / scale) / 2, offY = (THUMB_H - (maxY - minY) / scale) / 2;
  const top = new Array<number>(cells.length).fill(-Infinity);
  for (const [x0, y0, x1, y1, z] of boxes) {
    const c0 = Math.floor((x0 - minX) / scale + offX), c1 = Math.min(THUMB_W - 1, Math.ceil((x1 - minX) / scale + offX) - 1);
    // Rows run north to south: +y is up in the picture.
    const r0 = Math.floor((maxY - y1) / scale + offY), r1 = Math.min(THUMB_H - 1, Math.ceil((maxY - y0) / scale + offY) - 1);
    for (let r = Math.max(0, r0); r <= Math.max(r0, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.max(c0, c1); c++) top[r * THUMB_W + c] = Math.max(top[r * THUMB_W + c], z);
    }
  }
  const filled = top.filter((z) => z > -Infinity);
  const lo = Math.min(...filled), hi = Math.max(...filled);
  return top.map((z) => (z === -Infinity ? -1 : hi > lo ? Math.round(((z - lo) / (hi - lo)) * 255) : 128));
}

export interface MapFile {
  id: string;
  name: string;
  /** Last modified, ms since the epoch. */
  mtime: number;
}

/** Newest first; equal times by name, so the order is stable. */
export function newestFirst<T extends MapFile>(maps: T[]): T[] {
  return [...maps].sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
}

export const AUTOSAVE_SUFFIX = '.autosave.vmf';

/** The map name an autosave belongs to: `sp_sofia.autosave.vmf` → `sp_sofia.vmf`. */
export function autosaveOf(name: string): string | null {
  return name.toLowerCase().endsWith(AUTOSAVE_SUFFIX) ? name.slice(0, -AUTOSAVE_SUFFIX.length) + '.vmf' : null;
}

export interface RecoverOffer {
  /** The map the work belongs to (`sp_sofia.vmf`). */
  name: string;
  autosave: MapFile;
  /** The saved file the editor would open, or null when the map was never saved. */
  saved: MapFile | null;
}

/**
 * Autosaves worth offering back: newer than the map's saved file, or of a map that was never saved. The saved file
 * is the editor's own copy in maps/ first (saves go there), else the game's.
 */
export function recoverOffers(autosaves: MapFile[], maps: MapFile[]): RecoverOffer[] {
  const out: RecoverOffer[] = [];
  for (const autosave of autosaves) {
    const name = autosaveOf(autosave.name);
    if (!name) continue;
    const same = maps.filter((m) => m.name.toLowerCase() === name.toLowerCase());
    const saved = same.find((m) => m.id.startsWith('repo:')) ?? same[0] ?? null;
    if (!saved || autosave.mtime > saved.mtime) out.push({ name, autosave, saved });
  }
  return out.sort((a, b) => b.autosave.mtime - a.autosave.mtime);
}

/** One row of the setup check. */
export interface SetupRow {
  id: 'install' | 'compiler' | 'navmesh';
  ok: boolean;
  detail: string;
  /** The folder that was checked, if any. */
  dir: string | null;
}

export const COMPILE_TOOLS = ['vbsp.exe', 'vvis.exe', 'vrad.exe'];

/**
 * Game install, map compiler and navmesh builder, checked against the same paths the compile uses
 * (`install` for the game and srcds, `sdkBinDir` for vbsp, vvis and vrad).
 */
export function setupCheck(cfg: { install: string | null; installs: { name: string; dir: string }[]; mod: string; sdkBinDir: string | null }): SetupRow[] {
  const install = cfg.install && existsSync(join(cfg.install, cfg.mod)) ? cfg.install : null;
  const installName = cfg.installs.find((i) => i.dir === install)?.name ?? install;
  const tools = cfg.sdkBinDir ? COMPILE_TOOLS.filter((t) => !existsSync(join(cfg.sdkBinDir!, t))) : COMPILE_TOOLS;
  const srcds = install && existsSync(join(install, 'srcds.exe'));
  return [
    {
      id: 'install', ok: !!install, dir: cfg.install,
      detail: install ? `${installName} · assets, entity list and where maps are installed` : 'No Lambda Wars install found',
    },
    {
      id: 'compiler', ok: !tools.length, dir: cfg.sdkBinDir,
      detail: !tools.length ? 'vbsp, vvis and vrad from the Alien Swarm SDK'
        : cfg.sdkBinDir ? `${tools.join(', ')} missing in ${cfg.sdkBinDir}` : 'Alien Swarm SDK not found',
    },
    {
      id: 'navmesh', ok: !!srcds, dir: install,
      detail: srcds ? 'srcds from the game install, for walkable areas' : install ? `srcds.exe missing in ${install}` : 'Needs the game install',
    },
  ];
}

/** Modified time of a file in ms, or 0 when it is gone. */
export function mtimeOf(file: string): number {
  try { return statSync(file).mtimeMs; } catch { return 0; }
}
