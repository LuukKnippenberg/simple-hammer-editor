import { describe, expect, it } from 'vitest';
import { Box2, Box3, Vector2, Vector3 } from 'three';
import { planBlock } from '../src/gen/buildingPlan.ts';
import { generateBuildings, layoutOptions } from '../src/gen/buildings.ts';
import { Rng } from '../src/gen/rng.ts';
import { VmfDocument } from '../src/vmf/map.ts';
import { History } from '../src/edit/history.ts';
import { GENERATORS, directGenerator, dragRect, generatorOfLayout, lotPreview, menuKey, tuneSummary } from '../src/edit/generators.ts';

const plan = { minFloors: 2, maxFloors: 6, alleys: false, corners: 'mixed' as const, courtyards: true, annexes: true };
const sizes: [number, number][] = [[256, 256], [512, 384], [640, 640], [1024, 768], [1536, 1024], [2048, 2048]];

describe('single building layouts', () => {
  it('plans exactly one building on any lot, never a ring', () => {
    for (const [w, d] of sizes) for (let seed = 1; seed <= 12; seed++) {
      const p = planBlock(new Box2(new Vector2(0, 0), new Vector2(w, d)), new Rng(seed), { ...plan, single: 'building' });
      expect(p.ring).toBeFalsy();
      expect(p.buildings.filter((b) => b.parts[0].kind === 'main')).toHaveLength(1);
      expect(p.walls).toHaveLength(0);
    }
  });

  it('plans a house as one plain rectangle', () => {
    for (const [w, d] of sizes) for (let seed = 1; seed <= 8; seed++) {
      const p = planBlock(new Box2(new Vector2(0, 0), new Vector2(w, d)), new Rng(seed), { ...plan, corners: 'square', single: 'house' });
      expect(p.buildings).toHaveLength(1);
      expect(p.buildings[0].parts).toHaveLength(1);
      expect(p.buildings[0].parts[0].poly).toHaveLength(4);
    }
  });

  it('generates one building for the Building generator', () => {
    for (const [w, d] of [[512, 384], [1024, 768], [1536, 1024]] as const) for (const seed of [3, 7, 11]) {
      const r = generateBuildings(VmfDocument.empty(), new Box3(new Vector3(0, 0, 0), new Vector3(w, d, 0)),
        { seed, minFloors: 3, maxFloors: 5, alleys: false, roofProps: true, layout: 'single' });
      expect(r.buildings).toBe(1);
      expect(r.ring).toBe(false);
      expect(r.interiorHouses).toBe(0);
      expect(r.solids.length).toBeGreaterThan(0);
    }
  });

  it('generates one enterable house for the Simple interior building generator, whatever the quality', () => {
    for (const [w, d] of [[448, 384], [512, 512], [1024, 640]] as const) for (const quality of ['high', 'filler'] as const) {
      const r = generateBuildings(VmfDocument.empty(), new Box3(new Vector3(0, 0, 0), new Vector3(w, d, 0)),
        { seed: 5, minFloors: 1, maxFloors: 4, alleys: false, roofProps: true, layout: 'house', quality });
      expect(r.buildings).toBe(1);
      expect(r.interiorHouses).toBe(1);
    }
  });

  it('keeps a house to 1–2 floors and square corners', () => {
    const o = layoutOptions({ seed: 1, minFloors: 3, maxFloors: 6, alleys: true, roofProps: true, layout: 'house', corners: 'round' });
    expect([o.minFloors, o.maxFloors]).toEqual([2, 2]);
    expect(o.corners).toBe('square');
    expect(o.interiors).toBe('all');
    expect(o.alleys).toBe(false);
    // A block keeps its options.
    const b = { seed: 1, minFloors: 3, maxFloors: 6, alleys: true, roofProps: true };
    expect(layoutOptions(b)).toBe(b);
  });

  it('still lays out large blocks as rings round a courtyard', () => {
    const rings = [1, 2, 3, 4, 5, 6].filter((seed) => planBlock(new Box2(new Vector2(0, 0), new Vector2(1536, 1024)), new Rng(seed), plan).ring);
    expect(rings.length).toBeGreaterThan(2);
  });
});

