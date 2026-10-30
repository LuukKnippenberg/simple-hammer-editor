import { describe, expect, it } from 'vitest';
import { Box2, Box3, Vector2, Vector3 } from 'three';
import { planInterior } from '../src/gen/interiorPlan.ts';
import { interiorShell, openingBox, shellMaterials } from '../src/gen/interiorShell.ts';
import { interiorHouse } from '../src/gen/interiorHouse.ts';
import { rectPoly } from '../src/gen/buildingPlan.ts';
import { INTERIOR_STYLES } from '../src/gen/styles.ts';
import { Rng } from '../src/gen/rng.ts';
import { MapSolid, VmfDocument } from '../src/vmf/map.ts';
import { buildBrushFaces } from '../src/geom/brush.ts';
import { solidBounds } from '../src/edit/brushes.ts';
import type { KVNode } from '../src/vmf/keyvalues.ts';

const rect = (w: number, h: number) => rectPoly(new Box2(new Vector2(0, 0), new Vector2(w, h)));
const ell = [new Vector2(0, 0), new Vector2(512, 0), new Vector2(512, 256), new Vector2(256, 256), new Vector2(256, 512), new Vector2(0, 512)];
const Z0 = 64;
const solid = (n: KVNode) => new MapSolid(n, null);
const valid = (n: KVNode) => { const s = solid(n); return buildBrushFaces(s).length === s.sides.length && s.sides.length === 6; };
const volume = (a: Box3, b: Box3) => {
  const i = a.clone().intersect(b);
  return i.isEmpty() ? 0 : Math.max(0, i.max.x - i.min.x) * Math.max(0, i.max.y - i.min.y) * Math.max(0, i.max.z - i.min.z);
};

function build(fp: Vector2[], seed: number, style: keyof typeof INTERIOR_STYLES = 'farmhouse', cut = 112) {
  const doc = VmfDocument.empty();
  const plan = planInterior(fp, new Rng(seed), { cut, porch: true });
  const rng = new Rng(seed + 1);
  const m = shellMaterials(plan, INTERIOR_STYLES[style], rng);
  return { plan, m, shell: interiorShell(doc, plan, Z0, m, rng) };
}

const CASES = [rect(256, 256), rect(512, 384), rect(640, 448), ell].flatMap((fp) => [1, 2, 3, 4, 5].map((seed) => ({ fp, seed })));

