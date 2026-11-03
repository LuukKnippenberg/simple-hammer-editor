import {
  BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Vector3, type Box3,
} from 'three';
import type { Editor } from '../editor.ts';

/** Wireframe colours of the quad view's 2D panes (QuadSpec B). */
export const WIRE = {
  brush: '#d9d6cf',
  detail: '#8fb8d8',
  entity: '#5fd2c8',
  selection: '#f3a944',
  handle: '#ffffff',
  axis: '#6b4f2a',
  gridMinor: '#1c2024',
  gridMajor: '#2e3338',
  grid1024: '#4a4f55',
  camera: '#f06fd0',
};

/** Draw order in the 2D panes: grid, brushes, entities, then the selection over everything. */
const ORDER = { grid: 0, brush: 1, detail: 1, entity: 2, selection: 3, overlay: 4 };

/** A line material for the 2D panes: exact colours (no tone mapping, fog or depth test). */
export function wireMaterial(color: string): LineBasicMaterial {
  return new LineBasicMaterial({ color: new Color(color), depthTest: false, depthWrite: false, fog: false, toneMapped: false });
}

/** Line segments from end point pairs; `order` places them in the pane's draw order. */
export function lineSegments(points: ArrayLike<number>, color: string, order: keyof typeof ORDER): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(points instanceof Float32Array ? points : new Float32Array(points), 3));
  const line = new LineSegments(geo, wireMaterial(color));
  line.frustumCulled = false;
  line.renderOrder = ORDER[order];
  return line;
}

/** Frees the geometry and materials of everything in a group and empties it. */
export function clearGroup(g: Group): void {
  for (const o of g.children) {
    const m = o as Mesh;
    m.geometry?.dispose();
    (m.material as MeshBasicMaterial | undefined)?.dispose();
  }
  g.clear();
}

/** The 12 edges of a box as end point pairs, appended to `out`. */
export function boxEdges(b: Box3, out: number[]): void {
  const { min: a, max: z } = b;
  const c = [[a.x, a.y, a.z], [z.x, a.y, a.z], [z.x, z.y, a.z], [a.x, z.y, a.z], [a.x, a.y, z.z], [z.x, a.y, z.z], [z.x, z.y, z.z], [a.x, z.y, z.z]];
  for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) out.push(...c[i], ...c[j]);
}

