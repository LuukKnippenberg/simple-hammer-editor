import { describe, expect, it } from 'vitest';
import { layoutLabels, type LabelBox, type Rect } from '../src/render/labelLayout.ts';

const boxOf = (l: LabelBox, p: { dx: number; dy: number }): Rect =>
  ({ x0: l.x + p.dx - l.w / 2, x1: l.x + p.dx + l.w / 2, y0: l.y + p.dy - l.h / 2, y1: l.y + p.dy + l.h / 2 });
const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const noOverlaps = (labels: LabelBox[], avoid: Rect[] = []) => {
  const out = layoutLabels(labels, avoid, { h: 1000 });
  const boxes = labels.map((l, i) => boxOf(l, out[i]));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) expect(hit(boxes[i], boxes[j]), `${i} vs ${j}`).toBe(false);
    if (labels[i].priority >= 0) for (const a of avoid) expect(hit(boxes[i], a)).toBe(false);
  }
  return out;
};

describe('label layout', () => {
  it('leaves labels that do not touch where they are', () => {
    const out = noOverlaps([{ x: 100, y: 100, w: 80, h: 20, priority: 1 }, { x: 300, y: 100, w: 80, h: 20, priority: 2 }]);
    expect(out.every((p) => p.dx === 0 && p.dy === 0 && !p.leader)).toBe(true);
  });

  it('separates overlapping labels; the active one keeps its spot and the moved one gets a leader', () => {
    const labels: LabelBox[] = [
      { x: 200, y: 300, w: 160, h: 24, priority: 7 },
      { x: 210, y: 305, w: 200, h: 30, priority: -1 },
      { x: 190, y: 296, w: 180, h: 24, priority: 1 },
      { x: 205, y: 310, w: 100, h: 20, priority: 1000 },
    ];
    const out = noOverlaps(labels);
    expect(out[1]).toEqual({ dx: 0, dy: 0 });
    expect(out[0].leader).toBeDefined();
    // Stage 1 settles nearer its spot than stage 7: it is placed first.
    expect(Math.abs(out[2].dy)).toBeLessThanOrEqual(Math.abs(out[0].dy));
  });

  it('stacks labels on the same spot as one block, in order top to bottom, ending at the spot', () => {
    const labels: LabelBox[] = [
      { x: 400, y: 400, w: 120, h: 20, priority: 7, group: 'stage' },
      { x: 400, y: 400, w: 160, h: 20, priority: 1, group: 'stage' },
      { x: 400, y: 400, w: 100, h: 20, priority: 3, group: 'stage' },
    ];
    const out = noOverlaps(labels);
    const ys = out.map((p, i) => labels[i].y + p.dy);
    expect(ys[1]).toBeLessThan(ys[2]);
    expect(ys[2]).toBeLessThan(ys[0]);
    expect(out[0].dy).toBe(0);
    expect(out.some((p) => p.leader)).toBe(false);
  });

  it('keeps clear of the panel, but the active label stays even over it', () => {
    const panel: Rect = { x0: 600, y0: 500, x1: 1000, y1: 1000 };
    const labels: LabelBox[] = [
      { x: 650, y: 520, w: 120, h: 20, priority: 2 },
      { x: 700, y: 700, w: 120, h: 24, priority: -1 },
    ];
    const out = noOverlaps(labels, [panel]);
    expect(labels[0].y + out[0].dy + labels[0].h / 2).toBeLessThanOrEqual(panel.y0);
    expect(out[1]).toEqual({ dx: 0, dy: 0 });
  });

  it('a pile of labels on one spot all end up apart', () => {
    const labels: LabelBox[] = Array.from({ length: 30 }, (_, i) => ({ x: 500 + (i % 5) * 7, y: 500 + (i % 3) * 5, w: 90 + i, h: 22, priority: i }));
    noOverlaps(labels);
  });
});
