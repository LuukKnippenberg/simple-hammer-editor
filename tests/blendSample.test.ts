import { describe, expect, it } from 'vitest';
import { layerOutline, noiseWeights, paintDab, previewGrid, sampleWeights, shownShares, splitWeights, vertexX, vertexY } from '../src/edit/blendSample.ts';
import type { BlendDef, BlendEdge } from '../src/edit/multiblend.ts';
import { History } from '../src/edit/history.ts';
import { VmfDocument } from '../src/vmf/map.ts';

const def = (...edges: BlendEdge[]): BlendDef => ({
  name: 't',
  layers: [{ texture: 'base', scale: 1, rotation: 0 }, ...edges.map((edge, i) => ({ texture: `l${i + 1}`, scale: 1, rotation: 0, edge }))],
});
const slot = (g: ReturnType<typeof previewGrid>, k: number) => Array.from({ length: g.cols * g.rows }, (_, i) => g.weights[i * 4 + k]);

describe('material blender preview ground', () => {
  it('samples a stroke, patches and a band, but never slots past the blend\'s layers', () => {
    const g = previewGrid();
    sampleWeights(g, 4);
    for (const k of [0, 1, 2]) expect(Math.max(...slot(g, k)), `slot ${k + 1}`).toBe(1);
    expect(slot(g, 3).every((w) => w === 1)).toBe(true);
    sampleWeights(g, 2);
    expect(Math.max(...slot(g, 1), ...slot(g, 2))).toBe(0);
  });

  it('splits the patch into one band per layer, base first', () => {
    const g = previewGrid();
    splitWeights(g, 3);
    const at = (x: number) => {
      const i = Array.from({ length: g.cols }, (_, c) => c).find((c) => vertexX(g, c) >= x)!;
      return [g.weights[i * 4], g.weights[i * 4 + 1], g.weights[i * 4 + 2]];
    };
    expect([at(-700), at(0), at(700)]).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  });

  it('fills from the Ground tool\'s noise only for the blend\'s layers', () => {
    const g = previewGrid();
    noiseWeights(g, [{ layer: 1, coverage: 0.4, scale: 256, seed: 3 }, { layer: 2, coverage: 0.4, scale: 256, seed: 4 }], 2);
    const covered = slot(g, 0).filter((w) => w > 0.5).length / (g.cols * g.rows);
    expect(covered).toBeGreaterThan(0.1);
    expect(Math.max(...slot(g, 1))).toBe(0);
  });

  it('brushes a layer in and erases it back to the base', () => {
    const g = previewGrid();
    const i = Array.from({ length: g.cols * g.rows }, (_, k) => k).find((k) => vertexX(g, k) === 0 && vertexY(g, k) === 0)!;
    for (let k = 0; k < 10; k++) paintDab(g, 0, 0, 128, 2, 0.35);
    expect(g.weights[i * 4 + 1]).toBeGreaterThan(0.95);
    for (let k = 0; k < 10; k++) paintDab(g, 0, 0, 128, 0, 0.35);
    expect(g.weights[i * 4 + 1]).toBeLessThan(0.05);
  });

  it('shows a layer from 1 − its softness alpha of paint: Soft early, Medium later, Crisp only when fully painted', () => {
    const w = new Float32Array([0.5, 0, 0, 1]);
    const share = (edge: BlendEdge) => shownShares(def(edge), w, 0)[0];
    expect(share('soft')).toBeGreaterThan(0.3);
    expect(share('medium')).toBe(0);
    expect(share('crisp')).toBe(0);
    w[0] = 0.9;
    expect(share('medium')).toBeGreaterThan(0.5);
    expect(share('crisp')).toBe(0);
    w[0] = 1;
    expect(share('crisp')).toBe(1);
    // Earlier slots win; the base gets the rest.
    expect(shownShares(def('crisp', 'soft'), new Float32Array([1, 1, 0, 1]), 0)).toEqual([1, 0, 0, 0]);
  });

  it('outlines where the selected layer shows', () => {
    const g = previewGrid();
    sampleWeights(g, 3);
    const lines = layerOutline(g, def('soft', 'medium'), 1);
    expect(lines.length % 4).toBe(0);
    expect(lines.length).toBeGreaterThan(40);
    // Split mode is drawn without one; an unpainted layer has none.
    expect(layerOutline(previewGrid(), def('soft'), 1)).toEqual([]);
  });
});

describe('history effects', () => {
  it('undoes a change outside the document with the step it was grouped into', () => {
    const h = new History(() => VmfDocument.empty());
    const log: string[] = [];
    h.group('Rename blend', () => h.effect('file', () => log.push('undo'), () => log.push('redo')));
    expect(h.undoLabel).toBe('Rename blend');
    h.undo();
    h.redo();
    expect(log).toEqual(['undo', 'redo']);
  });
});
