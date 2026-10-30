import type { PoiKit } from '../kit.ts';
import { NODRAW, rect } from '../kit.ts';
import type { Rect } from '../types.ts';
import type { PoiType } from '../types.ts';

const GRASS = 'NATURE/FOREST_GRASS_01';
const ASPHALT = 'CONCRETE/CONCRETEFLOOR033A';
const TRACK = 'NATURE/RED_GRASS';
const NET = 'METAL/METALFENCE007A';
const WHITE = { top: 'METAL/METALBAR001C_WHITE', bottom: 'METAL/METALBAR001C_WHITE', sides: 'METAL/METALBAR001C_WHITE' };
const STEEL = { top: 'METAL/METALPIPE001A', bottom: NODRAW, sides: 'METAL/METALPIPE001A' };
const STEP = { top: 'CONCRETE/CONCRETEFLOOR027A', bottom: NODRAW, sides: 'CONCRETE/CONCRETEWALL001A' };
const SEAT = { top: 'WOOD/WOODFLOOR005A', bottom: NODRAW, sides: 'WOOD/WOODWALL009A' };
const BOARD = { top: 'METAL/METALBAR001C_WHITE', bottom: 'METAL/METALBAR001C_WHITE', sides: 'PLASTER/PLASTERWALL003A' };
const CLIP = 'TOOLS/TOOLSNPCCLIP';

/** A rectangle outline painted as four lines. */
function box(k: PoiKit, r: Rect, w = 8): void {
  k.line([r.x0, r.y0], [r.x1, r.y0], w);
  k.line([r.x1, r.y0], [r.x1, r.y1], w);
  k.line([r.x1, r.y1], [r.x0, r.y1], w);
  k.line([r.x0, r.y1], [r.x0, r.y0], w);
}

/** An arc of painted line (n straight pieces). */
function arc(k: PoiKit, cx: number, cy: number, r: number, a0: number, a1: number, n: number, w = 6): void {
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    k.line([cx + Math.cos(t0) * r, cy + Math.sin(t0) * r], [cx + Math.cos(t1) * r, cy + Math.sin(t1) * r], w);
  }
}

/** A football goal on a goal line at x, its net reaching out towards `out` (+1: +x): posts, bar and a see-through net. */
function goal(k: PoiKit, x: number, cy: number, out: 1 | -1): void {
  const hw = 96, depth = 56, h = 80;
  const back = x + out * depth;
  const x0 = Math.min(x, back), x1 = Math.max(x, back);
  for (const y of [cy - hw, cy + hw]) k.box(rect(x - 4, y - 4, x + 4, y + 4), 0, h, WHITE);
  k.box(rect(x - 4, cy - hw + 4, x + 4, cy + hw - 4), h - 8, h, WHITE);
  // The net: a back panel, two sides and a roof sloping down from the bar, 2 units thick.
  k.box(rect(Math.min(back, back - out * 2), cy - hw, Math.max(back, back - out * 2), cy + hw), 0, h - 24, NET);
  for (const y of [cy - hw - 2, cy + hw]) k.box(rect(x0, y, x1, y + 2), 0, h - 24, NET);
  k.slope(rect(x0, cy - hw, x1, cy + hw), 'x', out > 0 ? h - 8 : h - 24, out > 0 ? h - 24 : h - 8, 2, NET);
  k.occupied.push(rect(x0 - 8, cy - hw - 8, x1 + 8, cy + hw + 8));
}

/**
 * Stepped bleachers along a local rectangle, rising away from `front` (the edge facing the pitch: 'y0' or
 * 'y1'). Steps are 16 high, so units can climb them; an NPC-clip ramp over the steps gives the navmesh a
 * smooth slope up to the top row.
 */
function bleachers(k: PoiKit, r: Rect, front: 'y0' | 'y1'): void {
  const depth = r.y1 - r.y0;
  const n = Math.max(2, Math.floor(depth / 48));
  const d = depth / n;
  for (let i = 0; i < n; i++) {
    const s = front === 'y0' ? rect(r.x0, r.y0 + i * d, r.x1, r.y0 + (i + 1) * d) : rect(r.x0, r.y1 - (i + 1) * d, r.x1, r.y1 - i * d);
    k.box(s, -4, (i + 1) * 16, i % 2 ? STEP : SEAT, { occupy: true });
  }
  // A railing along the back, and the clip ramp from the first step to the top.
  const top = n * 16;
  const backY = front === 'y0' ? r.y1 : r.y0;
  k.box(rect(r.x0, Math.min(backY, backY + (front === 'y0' ? -4 : 4)), r.x1, Math.max(backY, backY + (front === 'y0' ? -4 : 4))), top, top + 40, STEEL);
  // It starts one step's depth in front and reaches the top at the top step's front edge, so it stays above
  // every step's nose (a 1:3 slope); the top step is flat.
  const ramp = front === 'y0' ? rect(r.x0, r.y0 - d, r.x1, r.y0 + (n - 1) * d) : rect(r.x0, r.y1 - (n - 1) * d, r.x1, r.y1 + d);
  const node = k.slope(ramp, 'y', front === 'y0' ? 0 : top, front === 'y0' ? top : 0, 4, CLIP);
  // The ramp is a world brush: clip brushes belong to the world, not to func_detail.
  k.out.detail.splice(k.out.detail.indexOf(node), 1);
  k.out.world.push(node);
}

