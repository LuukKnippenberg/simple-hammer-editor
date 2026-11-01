/** A label to place on screen: its natural centre and size in pixels (y down). */
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lower goes first; below 0 is pinned to its natural spot whatever it covers. */
  priority: number;
  /** Labels with the same group and the same natural spot are stacked as one block, read as a list. */
  group?: string;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export interface LabelPlace {
  dx: number;
  dy: number;
  /** Where a leader line from the natural spot should end, on the first label of a moved block. */
  leader?: { x: number; y: number };
}

interface Block { members: number[]; x: number; y: number; w: number; h: number; priority: number }

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Moves labels apart on screen: a greedy pass in priority order that keeps each label at its natural spot when
 * it is free and otherwise nudges it up (or down) to the nearest free height, clear of the placed labels and the
 * `avoid` rects. Labels sharing a spot become one block stacked upwards from it, in priority order top to bottom.
 * Within `bounds` (0..h) when a free spot there exists.
 */
export function layoutLabels(labels: LabelBox[], avoid: Rect[] = [], bounds?: { h: number }, gap = 2): LabelPlace[] {
  const out: LabelPlace[] = labels.map(() => ({ dx: 0, dy: 0 }));
  const blocks: Block[] = [];
  const byKey = new Map<string, Block>();
  labels.forEach((l, i) => {
    const key = l.group === undefined ? null : `${l.group}|${Math.round(l.x * 2)}|${Math.round(l.y * 2)}`;
    const b = key ? byKey.get(key) : undefined;
    if (b) { b.members.push(i); return; }
    const nb: Block = { members: [i], x: l.x, y: l.y, w: 0, h: 0, priority: l.priority };
    blocks.push(nb);
    if (key) byKey.set(key, nb);
  });
  for (const b of blocks) {
    b.members.sort((p, q) => labels[p].priority - labels[q].priority);
    b.priority = labels[b.members[0]].priority;
    b.w = Math.max(...b.members.map((i) => labels[i].w));
    b.h = b.members.reduce((s, i) => s + labels[i].h, 0) + gap * (b.members.length - 1);
    // Stacked upwards: the last member keeps the natural spot, the block's bottom is its bottom.
    const last = labels[b.members[b.members.length - 1]];
    let top = last.y + last.h / 2 - b.h;
    for (const i of b.members) { out[i].dy = top + labels[i].h / 2 - labels[i].y; top += labels[i].h + gap; }
    b.y = last.y + last.h / 2 - b.h / 2;
  }
  blocks.sort((p, q) => p.priority - q.priority);

  const placed: Rect[] = [...avoid];
  const rect = (b: Block, dy: number): Rect => ({ x0: b.x - b.w / 2 - gap, x1: b.x + b.w / 2 + gap, y0: b.y + dy - b.h / 2 - gap, y1: b.y + dy + b.h / 2 + gap });
  const free = (r: Rect) => !placed.some((p) => overlaps(p, r));
  const inside = (r: Rect) => !bounds || (r.y0 >= -gap && r.y1 <= bounds.h + gap);

  for (const b of blocks) {
    let dy = 0;
    if (b.priority >= 0 && !free(rect(b, 0))) {
      // The heights that sit flush against something already placed, nearest first, upwards preferred.
      const cands: number[] = [];
      for (const p of placed) {
        if (p.x1 <= b.x - b.w / 2 - gap || p.x0 >= b.x + b.w / 2 + gap) continue;
        cands.push(p.y0 - (b.y + b.h / 2 + gap), p.y1 - (b.y - b.h / 2 - gap));
      }
      cands.sort((p, q) => Math.abs(p) * (p > 0 ? 1.5 : 1) - Math.abs(q) * (q > 0 ? 1.5 : 1));
      const ok = cands.filter((c) => free(rect(b, c)));
      dy = ok.find((c) => inside(rect(b, c))) ?? ok[0] ?? 0;
    }
    placed.push(rect(b, dy));
    if (dy === 0) continue;
    for (const i of b.members) out[i].dy += dy;
    out[b.members[0]].leader = { x: b.x, y: dy < 0 ? b.y + dy + b.h / 2 : b.y + dy - b.h / 2 };
  }
  return out;
}