describe('interior house shells', () => {
  it('every brush is a valid box', () => {
    for (const { fp, seed } of CASES) {
      for (const style of Object.keys(INTERIOR_STYLES) as (keyof typeof INTERIOR_STYLES)[]) {
        const { shell } = build(fp, seed, style);
        for (const n of [...shell.floors, ...shell.walls, ...shell.fills, ...shell.porch]) expect(valid(n)).toBe(true);
      }
    }
  });

  it('wall brushes never overlap each other or the floors', () => {
    for (const { fp, seed } of CASES) {
      const { shell } = build(fp, seed);
      const boxes = [...shell.walls, ...shell.floors].map((n) => solidBounds(solid(n)));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(volume(boxes[i], boxes[j])).toBeLessThan(0.01);
    }
  });

  it('openings are holes: no wall or floor brush reaches into them', () => {
    for (const { fp, seed } of CASES) {
      const { plan, shell } = build(fp, seed);
      const boxes = [...shell.walls, ...shell.floors, ...shell.porch].map((n) => solidBounds(solid(n)));
      for (const w of plan.walls) for (const o of w.openings) {
        const { box, zMin, zMax } = openingBox(w, o);
        const hole = new Box3(new Vector3(box.min.x, box.min.y, Z0 + zMin), new Vector3(box.max.x, box.max.y, Z0 + zMax));
        for (const b of boxes) expect(volume(b, hole)).toBeLessThan(0.01);
      }
    }
  });

  it('walls stop flat at the cut height and carry the cap on top', () => {
    for (const cut of [96, 112, 128]) {
      for (const { fp, seed } of CASES) {
        const { m, shell } = build(fp, seed, 'farmhouse', cut);
        let top = -Infinity;
        for (const n of shell.walls) {
          const s = solid(n);
          const b = solidBounds(s);
          top = Math.max(top, b.max.z);
          const up = s.sides.find((x) => buildBrushFaces(s).find((f) => f.side === x)!.plane.normal.z > 0.9)!;
          expect(up.material).toBe(m.cap.toUpperCase());
        }
        expect(top).toBe(Z0 + cut);
      }
    }
  });

  it('outer faces use the outside finish, inner faces the room finishes', () => {
    const { plan, m, shell } = build(rect(512, 384), 3);
    const mats = new Set(shell.walls.flatMap((n) => solid(n).sides.map((s) => s.material)));
    expect(mats.has(m.outer.toUpperCase())).toBe(true);
    for (let r = 0; r < plan.rooms.length; r++) expect(mats.has(m.inner[r].toUpperCase())).toBe(true);
  });

  it('interiorHouse keeps floors in the world and walls in func_detail', () => {
    const doc = VmfDocument.empty();
    const h = interiorHouse(doc, rect(512, 384), 0, { seed: 4, style: 'shack' });
    expect(h.world.length).toBe(h.plan.rooms.length);
    expect(h.detail.length).toBeGreaterThan(20);
    for (const n of [...h.world, ...h.detail]) expect(valid(n)).toBe(true);
  });

  it('two storeys: steps of 16 to the slab, a ramp under 45°, a railing open at the stairs', () => {
    let built = 0;
    for (const fp of [rect(512, 384), rect(640, 448), rect(384, 576)]) {
      for (let seed = 1; seed <= 10; seed++) {
        const doc = VmfDocument.empty();
        const h = interiorHouse(doc, fp, Z0, { seed, storeys: 2 });
        if (h.plan.storeys !== 2) continue;
        built++;
        const s = h.plan.stairs!;
        for (const n of [...h.world, ...h.detail]) {
          const sd = solid(n);
          expect(buildBrushFaces(sd).length).toBe(sd.sides.length);
        }
        const upper = h.detail.map((n) => solid(n)).filter((sd) => sd.sides.some((x) => x.material.startsWith('WOOD/WOODSTAIR')));
        const tops = upper.map((sd) => solidBounds(sd).max.z).sort((a, b) => a - b);
        expect(tops).toEqual(Array.from({ length: 8 }, (_, k) => Z0 + 8 + 16 * (k + 1)));
        // The slab: the brush with the ceiling underneath, its top level with the last step.
        const slab = h.detail.map((n) => solid(n)).find((sd) => sd.sides.some((x) => x.material === 'PLASTER/PLASTERCEILING008A'))!;
        expect(solidBounds(slab).max.z).toBe(Z0 + 136);
        // The ramp: rise over run at most 1.
        const ramp = h.world.map((n) => solid(n)).find((sd) => sd.sides.every((x) => x.material === 'TOOLS/TOOLSNPCCLIP'))!;
        const rb = solidBounds(ramp);
        const run = s.dir.x !== 0 ? rb.max.x - rb.min.x : rb.max.y - rb.min.y;
        expect((rb.max.z - rb.min.z) / run).toBeLessThanOrEqual(1);
        // Nothing of the railing stands where the flight arrives.
        const head = new Box3(new Vector3(s.box.min.x + 1, s.box.min.y + 1, Z0 + 137), new Vector3(s.box.max.x - 1, s.box.max.y - 1, Z0 + 200));
        const ax = s.dir.x !== 0 ? 'x' : 'y';
        head.min[ax] -= 64; head.max[ax] += 64;
        for (const n of h.detail) {
          const sd = solid(n);
          if (sd.sides.some((x) => x.material === 'METAL/METALRAIL001A')) expect(volume(solidBounds(sd), head)).toBe(0);
        }
        // Walls, floors, slab and steps never overlap.
        const boxes = [...h.world.filter((n) => !solid(n).sides.every((x) => x.material === 'TOOLS/TOOLSNPCCLIP')), ...h.detail].map((n) => solidBounds(solid(n)));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(volume(boxes[i], boxes[j])).toBeLessThan(0.01);
      }
    }
    expect(built).toBeGreaterThan(20);
  });
});