/** A floodlight mast: a steel pole and a lamp head facing `facing`, with a light when lights are on. */
function mast(k: PoiKit, x: number, y: number, facing: number, h = 512): void {
  k.cylinder(x, y, 10, -4, h, STEEL, 8);
  const a = (facing * Math.PI) / 180;
  const hx = x + Math.cos(a) * 20, hy = y + Math.sin(a) * 20;
  k.box(rect(hx - 32, hy - 32, hx + 32, hy + 32), h - 8, h + 40, { top: 'METAL/METALCOMBINE001', bottom: 'LIGHTS/WHITE002', sides: 'METAL/METALCOMBINE001' });
  k.occupied.push(rect(x - 24, y - 24, x + 24, y + 24));
  if (k.flag('lights')) k.light(hx + Math.cos(a) * 64, hy + Math.sin(a) * 64, h - 32, '255 245 230 600', 2400);
}

/**
 * A football pitch (1536 × 1024 at the default size) with painted lines, two goals with nets, stepped
 * bleachers on one or both long sides, floodlight masts in the corners, a low railing with gaps and an
 * optional running track round it.
 */
export const FOOTBALL: PoiType = {
  id: 'football', label: 'Football pitch', icon: '⚽', hint: 'A wide open field flanked by bleachers (climbable high ground).',
  landscapes: ['forest', 'city'], minSize: [1280, 896], maxSize: [3072, 2560], defaultSize: [1920, 1600],
  params: [
    { key: 'stands', label: 'Bleachers', type: 'select', default: 'one', options: [{ value: 'none', label: 'None' }, { value: 'one', label: 'One side' }, { value: 'both', label: 'Both sides' }] },
    { key: 'track', label: 'Running track', type: 'check', default: false },
    { key: 'masts', label: 'Floodlights', type: 'check', default: true },
    { key: 'lights', label: 'Lights on', type: 'check', default: false },
    { key: 'railing', label: 'Railing', type: 'check', default: true },
  ],
  gameplay: { capture: true },
  build(k) {
    const { W, D } = k;
    const [cx] = k.centre;
    k.pad(k.bounds, GRASS);
    const stands = k.str('stands');
    const standD = 192;
    const track = k.flag('track');
    // Room for the bleachers along the long sides, then the pitch (and track) in what is left.
    const yLo = 64 + (stands === 'both' ? standD + 48 : 0), yHi = D - 64 - (stands !== 'none' ? standD + 48 : 0);
    const tw = track ? 96 : 0;
    let pd = Math.min(1024, yHi - yLo - 2 * tw - (track ? 64 : 0));
    let pw = Math.min(1536, W - 128 - (track ? 2 * (pd / 2 + 32 + tw) : 0));
    pw = Math.max(640, Math.round(pw / 32) * 32);
    pd = Math.max(448, Math.round(pd / 32) * 32);
    const pcy = (yLo + yHi) / 2;
    const p = rect(cx - pw / 2, pcy - pd / 2, cx + pw / 2, pcy + pd / 2);
    if (track) {
      const r = pd / 2 + 32;
      for (const y of [p.y0 - 32 - tw, p.y1 + 32]) k.pad(rect(p.x0, y, p.x1, y + tw), TRACK, 4);
      k.ring(p.x0, pcy, r + tw, r, -4, 4, { top: TRACK, bottom: NODRAW, sides: NODRAW }, 12, Math.PI / 2, Math.PI * 1.5);
      k.ring(p.x1, pcy, r + tw, r, -4, 4, { top: TRACK, bottom: NODRAW, sides: NODRAW }, 12, -Math.PI / 2, Math.PI / 2);
      k.occupied.pop();
      k.occupied.pop();
    }
    // Routes: across the pitch beside the goals, and along it through the middle.
    k.route([0, pcy - 224], [W, pcy - 224]);
    k.route([cx, 0], [cx, D]);
    // Lines: touchlines and goal lines, halfway line and circle, penalty and goal areas, spots.
    box(k, p);
    k.line([cx, p.y0], [cx, p.y1]);
    k.overlay('overlays/capturecircle03a', cx, pcy, 300, 300);
    for (const dir of [1, -1] as const) {
      const gx = dir > 0 ? p.x0 : p.x1;
      box(k, rect(gx, pcy - 220, gx + dir * 240, pcy + 220));
      box(k, rect(gx, pcy - 112, gx + dir * 80, pcy + 112));
      arc(k, gx + dir * 176, pcy, 110, dir > 0 ? -0.95 : Math.PI - 0.95 + 0.0, dir > 0 ? 0.95 : Math.PI + 0.95, 6);
      goal(k, gx, pcy, dir === 1 ? -1 : 1);
    }
    if (stands !== 'none') bleachers(k, rect(cx - pw * 0.35, D - 64 - standD, cx + pw * 0.35, D - 64), 'y0');
    if (stands === 'both') bleachers(k, rect(cx - pw * 0.35, 64, cx + pw * 0.35, 64 + standD), 'y1');
    if (k.flag('masts')) {
      for (const [x, y, f] of [[48, 48, 45], [W - 48, 48, 135], [W - 48, D - 48, 225], [48, D - 48, 315]] as [number, number, number][]) mast(k, x, y, f);
    }
    if (k.flag('railing')) k.perimeter('railing', 20);
    // Benches for the teams by the halfway line.
    for (const dx of [-160, 160]) k.prop('props_trainstation/benchoutdoor01a', cx + dx, p.y0 - 56, 90);
    k.gameplay([cx + 320, pcy + 160]);
  },
};