describe('Generate menu', () => {
  it('numbers its entries 1–7 in menu order', () => {
    expect(GENERATORS.map((g) => g.key)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(GENERATORS.filter((g) => g.fills).map((g) => g.id)).toEqual(['building', 'block', 'house', 'poi']);
  });

  it('picks with the number keys, repeats the last with Enter, closes with Esc or G', () => {
    expect(menuKey('2', null)).toEqual({ pick: 'block' });
    expect(menuKey('7', 'road')).toEqual({ pick: 'poi' });
    expect(menuKey('Enter', 'house')).toEqual({ pick: 'house' });
    expect(menuKey('Enter', null)).toBeNull();
    expect(menuKey('Escape', 'block')).toEqual({ close: true });
    expect(menuKey('G', null)).toEqual({ close: true });
    expect(menuKey('8', null)).toBeNull();
    expect(menuKey('x', null)).toBeNull();
  });

  it('starts roads, powerlines and POIs directly with 7, 9 and P', () => {
    expect(directGenerator('7')).toBe('road');
    expect(directGenerator('9')).toBe('powerline');
    expect(directGenerator('P')).toBe('poi');
    expect(directGenerator('p')).toBe('poi');
    expect(directGenerator('1')).toBeNull();
  });

  it('maps stored layouts back to their generators', () => {
    expect(generatorOfLayout('single')).toBe('building');
    expect(generatorOfLayout('house')).toBe('house');
    expect(generatorOfLayout(undefined)).toBe('block');
  });
});

describe('placing a footprint', () => {
  it('snaps a drag to the grid in any direction', () => {
    expect(dragRect({ x: 10, y: 20 }, { x: 1530, y: 1000 })).toEqual({ x0: 0, y0: 0, x1: 1536, y1: 1024 });
    expect(dragRect({ x: 1536, y: 1024 }, { x: 0, y: 0 })).toEqual({ x0: 0, y0: 0, x1: 1536, y1: 1024 });
  });

  it('makes a square with Shift (the longer side)', () => {
    expect(dragRect({ x: 0, y: 0 }, { x: 1024, y: -512 }, { square: true })).toEqual({ x0: 0, y0: -1024, x1: 1024, y1: 0 });
  });

  it('keeps at least 128 per side, and places the default size on a click', () => {
    expect(dragRect({ x: 0, y: 0 }, { x: 640, y: 64 })).toEqual({ x0: 0, y0: 0, x1: 640, y1: 128 });
    expect(dragRect({ x: 0, y: 0 }, { x: 10, y: 10 }, { size: [512, 384] })).toEqual({ x0: -256, y0: -192, x1: 256, y1: 192 });
  });

  it('says what a lot will become', () => {
    expect(lotPreview('block', 1536, 1024)).toMatch(/^Ring round a courtyard/);
    expect(lotPreview('block', 1536, 1024, { courtyards: false })).toMatch(/^Row/);
    expect(lotPreview('block', 1024, 512)).toMatch(/^Row of about 2 buildings/);
    expect(lotPreview('house', 448, 384)).toBe('One interior house on the lot');
    expect(tuneSummary('block', 1536, 1024, { buildings: 7, houses: 0, ring: true })).toBe('1536 × 1024 · 7 buildings round a courtyard');
    expect(tuneSummary('building', 512, 384, { buildings: 1, houses: 0, ring: false })).toBe('512 × 384 · one building');
  });
});

describe('one undo step per generate', () => {
  it('squashes a generate and its tweaks into one step', () => {
    const doc = VmfDocument.empty();
    const h = new History(() => doc);
    let v = 0;
    const step = (to: number) => { const from = v; h.group(`set ${to}`, () => { v = to; (h as unknown as { push(op: object): void }).push({ label: 'x', undo: () => (v = from), redo: () => (v = to) }); }); };
    step(1);
    const mark = h.depth;
    step(2);
    step(3);
    step(4);
    h.squash(mark, 'Generate building');
    expect(h.depth).toBe(mark + 1);
    expect(h.undoLabel).toBe('Generate building');
    h.undo();
    expect(v).toBe(1);
    h.redo();
    expect(v).toBe(4);
  });
});
