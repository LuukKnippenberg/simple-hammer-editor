import { Box2, Vector2, Vector3 } from 'three';
import type { KVNode } from '../vmf/keyvalues.ts';
import type { VmfDocument } from '../vmf/map.ts';
import { boxFaces, solidNode, worldAlignedAxes } from '../edit/brushes.ts';
import { Rng } from './rng.ts';
import { wallBox, wallLength, type InteriorPlan, type PlanWall } from './interiorPlan.ts';
import type { InteriorStyle } from './styles.ts';

const NODRAW = 'TOOLS/TOOLSNODRAW';
const BLACK = 'TOOLS/TOOLSBLACK';
const RAILING = 'METAL/METALRAIL001A';
/** How far the floor slabs and porch reach down into the ground, for uneven terrain. */
const SINK = 32;

export type WindowFill = 'open' | 'black' | 'boarded';

/** Materials chosen for one house. */
export interface ShellMaterials {
  outer: string;
  cap: string;
  planks: string;
  /** Inner wall and floor material per room (index into `plan.rooms`). */
  inner: string[];
  floor: string[];
  windows: WindowFill;
}

/** The brushes of a house shell, by role. */
export interface ShellBrushes {
  /** Floor slabs (world brushes). */
  floors: KVNode[];
  /** Wall piers, sills and lintels, cut flat at the top and capped. */
  walls: KVNode[];
  /** Black panels or boards in the window holes. */
  fills: KVNode[];
  /** Porch deck and its railings. */
  porch: KVNode[];
}

/** Picks the materials for a house: one outside finish, one inside finish and floor per room. */
export function shellMaterials(plan: InteriorPlan, style: InteriorStyle, rng: Rng): ShellMaterials {
  const wet = (t: string) => t === 'kitchen' || t === 'bath';
  return {
    outer: rng.pick(style.outer),
    cap: style.cap,
    planks: style.planks,
    inner: plan.rooms.map((r) => rng.pick(wet(r.type) ? style.wet : style.inner)),
    floor: plan.rooms.map((r) => rng.pick(wet(r.type) ? style.wetFloor : style.floor)),
    windows: rng.pick(style.windows),
  };
}

const mod = (x: number, m: number) => ((x % m) + m) % m;
// Face order of `boxFaces`: top, bottom, then the sides facing -y, +x, +y, -x.
const NORMALS = [new Vector3(0, 0, 1), new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(-1, 0, 0)];

/**
 * A box brush with a material per face (`pick` gets the face normal and the face centre). Textures are
 * world aligned at 0.25, with a 128-unit tile starting at `alignZ` on the walls.
 */
export function pickedBox(doc: VmfDocument, min: Vector3, max: Vector3, pick: (n: Vector3, c: Vector3) => string, alignZ: number): KVNode {
  const faces = boxFaces(min, max, NODRAW);
  const centre = min.clone().add(max).multiplyScalar(0.5);
  faces.forEach((f, i) => {
    const n = NORMALS[i];
    const c = centre.clone();
    if (n.x) c.x = n.x > 0 ? max.x : min.x;
    if (n.y) c.y = n.y > 0 ? max.y : min.y;
    if (n.z) c.z = n.z > 0 ? max.z : min.z;
    f.material = pick(n, c);
    const axes = worldAlignedAxes(n);
    if (!n.z) axes.v.shift = Math.round(mod(alignZ / 0.25, 512) * 1000) / 1000;
    f.u = axes.u;
    f.v = axes.v;
  });
  return solidNode(doc, faces);
}

/**
 * Brushes for a planned house standing at `z0`: walls split around their openings into piers, sills and
 * lintels (all cut at the plan's heights, capped on top), floor slabs per room, window fills and the porch.
 */