/** A basketball court: asphalt, lines, two hoops and a tall chain-link fence with gates. */
export const BASKETBALL: PoiType = {
  id: 'basketball', label: 'Basketball court', icon: '🏀', hint: 'A fenced asphalt court: a small walled arena with two gates.',
  landscapes: ['city', 'forest'], minSize: [768, 512], maxSize: [1536, 1024], defaultSize: [896, 640],
  params: [
    { key: 'fence', label: 'Fence', type: 'check', default: true },
    { key: 'abandoned', label: 'Abandoned', type: 'check', default: false },
  ],
  gameplay: { capture: true },
  build(k) {
    const { W, D } = k;
    const [cx, cy] = k.centre;
    k.pad(k.bounds, ASPHALT);
    const cw = Math.min(640, W - 128), cd = Math.min(384, D - 128);
    const c = rect(cx - cw / 2, cy - cd / 2, cx + cw / 2, cy + cd / 2);
    k.route([0, cy + cd / 2 + 32], [W, cy + cd / 2 + 32]);
    k.route([cx, 0], [cx, D]);
    box(k, c, 6);
    k.line([cx, c.y0], [cx, c.y1], 6);
    arc(k, cx, cy, 56, 0, Math.PI * 2, 12, 5);
    for (const dir of [1, -1] as const) {
      const bx = dir > 0 ? c.x0 : c.x1;
      box(k, rect(bx, cy - 48, bx + dir * 152, cy + 48), 5);
      arc(k, bx + dir * 152, cy, 48, dir > 0 ? -Math.PI / 2 : Math.PI / 2, dir > 0 ? Math.PI / 2 : Math.PI * 1.5, 6, 5);
      arc(k, bx + dir * 20, cy, 168, dir > 0 ? -1.2 : Math.PI - 1.2, dir > 0 ? 1.2 : Math.PI + 1.2, 8, 5);
      // The hoop: a pole behind the baseline, an arm, a backboard and the ring.
      const px = bx - dir * 40;
      k.cylinder(px, cy, 6, -4, 168, STEEL, 8);
      k.box(rect(Math.min(px, bx + dir * 12), cy - 4, Math.max(px, bx + dir * 12), cy + 4), 148, 156, STEEL);
      k.box(rect(Math.min(bx + dir * 12, bx + dir * 16), cy - 36, Math.max(bx + dir * 12, bx + dir * 16), cy + 36), 120, 168, BOARD);
      k.ring(bx + dir * 30, cy, 14, 11, 124, 126, { top: 'METAL/METALPIPE001A', bottom: 'METAL/METALPIPE001A', sides: 'METAL/METALPIPE001A' }, 8);
      k.occupied.push(rect(px - 12, cy - 40, px + 12, cy + 40));
    }
    if (k.flag('abandoned')) {
      k.scatter(['props_junk/trashdumpster01a_static', 'props_vehicles/tire001b_truck_static', 'props_junk/wood_crate001a_static'], rect(64, 64, W - 64, D - 64), 4);
      for (let i = 0; i < 4; i++) k.overlay(k.rng.pick(['decals/decalstain002a', 'overlays/leaves_ground03']), k.rng.range(96, W - 96), k.rng.range(96, D - 96), 160, 160, k.rng.int(0, 359));
    }
    for (const x of [cx - 160, cx + 160]) k.prop('props_trainstation/benchoutdoor01a', x, c.y0 - 40, 90);
    if (k.flag('fence')) k.perimeter('chainlink', 16);
    k.gameplay([cx, cy]);
  },
};