/** Joins many edge arrays into one. */
function join(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Brush edges: world brushes grey, brushes of entities (detail, func_*) blue. Shared by all 2D panes. */
export function buildBrushLines(editor: Editor, into: Group): void {
  clearGroup(into);
  const world: Float32Array[] = [], detail: Float32Array[] = [];
  for (const [s, edges] of editor.world.visibleEdges()) (s.entity ? detail : world).push(edges);
  into.add(lineSegments(join(world), WIRE.brush, 'brush'), lineSegments(join(detail), WIRE.detail, 'detail'));
}

/** Point entities as boxes: props blue, other entities cyan, following the Props and Entities layers. */
export function buildEntityLines(editor: Editor, into: Group): void {
  clearGroup(into);
  const props: number[] = [], ents: number[] = [];
  const er = editor.entities;
  for (const e of editor.doc.entities) {
    if (e.solids.length || !e.origin || editor.hidden.has(e)) continue;
    const prop = e.classname.startsWith('prop_');
    if (prop ? !er.showProps : !er.showMarkers) continue;
    boxEdges(er.entityBounds(e), prop ? props : ents);
  }
  into.add(lineSegments(props, WIRE.detail, 'detail'), lineSegments(ents, WIRE.entity, 'entity'));
}

/** The selection in amber: its brushes' edges and its point entities' boxes. */
export function buildSelectionLines(editor: Editor, into: Group): void {
  clearGroup(into);
  const sel = editor.selection;
  const parts: Float32Array[] = [];
  for (const s of sel.allSolids()) { const e = editor.world.solidEdges(s); if (e) parts.push(e); }
  const boxes: number[] = [];
  for (const e of sel.pointEntities()) boxEdges(editor.entities.entityBounds(e), boxes);
  parts.push(new Float32Array(boxes));
  into.add(lineSegments(join(parts), WIRE.selection, 'selection'));
}

/** What a 2D pane looks along: screen right is `u`, screen up is `v`, both world axes (0 = x, 1 = y, 2 = z). */
export interface PaneAxes { u: 0 | 1 | 2; v: 0 | 1 | 2; w: 0 | 1 | 2 }

/** The point with coordinates `a` along u, `b` along v and `c` along the hidden axis. */
export function axisPoint(ax: PaneAxes, a: number, b: number, c = 0): Vector3 {
  const p = new Vector3();
  p.setComponent(ax.u, a).setComponent(ax.v, b).setComponent(ax.w, c);
  return p;
}

/** The grid step that is drawn: the real grid, doubled until lines are at least 4 px apart (QuadSpec C). */
export function drawnStep(grid: number, ppu: number): number {
  let step = grid;
  while (step * ppu < 4) step *= 2;
  return step;
}

/**
 * Grid lines over the visible part of a pane: one every drawn step, brighter every 64 and every 1024 units,
 * and the axis lines through 0 in dim amber.
 */
export function buildGridLines(ax: PaneAxes, cu: number, cv: number, ppu: number, w: number, h: number, grid: number, into: Group): void {
  clearGroup(into);
  const step = drawnStep(grid, ppu);
  const u0 = cu - w / 2 / ppu, u1 = cu + w / 2 / ppu, v0 = cv - h / 2 / ppu, v1 = cv + h / 2 / ppu;
  const sets: Record<'minor' | 'major' | 'k1024' | 'axis', number[]> = { minor: [], major: [], k1024: [], axis: [] };
  const kind = (x: number) => (x === 0 ? 'axis' : x % 1024 === 0 ? 'k1024' : x % 64 === 0 ? 'major' : 'minor');
  for (let x = Math.ceil(u0 / step) * step; x <= u1; x += step) {
    const a = axisPoint(ax, x, v0), b = axisPoint(ax, x, v1);
    sets[kind(x)].push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  for (let y = Math.ceil(v0 / step) * step; y <= v1; y += step) {
    const a = axisPoint(ax, u0, y), b = axisPoint(ax, u1, y);
    sets[kind(y)].push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  into.add(
    lineSegments(sets.minor, WIRE.gridMinor, 'grid'), lineSegments(sets.major, WIRE.gridMajor, 'grid'),
    lineSegments(sets.k1024, WIRE.grid1024, 'grid'), lineSegments(sets.axis, WIRE.axis, 'grid'),
  );
}

/** The 8 resize handles around a rectangle in (u, v), as [u, v] in the order TL, T, TR, R, BR, B, BL, L. */
export function handlePoints(u0: number, v0: number, u1: number, v1: number): [number, number][] {
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  return [[u0, v1], [um, v1], [u1, v1], [u1, vm], [u1, v0], [um, v0], [u0, v0], [u0, vm]];
}

/** White squares with a dark rim for the handles; `half` is half a square's size in world units. */
export function buildHandles(ax: PaneAxes, points: [number, number][], half: number, into: Group): void {
  const tris: number[] = [], rim: number[] = [];
  for (const [a, b] of points) {
    const c = [axisPoint(ax, a - half, b - half), axisPoint(ax, a + half, b - half), axisPoint(ax, a + half, b + half), axisPoint(ax, a - half, b + half)];
    for (const i of [0, 1, 2, 0, 2, 3]) tris.push(c[i].x, c[i].y, c[i].z);
    for (let i = 0; i < 4; i++) rim.push(c[i].x, c[i].y, c[i].z, c[(i + 1) % 4].x, c[(i + 1) % 4].y, c[(i + 1) % 4].z);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(tris), 3));
  const fill = new Mesh(geo, new MeshBasicMaterial({ color: new Color(WIRE.handle), depthTest: false, depthWrite: false, toneMapped: false }));
  fill.frustumCulled = false;
  fill.renderOrder = ORDER.overlay;
  const edge = lineSegments(rim, '#0b0c0d', 'overlay');
  edge.renderOrder = ORDER.overlay + 1;
  into.add(fill, edge);
}

/**
 * The Camera pane's camera in a 2D pane: a ring at its position and a wedge along where it looks, `px` world units
 * per screen pixel so it keeps its size at any zoom.
 */
export function buildCameraMarker(ax: PaneAxes, pos: Vector3, forward: Vector3, px: number, into: Group): void {
  const pu = pos.getComponent(ax.u), pv = pos.getComponent(ax.v);
  const fu = forward.getComponent(ax.u), fv = forward.getComponent(ax.v);
  const pts: number[] = [];
  const add = (a: number, b: number, c: number, d: number) => {
    const p = axisPoint(ax, a, b), q = axisPoint(ax, c, d);
    pts.push(p.x, p.y, p.z, q.x, q.y, q.z);
  };
  const r = 5 * px;
  for (let i = 0; i < 16; i++) {
    const t0 = (i / 16) * Math.PI * 2, t1 = ((i + 1) / 16) * Math.PI * 2;
    add(pu + Math.cos(t0) * r, pv + Math.sin(t0) * r, pu + Math.cos(t1) * r, pv + Math.sin(t1) * r);
  }
  const len = Math.hypot(fu, fv);
  if (len > 0.05) {
    // The view's sides at ±35°, 26 px long, joined at the far end.
    const a = Math.atan2(fv, fu), L = 26 * px * Math.min(1, len + 0.3);
    const s0 = [pu + Math.cos(a - 0.6) * L, pv + Math.sin(a - 0.6) * L], s1 = [pu + Math.cos(a + 0.6) * L, pv + Math.sin(a + 0.6) * L];
    add(pu, pv, s0[0], s0[1]);
    add(pu, pv, s1[0], s1[1]);
    add(s0[0], s0[1], s1[0], s1[1]);
  }
  into.add(lineSegments(pts, WIRE.camera, 'overlay'));
}