export function interiorShell(doc: VmfDocument, plan: InteriorPlan, z0: number, m: ShellMaterials, rng: Rng): ShellBrushes {
  const out: ShellBrushes = { floors: [], walls: [], fills: [], porch: [] };
  const roomAt = (p: Vector2 | Vector3, storey: number) => plan.rooms.findIndex((r) => r.storey === storey
    && p.x >= r.box.min.x - 0.01 && p.x <= r.box.max.x + 0.01 && p.y >= r.box.min.y - 0.01 && p.y <= r.box.max.y + 0.01);
  const innerAt = (p: Vector3, storey: number) => { const r = roomAt(p, storey); return r < 0 ? m.outer : m.inner[r]; };

  for (const w of plan.walls) out.walls.push(...wallBrushes(doc, w, z0, m, innerAt));

  // Window fills: a black panel in the middle of the wall, or boards nailed across the outside.
  if (m.windows !== 'open') {
    for (const w of plan.walls) {
      const wb = wallBox(w), ax = w.axis, oa = ax === 'x' ? 'y' : 'x';
      for (const o of w.openings) {
        if (o.kind !== 'window') continue;
        const hole = wb.clone();
        hole.min[ax] = wb.min[ax] + o.from; hole.max[ax] = wb.min[ax] + o.to;
        if (m.windows === 'black') {
          const c = (hole.min[oa] + hole.max[oa]) / 2;
          hole.min[oa] = c - 1; hole.max[oa] = c + 1;
          out.fills.push(pickedBox(doc, new Vector3(hole.min.x, hole.min.y, z0 + o.sill), new Vector3(hole.max.x, hole.max.y, z0 + o.lintel), () => BLACK, z0));
          continue;
        }
        // Boards on the outer face (the side away from the room).
        const outSide = w.left === -1 ? (ax === 'x' ? 1 : -1) : (ax === 'x' ? -1 : 1);
        const face = outSide > 0 ? hole.max[oa] : hole.min[oa];
        hole.min[oa] = Math.min(face - outSide * 3, face - outSide); hole.max[oa] = Math.max(face - outSide * 3, face - outSide);
        const h = o.lintel - o.sill;
        const boards = rng.int(2, 3);
        for (let k = 0; k < boards; k++) {
          const zc = z0 + o.sill + ((k + 0.5) * h) / boards + rng.int(-3, 3);
          out.fills.push(pickedBox(doc, new Vector3(hole.min.x, hole.min.y, zc - 5), new Vector3(hole.max.x, hole.max.y, zc + 5), () => m.planks, z0));
        }
      }
    }
  }

  // Floor slabs, one per ground room, sunk into the ground; their outer sides show the house's finish.
  plan.rooms.forEach((r, i) => {
    if (r.storey !== 1) return;
    out.floors.push(pickedBox(doc, new Vector3(r.box.min.x, r.box.min.y, z0 - SINK), new Vector3(r.box.max.x, r.box.max.y, z0 + 8),
      (n) => (n.z > 0 ? m.floor[i] : n.z < 0 ? NODRAW : m.outer), z0));
  });

  // Porch: a plank deck at floor height, with railings on its ends half of the time.
  if (plan.porch) {
    const p = plan.porch;
    out.porch.push(pickedBox(doc, new Vector3(p.min.x, p.min.y, z0 - SINK), new Vector3(p.max.x, p.max.y, z0 + 8), (n) => (n.z < 0 ? NODRAW : m.planks), z0));
    const e = plan.entrances[0];
    if (rng.chance(0.5)) {
      // The ends are the sides across the wall direction.
      const ax = Math.abs(e.out.x) > 0.5 ? 'y' : 'x';
      for (const end of ['min', 'max'] as const) {
        const b = p.clone();
        if (end === 'min') b.max[ax] = b.min[ax] + 2; else b.min[ax] = b.max[ax] - 2;
        out.porch.push(pickedBox(doc, new Vector3(b.min.x, b.min.y, z0 + 8), new Vector3(b.max.x, b.max.y, z0 + 40), (n) => (n.z ? NODRAW : RAILING), z0 + 8));
      }
    }
  }
  return out;
}

/** One wall: piers between openings, sills under windows, lintels over doors and windows. */
function wallBrushes(doc: VmfDocument, w: PlanWall, z0: number, m: ShellMaterials, innerAt: (p: Vector3, storey: number) => string): KVNode[] {
  const out: KVNode[] = [];
  const wb = wallBox(w), ax = w.axis;
  const zb = z0 + w.bottom, zt = z0 + w.top;
  const base = z0 + (w.storey - 1) * 128;
  const seg = (from: number, to: number, zMin: number, zMax: number) => {
    if (to - from < 0.5 || zMax - zMin < 0.5) return;
    const b = wb.clone();
    b.min[ax] = wb.min[ax] + from; b.max[ax] = wb.min[ax] + to;
    out.push(pickedBox(doc, new Vector3(b.min.x, b.min.y, zMin), new Vector3(b.max.x, b.max.y, zMax), (n, c) => {
      if (n.z > 0) return m.cap;
      // The bottom stands on the floor; a lintel's underside is seen through the opening.
      if (n.z < 0) return zMin <= zb + 0.01 ? NODRAW : innerAt(c, w.storey);
      return innerAt(c.clone().addScaledVector(n, 1.5), w.storey);
    }, base));
  };
  let at = 0;
  for (const o of w.openings) {
    seg(at, o.from, zb, zt);
    if (z0 + o.sill > zb) seg(o.from, o.to, zb, z0 + o.sill);
    if (z0 + o.lintel < zt) seg(o.from, o.to, z0 + o.lintel, zt);
    at = o.to;
  }
  seg(at, wallLength(w), zb, zt);
  return out;
}

/** The hole an opening leaves in its wall, seen from above, and its height range above z0. */
export function openingBox(w: PlanWall, o: PlanWall['openings'][number]): { box: Box2; zMin: number; zMax: number } {
  const wb = wallBox(w), ax = w.axis;
  const box = wb.clone();
  box.min[ax] = wb.min[ax] + o.from; box.max[ax] = wb.min[ax] + o.to;
  return { box, zMin: o.sill, zMax: o.lintel };
}
