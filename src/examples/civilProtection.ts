/**
 * "Civil Protection" – the Combine tutorial mission, built with the editor's own tools: the map sketch
 * (layout, surfaces, POIs, buildings with interiors, markers), the Lambda Wars kits, the cinematics tools
 * (camera shots, flybys, a strider route, screens, particles, atmosphere presets), decals, and the mission
 * flowchart with the game-event conditions (buildings, research and training, counts, "all of"), ability
 * gates and speakers.
 *
 * Story (see the design doc): Unit 09 starts a compliance shift on the station plaza, corrects three
 * citizens in the housing block, is sent through the canal checkpoint to Outpost Kilo, takes command of
 * a Stalker as a rebel uprising breaks out, builds the outpost up and holds the canal bridge until
 * Overwatch arrives with dropships, a gunship and Striders.
 *
 * Grid: 60×48 cells of 128 units; cell (x, y) has its south-west corner at (x·128 − 3840, y·128 − 3072).
 * The route runs from the plaza (south-west) east along the housing street, north up the canal street to
 * the outpost, whose north edge is the canal; the old city lies beyond the bridge, the Citadel boulevard
 * east of the outpost.
 */
import { Raycaster, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { Feature, Surface, emptySketch, type Sketch, type SketchMarker, type SketchPoi } from '../gen/sketch.ts';
import { boxSolid } from '../edit/brushes.ts';
import { entityNode, editorBlock } from '../edit/actions.ts';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { KITS, applyStandardRelations, placeUnits, recordKit, spread, type ParamValue } from '../lw/kits.ts';
import type { AbilityGate, MissionGraph, Stage, Transition } from '../lw/mission.ts';
import { getConnections } from '../vmf/io.ts';
import { placeDecalRay } from '../edit/decals.ts';
import { MODEL_BOUNDS } from '../gen/poi/models.ts';
import { ATMOSPHERE_PRESETS, pathEntities, shotEntities, type EntitySpec } from '../lw/cinematics.ts';
import { addScreen, buildAtmosphere, buildFlyby, buildSendAlong, groundBelow } from '../lw/cinematicsAction.ts';
import { Rng } from '../gen/rng.ts';
import { hallBrushes, type HallWall } from '../gen/hall.ts';

const W = 60;
const H = 48;
const C = 128;
/** World x / y of a (fractional) cell coordinate. */
export const X = (c: number) => c * C - (W * C) / 2;
export const Y = (c: number) => c * C - (H * C) / 2;

type Rect = [number, number, number, number];

// --- Layout (cells, inclusive) -----------------------------------------------------------------------------

/** Building blocks: the city around the route. */
const BLOCKS: Rect[] = [
  [0, 20, 21, 32], // north of the plaza
  [22, 0, 40, 10], // housing block, south side of the street
  [22, 15, 35, 22], // housing block, north side (the alley is cut out of it)
  [22, 23, 30, 32], // west of the outpost
  [41, 0, 52, 13], // east of the canal street
  [43, 14, 52, 22],
  [0, 33, 22, 47], // west of the canal
  [57, 33, 59, 47], // east of the canal
  [23, 44, 33, 47], // old city
  [47, 44, 56, 47],
];
/** The alley the runner flees into: a dead end off the housing street. */
const ALLEY: Rect = [28, 15, 29, 19];
const OUTPOST: Rect = [32, 23, 52, 32];
const BOULEVARD: Rect = [53, 0, 59, 32];
const OLD_CITY: Rect = [23, 41, 56, 47];
/**
 * Building detail along the route (cells, inclusive): high where the mission goes and the camera looks, medium
 * facing it, filler everywhere else. Decoration is what fills vbsp's t-junction buffer (scripts/tjunc-budget.mjs).
 */
const DETAIL_HIGH: Rect[] = [
  [21, 8, 37, 17], // both sides of the housing street, and the alley
  [27, 14, 30, 20],
  [35, 11, 43, 23], // the canal street and the checkpoint
  [27, 23, 31, 32], // the outpost's west wall and the buildings behind it
  [41, 19, 52, 22], // the outpost's north side
  [28, 41, 33, 47], // the old city where the waves come from
  [47, 41, 51, 47],
];
const DETAIL_MEDIUM: Rect[] = [
  [0, 20, 21, 22], // facing the station's north wall
  [19, 33, 22, 40], // facing the canal's west end
  [48, 0, 52, 13], // along the boulevard
  [23, 41, 56, 47], // the rest of the old city
];

const POIS: SketchPoi[] = [
  // The train shed of the station (its walls and roof are added after generating, see buildStation).
  { type: 'railyard', x: 0, y: 0, w: 22, h: 7, seed: 11, params: { tracks: 3, cars: 50, wrecks: 1, canopy: false } },
  { type: 'rations', x: 13, y: 9, w: 8, h: 8, seed: 13, params: { lanes: 3 } },
  { type: 'checkpoint', x: 36, y: 18, w: 7, h: 4, seed: 14, params: { surface: 'none', apc: true, lights: true } },
  { type: 'canal', x: 24, y: 33, w: 32, h: 8, seed: 15, params: { bridges: 1, width: 384 } },
  { type: 'barricade', x: 35, y: 41, w: 10, h: 4, seed: 16, params: { explosive: false, surface: 'rubble' } },
];

const m = (kind: SketchMarker['kind'], x: number, y: number, params?: Record<string, ParamValue>): SketchMarker => ({ kind, x, y, params });

export function buildCivilSketch(): Sketch {
  const s = emptySketch(W, H, 'city');
  s.seed = 1709;
  s.floors = [3, 5];
  s.interiors = 'some';
  // Filler unless painted: high along the route, medium facing it. Green yards instead of sheds.
  s.yards = 'green';
  s.quality = new Array(W * H).fill(3);
  for (const [level, rects] of [[2, DETAIL_MEDIUM], [1, DETAIL_HIGH]] as const) {
    for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s.quality[y * W + x] = level;
  }
  const fill = (r: Rect, f: (i: number, x: number, y: number) => void) => {
    for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) f(y * W + x, x, y);
  };
  for (const b of BLOCKS) fill(b, (i) => (s.features[i] = Feature.Building));
  fill(ALLEY, (i, x, y) => { s.features[i] = (x + y) % 3 === 0 ? Feature.Rubble : Feature.None; s.surface[i] = Surface.Rubble; });

  // Streets: the housing street east from the plaza, the canal street north to the checkpoint.
  fill([21, 12, 37, 13], (i) => (s.surface[i] = Surface.Road));
  fill([38, 11, 40, 22], (i) => (s.surface[i] = Surface.Road));
  // The outpost yard (turned into MultiBlend ground after generating), walled off from the blocks to the west.
  fill(OUTPOST, (i) => (s.surface[i] = Surface.Dirt));
  fill([31, 23, 31, 32], (i) => (s.features[i] = Feature.Wall));
  // The Citadel boulevard: a carriageway between grass verges with trees.
  fill(BOULEVARD, (i, x, y) => {
    const verge = x <= 54 || x >= 58;
    s.surface[i] = verge ? Surface.Grass : Surface.Road;
    if (verge && (x === 53 || x === 59) && y % 3 === 1) s.features[i] = Feature.Trees;
  });
  // Walls close the canal's ends, so the bridge is the only way across.
  fill([23, 33, 23, 40], (i) => (s.features[i] = Feature.Wall));
  fill([56, 33, 56, 40], (i) => (s.features[i] = Feature.Wall));
  // The old city: rubble, debris and burnt-out cars between the blocks.
  fill(OLD_CITY, (i, x, y) => {
    if (s.features[i] === Feature.Building || (x === 23 && y <= 40) || (x === 56 && y <= 40)) return;
    s.surface[i] = Surface.Rubble;
    if ((x * 7 + y * 13) % 9 === 0) s.features[i] = Feature.Rubble;
    else if ((x * 5 + y * 3) % 17 === 0) s.features[i] = Feature.Cars;
  });
  s.pois = POIS.map((p) => ({ ...p }));
  s.markers = [
    // Unit 09: one riot officer with a stunstick, on the station plaza.
    m('sp_start', 6, 9.5, { faction: 'combine', squad: 'unit_metropolice_riot:1', yaw: 0 }),
    m('scrap', 50, 25.5),
  ];
  return s;
}

// --- Map pieces -----------------------------------------------------------------------------------------

/** Reach areas of the mission ([x0, y0, x1, y1] in world units). */
const AREA = {
  rations: [X(13), Y(8.4), X(21), Y(12)] as [number, number, number, number],
  flyer: [X(32), Y(11.4), X(34.5), Y(14.6)] as [number, number, number, number],
  gate: [X(36), Y(21.4), X(43), Y(24)] as [number, number, number, number],
  asset: [X(34.4), Y(25.4), X(37.6), Y(28.6)] as [number, number, number, number],
};
const SPOTS = {
  loiterer: [11.6, 14.5],
  litterer: [17, 8.1],
  runner: [23, 12.5],
  hideout: [28.5, 18.6],
  flyer: [33.2, 13],
  asset: [36, 27],
  relay: [46, 28.5],
  hq: [49.8, 30],
  striders: [56, 3],
  waves: [[36, 46.4], [40, 46.6], [44, 46.4]] as [number, number][],
  outpost: [44, 28],
};
/** Gap of the checkpoint (the POI's centre line). */
const GATE = { x: X(39.5), y: Y(20), w: 192 };

/** Abilities the Stalker and the garrison offer, locked at the start and unlocked one objective at a time. */
const BUILD_MENU = [
  'build_comb_hq', 'build_comb_powergenerator', 'build_comb_energycell', 'build_comb_garrison', 'build_comb_armory',
  'build_comb_synthfactory', 'build_comb_powergenerator_scrap', 'build_comb_mech_factory', 'build_comb_barricade', 'build_comb_mortar',
  'build_comb_headcrabcanisterlauncher', 'build_comb_shieldgen', 'build_comb_bunker', 'build_comb_regenerationpost',
];
const SOLDIERS = ['unit_combine', 'unit_combine_sg', 'unit_combine_ar2', 'unit_combine_heavy'];
/** The HQ's own menu: no more Stalkers and no population upgrades in the tutorial. */
const HQ_MENU = ['unit_stalker', 'comb_popupgrade1'];

export interface CivilReport {
  brushes: number;
  props: number;
  decals: number;
  entities: number;
  connections: number;
  notes: string[];
}

/** The station (world units): the concourse north of the train shed, its exit onto the housing street. */
export const STATION = {
  // Off the map edge: walls on the edges of the ground brushes there give more t-junctions than vbsp can fix.
  west: X(0) + 48,
  south: Y(0) + 48,
  /** The wall between concourse and shed (centre line). */
  divider: Y(7) + 16,
  north: Y(19) + 48,
  /** The concourse's east front (on the housing street) and the shed's east wall. */
  front: X(21) + 16,
  // Clear of the housing block's buildings (which start at X(22)): walls flush with theirs add t-junctions.
  shedEast: X(22) - 48,
  /** The door in the front, where the street meets it. */
  door: [Y(12), Y(14)] as [number, number],
  /** Archways from the concourse onto the shed's walkway. */
  arches: [[X(2), X(4)], [X(6.5), X(8.5)], [X(11), X(13)], [X(18.5), X(20.5)]] as [number, number][],
  /** The Breencast billboard on the north wall: no windows behind it. */
  billboard: [X(8) - 16, X(11) + 16] as [number, number],
};

/**
 * The station Unit 09 starts in, after the HL2 one: a tall concourse with the ration line, benches and the
 * Breencast, archways through to a train shed over the rail yard, and one door in its stone front onto the
 * housing street. Walls 416 high with a band of windows, an invisible roof that keeps the sun out apart from
 * skylight strips (shafts of light), girders across the top and lamps on the columns. `ground` gives the floor
 * height (the editor's raycast; 0 without one).
 */
export function buildStation(editor: Editor, ground: (x: number, y: number) => number = () => 0): { brushes: number; props: number } {
  const doc = editor.doc;
  const S = STATION;
  const T = 32, FLOOR = -16, HEIGHT = 432;
  /** The window band's slot, above the floor. */
  const BAND = [240, 400] as const;
  let props = 0;
  const addEnt = (cls: string, origin: Vector3, keys: Record<string, string>) => doc.addEntity(entityNode(editor, cls, origin.clone().round(), keys));
  /** A prop on the floor (`lift` above it), prop_static where the model allows it. */
  const prop = (model: string, x: number, y: number, yaw = 0, lift = 0) => {
    const b = MODEL_BOUNDS[model];
    addEnt(b && b[6] === 0 ? 'prop_dynamic' : 'prop_static', new Vector3(x, y, ground(x, y) + lift - (b ? b[2] : 0)), { model: `models/${model}.mdl`, angles: `0 ${Math.round(yaw)} 0`, solid: '6' });
    props++;
  };
  // Tall window models high up the inside of the walls that have no window band, every 256 except where
  // something else is. Separate window holes would split a wall into piers, sills and lintels: more t-junctions
  // than vbsp can fix in this city. The front's stone shows windows of its own outside.
  const windows = (from: number, to: number, skip: [number, number][] = []): number[] => {
    const out: number[] = [];
    for (let c = Math.min(from, to) + 192; c <= Math.max(from, to) - 128; c += 256) {
      if (!skip.some(([s0, s1]) => c + 96 > Math.min(s0, s1) && c - 96 < Math.max(s0, s1))) out.push(c);
    }
    return out;
  };
  /**
   * A wall from a to b (extended by half its thickness at both ends), cut for doors at world ranges along it, with
   * window models at `panes` or a window band (one long slot high up, glazed) over the `band` ranges.
   */
  const wall = (ax: number, ay: number, bx: number, by: number, inside: 1 | 0, doors: [number, number, number][], panes: number[], band: [number, number][] = []): HallWall => {
    const dir = new Vector2(bx - ax, by - ay).normalize();
    const a = new Vector2(ax, ay).addScaledVector(dir, -T / 2), b = new Vector2(bx, by).addScaledVector(dir, T / 2);
    const along = (w: number) => (dir.x !== 0 ? (w - a.x) * dir.x : (w - a.y) * dir.y);
    const span = (w0: number, w1: number) => [Math.min(along(w0), along(w1)), Math.max(along(w0), along(w1))];
    // The window models stand on the inner face, facing in (the model's thin axis is its x).
    const n = new Vector2(-dir.y, dir.x);
    for (const c of panes) {
      const p = new Vector2(dir.x !== 0 ? c : ax, dir.y !== 0 ? c : ay).addScaledVector(n, T / 2 + 4);
      addEnt('prop_static', new Vector3(p.x, p.y, FLOOR + 320), { model: 'models/pg_props/pg_buildings/pg_big_hall_window.mdl', angles: `0 ${Math.round((Math.atan2(n.y, n.x) * 180) / Math.PI)} 0`, solid: '0' });
      props++;
    }
    return {
      a, b, thickness: T, inside,
      openings: [
        ...doors.map(([w0, w1, top]) => { const [from, to] = span(w0, w1); return { from, to, z0: 0, z1: top - FLOOR }; }),
        ...band.map(([w0, w1]) => { const [from, to] = span(w0, w1); return { from, to, z0: BAND[0], z1: BAND[1] }; }),
      ],
    };
  };
  /** Window band ranges along a wall from `from` to `to`, kept 128 off the corners and clear of `skip` ranges. */
  const bandOf = (from: number, to: number, skip: [number, number][] = []): [number, number][] => {
    let out: [number, number][] = [[Math.min(from, to) + 128, Math.max(from, to) - 128]];
    for (const [s0, s1] of skip) {
      const k0 = Math.min(s0, s1) - 64, k1 = Math.max(s0, s1) + 64;
      out = out.flatMap(([a0, a1]): [number, number][] => (k1 <= a0 || k0 >= a1 ? [[a0, a1]] : [[a0, k0], [k1, a1]]));
      out = out.filter(([u, v]) => v - u >= 128);
    }
    return out;
  };
  const doorTop = 256, archTop = 304;
  // The ration lanes' east barricades stood where the door now opens.
  for (const e of doc.entities.filter((q) => q.classname === 'prop_static' && /combine_barricade/.test(q.get('model') ?? '') && q.origin
    && q.origin.x > S.front - 96 && q.origin.x < S.front && q.origin.y > S.door[0] - 128 && q.origin.y < S.door[1] + 96)) doc.removeEntity(e);
  // Pilasters on the walls the camera looks at (it looks north-west: the north and west walls' inner faces).
  // The north wall's every 384 clear of the billboard and its monitors; the west wall's every 512, a window model
  // between each two.
  const monitors = [S.billboard[0] - 160, S.billboard[1] + 160];
  const northPilasters: number[] = [];
  for (let x = S.west + 208; x < S.front - 160; x += 384) {
    if (x > S.billboard[0] - 64 && x < S.billboard[1] + 64) continue;
    if (monitors.some((m) => Math.abs(m - x) < 72)) continue;
    northPilasters.push(x);
  }
  const westPilasters: number[] = [];
  for (let y = S.south + 192; y < S.north - 160; y += 512) if (Math.abs(y - S.divider) > 96) westPilasters.push(y);
  // Pillars on the grid of the north and west pilasters, wherever the floor is free: not on the benches, the
  // crowds, the start, the ration area or the ways between them.
  const busy: [number, number, number, number][] = [
    [X(6.6), Y(12.2), X(12.2), Y(14)], [X(8.4), Y(14.6), X(10.8), Y(17)], [X(10.6), Y(9.8), X(12.4), Y(11.6)],
    [X(5), Y(8.6), X(7), Y(10.6)], [X(12.6), Y(8.2), X(21), Y(17.4)],
  ];
  const pillars: [number, number][] = [];
  for (const x of northPilasters) for (const y of westPilasters) {
    if (y < S.divider + 256 || y > S.north - 256 || x > X(12)) continue;
    if (!busy.some(([a0, b0, a1, b1]) => x > a0 - 64 && x < a1 + 64 && y > b0 - 64 && y < b1 + 64)) pillars.push([x, y]);
  }
  // The sun comes from the north-east (light_environment yaw 215): window bands in the north and east walls let
  // it fall into the hall in slanting shafts; the other walls have window models.
  const walls: HallWall[] = [
    wall(S.west, S.south, S.shedEast, S.south, 1, [], windows(S.west, S.shedEast)),
    wall(S.shedEast, S.south, S.shedEast, S.divider, 1, [], [], bandOf(S.south, S.divider)),
    wall(S.shedEast, S.divider, S.front, S.divider, 1, [], []),
    wall(S.front, S.divider, S.front, S.north, 1, [[S.door[0], S.door[1], doorTop]], [], bandOf(S.divider, S.north, [S.door])),
    wall(S.front, S.north, S.west, S.north, 1, [], [], bandOf(S.west, S.front, [S.billboard])),
    wall(S.west, S.north, S.west, S.south, 1, [], westPilasters.map((y) => y + 256).filter((y) => y < S.north - 160 && Math.abs(y - S.divider) > 160)),
    wall(S.west, S.divider, S.front, S.divider, 0, S.arches.map(([x0, x1]) => [x0, x1, archTop]), []),
  ];
  // Skylights: two strips along the concourse, one over each outer track of the shed, broken by roof bands.
  const bands: [number, number][] = [[X(1), X(7)], [X(8), X(14)], [X(15), X(20.5)]];
  const strips = (ys: [number, number][]) => ys.flatMap(([y0, y1]) => bands.map(([x0, x1]): [number, number, number, number] => [x0, y0, x1, y1]));
  const hallSkylights = strips([[Y(10.5) - 48, Y(10.5) + 48], [Y(15.5) - 48, Y(15.5) + 48]]);
  const shedSkylights = strips([[Y(1.5) - 40, Y(1.5) + 40], [Y(5.5) - 40, Y(5.5) + 40]]);
  const inner = { x0: S.west + T / 2, x1: S.front - T / 2, south: S.south + T / 2, divider0: S.divider - T / 2, divider1: S.divider + T / 2, north: S.north - T / 2 };
  const hall = hallBrushes(doc, {
    floorZ: FLOOR, height: HEIGHT, walls,
    materials: {
      inner: 'STONE/STONEWALL050A', outer: 'BUILDING_TEMPLATE/BUILDING_TRAINSTATION_TEMPLATE002R', outerScale: 0.5,
      cap: 'CONCRETE/CONCRETEFLOOR028A', glass: 'GLASS/GLASSWINDOW029A',
    },
    // Over the walls and a little beyond (the roof floats a little above the wall tops), but not touching the
    // buildings next door.
    roofs: [
      { rect: [S.west - 40, S.divider, S.front + 40, S.north + 40], skylights: hallSkylights },
      { rect: [S.west - 40, S.south - 40, S.shedEast + 40, S.divider], skylights: shedSkylights },
    ],
  });
  for (const n of hall.world) doc.addSolid(n);
  const brushEnt = (cls: string, keys: Record<string, string>, solids: KVNode[]) => {
    const e = new KVNode('entity');
    e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', cls));
    for (const [k, v] of Object.entries(keys)) e.items.push(new KVPair(k, v));
    e.items.push(...solids, editorBlock());
    doc.addEntity(e);
  };
  // The roof blocks the sun from a func_brush (see HallBrushes.roof), so it adds nothing to the world's
  // t-junctions; so do the beams, trusses and relief (station_relief below).
  brushEnt('func_brush', { targetname: 'station_roof', Solidity: '1', spawnflags: '2', rendermode: '10', disableshadows: '1', vrad_brush_cast_shadows: '1', StartDisabled: '0' }, hall.roof);
  // The glass of the window bands: never solid, and it lets the light through (no vrad shadow).
  brushEnt('func_brush', { targetname: 'station_glass', Solidity: '1', spawnflags: '2', rendermode: '0', disableshadows: '1', vrad_brush_cast_shadows: '0', StartDisabled: '0' }, hall.glass);
  // Relief on the walls the camera sees: a grimy stone plinth, a moulding ledge, pilasters with bases and
  // capitals, and a stepped cornice under the (invisible) roof. A brush entity, so none of it adds to vbsp's
  // t-junctions; it casts shadows in the sun shafts.
  const TRIM = 'BUILDING_TEMPLATE/BUILDING_TEMPLATE003A', PLINTH = 'STONE/STONEWALL029B', NODRAW = 'TOOLS/TOOLSNODRAW';
  const TOP = FLOOR + HEIGHT;
  const relief: KVNode[] = [];
  /** A box on a wall face: `along` a range along the wall, `out` how far it stands proud, z0..z1 in world z. */
  const onWall = (face: { axis: 'x' | 'y'; at: number; n: 1 | -1 }, a0: number, a1: number, out: number, z0: number, z1: number, mat: string) => {
    const w0 = face.at, w1 = face.at + face.n * out;
    const min = face.axis === 'y' ? new Vector3(a0, Math.min(w0, w1), z0) : new Vector3(Math.min(w0, w1), a0, z0);
    const max = face.axis === 'y' ? new Vector3(a1, Math.max(w0, w1), z1) : new Vector3(Math.max(w0, w1), a1, z1);
    relief.push(boxSolid(doc, min, max, { top: mat, bottom: NODRAW, sides: mat }));
  };
  const faces = [
    { face: { axis: 'y' as const, at: S.north - T / 2, n: -1 as const }, from: S.west + T / 2, to: S.front - T / 2, pilasters: northPilasters },
    { face: { axis: 'x' as const, at: S.west + T / 2, n: 1 as const }, from: S.divider + T / 2, to: S.north - T / 2, pilasters: westPilasters.filter((y) => y > S.divider) },
    { face: { axis: 'x' as const, at: S.west + T / 2, n: 1 as const }, from: S.south + T / 2, to: S.divider - T / 2, pilasters: westPilasters.filter((y) => y < S.divider) },
  ];
  for (const { face, from, to, pilasters } of faces) {
    onWall(face, from, to, 8, FLOOR, FLOOR + 80, PLINTH);
    onWall(face, from, to, 12, FLOOR + 112, FLOOR + 124, TRIM);
    onWall(face, from, to, 12, TOP - 56, TOP - 40, TRIM);
    onWall(face, from, to, 28, TOP - 40, TOP, TRIM);
    for (const c of pilasters) {
      onWall(face, c - 36, c + 36, 24, FLOOR, FLOOR + 112, TRIM);
      onWall(face, c - 24, c + 24, 16, FLOOR + 112, TOP - 80, TRIM);
      onWall(face, c - 36, c + 36, 24, TOP - 80, TOP - 56, TRIM);
    }
  }
  // The front door, outside: jambs, a lintel and the station's arch ornament above it.
  const front = { axis: 'x' as const, at: S.front + T / 2, n: 1 as const };
  onWall(front, S.door[0] - 40, S.door[0], 20, FLOOR, FLOOR + doorTop + 32, TRIM);
  onWall(front, S.door[1], S.door[1] + 40, 20, FLOOR, FLOOR + doorTop + 32, TRIM);
  onWall(front, S.door[0] - 56, S.door[1] + 56, 24, FLOOR + doorTop, FLOOR + doorTop + 48, TRIM);
  addEnt('prop_static', new Vector3(S.front + T / 2 + 24, (S.door[0] + S.door[1]) / 2, FLOOR + doorTop + 48), { model: 'models/props_trainstation/trainstation_arch001.mdl', angles: '0 0 0', solid: '0' });
  props++;
  // The concourse's roof structure: thin steel girders across it, one from each north pilaster. (Heavy stone
  // beams, as in the coffered HL2 hall, read wrong from the RTS camera: just under it they look huge, and their
  // tops face the unlit underside of the roof, so they show as thick black bands over the floor.)
  const beamZ: [number, number] = [TOP - 56, TOP - 8];
  for (const x of northPilasters) relief.push(boxSolid(doc, new Vector3(x - 8, inner.divider1, TOP - 24), new Vector3(x + 8, inner.north, TOP - 8), 'METAL/METALBAR001A'));
  // Square pillars in the open west half, around the start, where a girder meets a west pilaster's line. Their
  // shafts are world brushes, so the navmesh goes around them; base and capital are decoration.
  for (const [px, py] of pillars) {
    doc.addSolid(boxSolid(doc, new Vector3(px - 32, py - 32, FLOOR), new Vector3(px + 32, py + 32, beamZ[0]), { top: NODRAW, bottom: NODRAW, sides: 'STONE/STONEWALL050A' }));
    relief.push(boxSolid(doc, new Vector3(px - 48, py - 48, FLOOR), new Vector3(px + 48, py + 48, FLOOR + 64), { top: TRIM, bottom: NODRAW, sides: TRIM }));
    relief.push(boxSolid(doc, new Vector3(px - 48, py - 48, beamZ[0] - 32), new Vector3(px + 48, py + 48, beamZ[0]), { top: TRIM, bottom: TRIM, sides: TRIM }));
  }
  // Skylight frames: dark metal around every opening, so the invisible roof still shows where it is.
  const FRAME = 'METAL/METALBAR001A';
  for (const [x0, y0, x1, y1] of [...hallSkylights, ...shedSkylights]) {
    for (const [a, b] of [[new Vector3(x0 - 12, y0 - 12, TOP - 8), new Vector3(x1 + 12, y0, TOP + 24)], [new Vector3(x0 - 12, y1, TOP - 8), new Vector3(x1 + 12, y1 + 12, TOP + 24)],
      [new Vector3(x0 - 12, y0, TOP - 8), new Vector3(x0, y1, TOP + 24)], [new Vector3(x1, y0, TOP - 8), new Vector3(x1 + 12, y1, TOP + 24)]]) {
      relief.push(boxSolid(doc, a, b, FRAME));
    }
  }
  // The train shed: steel trusses across it (top and bottom chords, posts between), and a footbridge over the
  // tracks above the trains, like the walkway in the HL2 station.
  const STEEL = 'METAL/METALBAR001A';
  for (let x = inner.x0 + 320; x < S.shedEast - T / 2 - 160; x += 320) {
    relief.push(boxSolid(doc, new Vector3(x - 8, inner.south, TOP - 24), new Vector3(x + 8, inner.divider0, TOP - 8), STEEL));
    relief.push(boxSolid(doc, new Vector3(x - 8, inner.south, TOP - 104), new Vector3(x + 8, inner.divider0, TOP - 88), STEEL));
    for (let y = inner.south + 80; y < inner.divider0 - 40; y += 160) relief.push(boxSolid(doc, new Vector3(x - 6, y - 6, TOP - 88), new Vector3(x + 6, y + 6, TOP - 24), STEEL));
  }
  const bridgeX = X(13.5), deck = FLOOR + 296;
  // Small lamps over the walkway: under the roof its deck would otherwise show as a black strip from above.
  for (let y = inner.south + 160; y < inner.divider0 - 64; y += 288) {
    addEnt('light', new Vector3(bridgeX, y, deck + 72), { _light: '255 210 160 80', _lightHDR: '-1 -1 -1 1', _quadratic_attn: '1', _fifty_percent_distance: '64', _zero_percent_distance: '200' });
  }
  relief.push(boxSolid(doc, new Vector3(bridgeX - 48, inner.south, deck), new Vector3(bridgeX + 48, inner.divider0, deck + 12), { top: 'METAL/METALFLOOR001A', bottom: STEEL, sides: STEEL }));
  for (const side of [-1, 1]) {
    const rx = bridgeX + side * 44;
    relief.push(boxSolid(doc, new Vector3(rx - 4, inner.south, deck + 52), new Vector3(rx + 4, inner.divider0, deck + 58), 'METAL/METALRAIL001A'));
    for (let y = inner.south + 32; y < inner.divider0; y += 128) relief.push(boxSolid(doc, new Vector3(rx - 3, y - 3, deck + 12), new Vector3(rx + 3, y + 3, deck + 52), 'METAL/METALRAIL001A'));
  }
  brushEnt('func_brush', { targetname: 'station_relief', Solidity: '1', spawnflags: '2', rendermode: '0', disableshadows: '1', vrad_brush_cast_shadows: '1', StartDisabled: '0' }, relief);
  // The concourse floor: a beige and brown checker of stone tiles, dark enough not to light the hall back up.
  doc.addSolid(boxSolid(doc, new Vector3(inner.x0, inner.divider1, -12), new Vector3(inner.x1, inner.north, 4), { top: 'TILE/TILEFLOOR010A', bottom: 'TOOLS/TOOLSNODRAW', sides: 'TOOLS/TOOLSNODRAW' }));
  // Light: the roof keeps the daylight out except through the skylights and window bands; inside, only lamps you
  // can see, each a small warm pool (short falloff), so the hall stays dim between them as in the HL2 station.
  const light = (at: Vector3, color: string, fifty: number, zero: number) =>
    addEnt('light', at, { _light: color, _lightHDR: '-1 -1 -1 1', _quadratic_attn: '1', _fifty_percent_distance: String(fifty), _zero_percent_distance: String(zero) });
  const hanging = (x: number, y: number, z = 260) => {
    addEnt('prop_static', new Vector3(x, y, ground(x, y) + z), { model: 'models/props_c17/lampfixture01a.mdl', angles: '0 0 0', solid: '0' });
    props++;
    light(new Vector3(x, y, ground(x, y) + z - 18), '255 208 156 150', 128, 448);
  };
  /** A lit lantern on a column or pilaster at (x, y), `out` in front of its centre, facing `face`. */
  const lantern = (x: number, y: number, face: number, out: number) => {
    const c = Math.cos((face * Math.PI) / 180), sn = Math.sin((face * Math.PI) / 180);
    addEnt('prop_static', new Vector3(x + c * out, y + sn * out, ground(x, y) + 190), { model: 'models/props_trainstation/column_light001a.mdl', angles: `0 ${face} 0`, solid: '0' });
    props++;
    light(new Vector3(x + c * (out + 18), y + sn * (out + 18), ground(x, y) + 190), '255 196 140 90', 96, 384);
  };
  // Columns between the arches, each with its lantern.
  const column = (x: number, y: number, face: number) => {
    prop('props_trainstation/trainstation_column001', x, y, 0);
    lantern(x, y, face, 14);
  };
  // Hanging lamps over the benches, the ration counter and the middle of the lanes, and along the platform.
  for (const x of [X(8.2), X(10.4)]) hanging(x, Y(13.1));
  const rations = POIS.find((q) => q.type === 'rations')!;
  const laneX = (i: number) => X(rations.x) + (rations.w * C) / 2 + (i - 1) * 176;
  const headY = Y(rations.y) + rations.h * C - 320 + 16;
  for (let i = 0; i < 3; i++) { hanging(laneX(i), headY + 24); hanging(laneX(i), headY - 320); }
  for (let x = X(2); x < S.shedEast - 256; x += 512) hanging(x, Y(0) + 368, 240);
  // The Breencast's cold glow on the floor in front of the billboard.
  light(new Vector3(X(9.5), S.north - 96, 200), '165 200 255 110', 128, 512);
  // Lanterns on the pillars, facing the camera, and on every other pilaster of the north and west walls.
  for (const [px, py] of pillars) lantern(px, py, 315, 32);
  northPilasters.forEach((x, i) => { if (i % 2 === 0) lantern(x, inner.north, 270, 28); });
  westPilasters.forEach((y) => lantern(inner.x0, y, 0, 28));
  const archFree = (x: number) => !S.arches.some(([a0, a1]) => x > a0 - 48 && x < a1 + 48);
  for (let x = X(1.5); x < X(12.5); x += 384) if (archFree(x)) column(x, inner.divider1 + 12, 90);
  // Waiting room: two rows of benches facing the Breencast (the crowd stands in front of them), bins at the
  // row ends, payphones on the west wall.
  for (const y of [Y(12.6), Y(13.6)]) for (let x = X(7.3); x <= X(11.2); x += 92) prop('props_trainstation/bench_indoor001a', x, y, 90);
  for (const y of [Y(12.6), Y(13.6)]) { prop('props_trainstation/trashcan_indoor001b', X(6.8), y); prop('props_trainstation/trashcan_indoor001b', X(11.8), y); }
  for (const y of [Y(10.5), Y(11), Y(11.5)]) prop('props_trainstation/payphone001a', inner.x0 + 20, y, 0);
  // Combine monitors on the north wall either side of the billboard, ornaments by the door.
  for (const x of [S.billboard[0] - 160, S.billboard[1] + 160]) prop('props_combine/combine_intmonitor003', x, inner.north - 4, 270, 120);
  for (const y of [S.door[0] - 48, S.door[1] + 48]) prop('props_trainstation/trainstation_ornament001', inner.x1 - 28, y, 180);
  return { brushes: hall.world.length + hall.roof.length + 1, props };
}

/**
 * The ration line in use: a walking queue in each of the three lanes (the rations POI puts them 176 apart,
 * their heads 320 from its far edge, in front of the counter). The outer lanes leave to their own side; the
 * middle one also goes west, a little further out. Each line starts at its own time so they don't step together.
 * Around it, all neutral set dressing: Civil Protection behind the counter (between the booth and the crates)
 * and at the entrance corners, a scanner over the lines, citizens on the plaza watching the Breencast and a
 * few by the way to the lines. `ground` gives the floor height (the editor's raycast; 0 without one).
 */
export function decorateRationLine(editor: Editor, ground: (x: number, y: number) => number = () => 0): void {
  const kit = (id: string, pos: Vector3, params: Record<string, ParamValue>) => {
    const k = KITS.find((x) => x.id === id)!;
    return k.place(editor, pos, { ...Object.fromEntries(k.params.map((p) => [p.key, p.default])), ...params });
  };
  const on = (x: number, y: number) => new Vector3(Math.round(x), Math.round(y), Math.round(ground(x, y)));
  const rations = POIS.find((q) => q.type === 'rations')!;
  const laneX = (i: number) => X(rations.x) + (rations.w * C) / 2 + (i - 1) * 176;
  const headY = Y(rations.y) + rations.h * C - 320 + 16;
  const lanes: [string, number, number][] = [['left', 176, 1], ['left', 300, 3.3], ['right', 176, 5.6]];
  lanes.forEach(([side, out, phase], i) => kit('queue', on(laneX(i), headY), {
    name: `ration_line${i + 1}`, unit: 'unit_citizen', owner: '0', slots: 12, spacing: 52, yaw: 90, length: 700, side, out, interval: 7, phase,
  }));
  const guards: [number, number, number][] = [[laneX(0) + 10, headY + 140, 270], [laneX(2) + 48, headY + 130, 270], [laneX(0) - 320, headY - 790, 45], [laneX(2) + 320, headY - 790, 135]];
  for (const [gx, gy, yaw] of guards) placeUnits(editor, 'unit_metropolice', [on(gx, gy).setZ(ground(gx, gy) + 4)], '0', 'ration_guard', yaw);
  placeUnits(editor, 'unit_scanner', [on(laneX(1), headY - 300)], '0', 'ration_scanner', 270);
  placeUnits(editor, 'unit_citizen', spread(on(X(9.5), Y(15.5)), 10, 80), '0', 'plaza_crowd', 90);
  placeUnits(editor, 'unit_citizen', spread(on(X(11.4), Y(10.6)), 4, 72), '0', 'plaza_crowd', 0);
}

/** Adds the set pieces, units, cinematics and logic to the generated map, and the mission flowchart. */
export async function decorateCivilProtection(editor: Editor): Promise<CivilReport> {
  const doc = editor.doc;
  const rng = new Rng(1709);
  const notes: string[] = [];
  let brushes = 0, props = 0, decals = 0;
  const ground = (x: number, y: number) => groundBelow(editor, new Vector3(x, y, 900)) ?? 0;
  const at = (cx: number, cy: number, dz = 0) => { const x = X(cx), y = Y(cy); return new Vector3(Math.round(x), Math.round(y), Math.round(ground(x, y) + dz)); };
  const addEnt = (cls: string, origin: Vector3, keys: Record<string, string>) => doc.addEntity(entityNode(editor, cls, origin.clone().round(), keys));
  const addSpecs = (specs: EntitySpec[]) => specs.map((s) => addEnt(s.classname, s.origin, s.keys));
  /** A prop standing on the ground: prop_static where the model allows it. */
  const prop = (model: string, x: number, y: number, yaw = 0, keys: Record<string, string> = {}) => {
    const b = MODEL_BOUNDS[model];
    const z = ground(x, y) - (b ? b[2] : 0);
    const cls = b && b[6] === 0 ? 'prop_dynamic' : 'prop_static';
    addEnt(cls, new Vector3(x, y, z), { model: `models/${model}.mdl`, angles: `0 ${Math.round(yaw)} 0`, solid: '6', ...keys });
    props++;
  };
  const brushEntity = (cls: string, keys: Record<string, string>, min: Vector3, max: Vector3, material: string) => {
    const e = new KVNode('entity');
    e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', cls));
    for (const [k, v] of Object.entries(keys)) e.items.push(new KVPair(k, v));
    e.items.push(boxSolid(doc, min, max, material), editorBlock());
    brushes++;
    return doc.addEntity(e);
  };
  const kit = (id: string, pos: Vector3, params: Record<string, ParamValue>) => {
    const k = KITS.find((x) => x.id === id)!;
    const defaults = Object.fromEntries(k.params.map((p) => [p.key, p.default]));
    return k.place(editor, pos, { ...defaults, ...params });
  };
  const byName = (n: string) => doc.entities.find((e) => e.get('targetname') === n);

  recordKit(editor, 'Civil Protection set pieces', () => {
    // The station around the start: concourse, train shed, the door onto the housing street.
    const station = buildStation(editor, ground);
    brushes += station.brushes;
    props += station.props;
    // The checkpoint's forcefield gate: a never-solid func_brush for the look, a func_nav_blocker that keeps
    // units out of the gap until the gate opens (Disable unblocks the navmesh there).
    brushEntity('func_brush', { targetname: 'outpost_gate', Solidity: '1', StartDisabled: '0', rendermode: '0', disableshadows: '1', vrad_brush_cast_shadows: '0' },
      new Vector3(GATE.x - GATE.w / 2, GATE.y - 2, 0), new Vector3(GATE.x + GATE.w / 2, GATE.y + 2, 160), 'EFFECTS/COMBINESHIELD/COMSHIELDWALL');
    brushEntity('func_nav_blocker', { targetname: 'outpost_gate_nav', StartDisabled: '0' },
      new Vector3(GATE.x - GATE.w / 2 - 16, GATE.y - 32, -16), new Vector3(GATE.x + GATE.w / 2 + 16, GATE.y + 32, 128), 'TOOLS/TOOLSNODRAW');

    // A billboard on the concourse's north wall for the Breencast screen (the screen itself is added below).
    const bx0 = X(8), bx1 = X(11), by = Y(19) + 24;
    doc.addSolid(boxSolid(doc, new Vector3(bx0, by, -8), new Vector3(bx1, by + 16, 304), { top: 'METAL/METALWALL003A', bottom: 'TOOLS/TOOLSNODRAW', sides: 'METAL/METALWALL003A' }));
    brushes++;

    // Canal street: chain fences along the pavements.
    for (const yy of [15, 17]) {
      prop('props_c17/fence03a', X(36) + 10, Y(yy), 0);
      prop('props_c17/fence03a', X(43) - 10, Y(yy), 0);
    }
    // Outpost Kilo: floodlights in the corners, crates, Combine barriers on the canal edge either side of
    // the bridge approach.
    for (const [cx, cy, yaw] of [[32.6, 23.6, 45], [52.4, 23.6, 135], [32.6, 32.3, 315], [52.4, 32.3, 225]] as const) {
      prop('props_c17/light_floodlight02_off', X(cx), Y(cy), yaw);
      addEnt('light', new Vector3(X(cx), Y(cy), 150).add(new Vector3(cx < 40 ? 64 : -64, cy < 28 ? 64 : -64, 0)), { _light: '215 230 255 220', _lightHDR: '-1 -1 -1 1', _quadratic_attn: '1', _fifty_percent_distance: '420', _zero_percent_distance: '900' });
    }
    for (const [cx, cy] of [[33.4, 31.2], [33.9, 31.4], [33.3, 30.6], [52.2, 24.2], [51.8, 24.5], [50.8, 23.9]] as const) prop('pg_props/pg_obj/ja_combine_crate', X(cx), Y(cy), rng.int(0, 3) * 90);
    for (let cx = 33; cx <= 51; cx += 0.75) {
      if (cx > 37.5 && cx < 42.5) continue;
      prop('props_combine/combine_barricade_tall01a', X(cx), Y(32.75), 0);
    }
    // The flyer on the housing street, and a can by the litterer.
    prop('props_c17/paper01', X(SPOTS.flyer[0]), Y(SPOTS.flyer[1]), 30);
    // Burnt-out cars in the old city (they burn after the uprising starts).
    for (const [model, cx, cy, yaw] of [['props_vehicles/car002b', 31, 42.5, 20], ['props_vehicles/car004b', 49, 42.4, 160], ['props_vehicles/car003b', 41.2, 46.2, 80]] as const) prop(model, X(cx), Y(cy), yaw);
  });

  // --- Units ------------------------------------------------------------------------------------------------
  recordKit(editor, 'Civil Protection units', () => {
    // Act 1 citizens start neutral (owner 0): the stage that introduces each one makes it an enemy, so Unit 09
    // does not correct them before the objective asks for it.
    const citizen = (name: string, [cx, cy]: number[]) => {
      for (const e of kit('unit_group', at(cx, cy), { unit: 'unit_citizen', count: 1, owner: '0', name })) e.set('health', '15');
    };
    citizen('loiterer', SPOTS.loiterer);
    citizen('litterer', SPOTS.litterer);
    citizen('runner', SPOTS.runner);
    // Fog of war lifted over the ration line for the first objectives, as sp_radio_tower does around its tower:
    // an invisible scan unit of the player (896 units of sight, enough for the lanes and all three citizens).
    // The flyer stage kills it. It counts as one population while it lives.
    addEnt('unit_scan', at(17, 13, 32), { targetname: 'reveal_rations', unittype: 'unit_scan', ownernumber: '2' });
    decorateRationLine(editor, ground);
    // The runner flees to the order entity itself (an info_target as order target ends the move at once).
    addEnt('wars_give_order', at(SPOTS.hideout[0], SPOTS.hideout[1], 16), { targetname: 'runner_flee', unitname: 'runner', overwriteexistingorders: '1' });
    // The asset: a Stalker standing in the outpost, neutral until Unit 09 takes command of it.
    kit('unit_group', at(SPOTS.asset[0], SPOTS.asset[1]), { unit: 'unit_stalker', count: 1, owner: '0', name: 'asset' });
    kit('capture_point', at(SPOTS.relay[0], SPOTS.relay[1]), { name: 'outpost_relay', radius: 224, owner: '0', time: 15 });
    // The outpost's Citadel (HQ): Combine population comes only from it (without it the garrison can't
    // train anyone) and it adds Requisition over time. Neutral until the uprising hands Unit 09 the sector.
    addEnt('build_comb_hq', at(SPOTS.hq[0], SPOTS.hq[1]), { targetname: 'outpost_hq', ownernumber: '0', constructed: '2', angles: '0 180 0' });
    // The Overwatch Striders wait at the far end of the boulevard (neutral, out of sight) for the finale.
    kit('unit_group', at(SPOTS.striders[0], SPOTS.striders[1]), { unit: 'unit_strider', count: 2, owner: '0', name: 'striders' });
    // Rebel waves from the old city, all sent to the outpost over the bridge.
    const waves: [string, string, number, number, number][] = [
      ['wave1', 'unit_rebel_partisan_molotov', 6, 6, 2],
      ['wave2', 'unit_rebel', 10, 5, 4],
      ['wave3', 'unit_rebel_rpg', 6, 3, 6],
    ];
    waves.forEach(([name, unit, count, live, freq], i) => {
      kit('wave', at(SPOTS.waves[i][0], SPOTS.waves[i][1]), { name, unit, count, live, freq, owner: '1', goal: 0, disabled: true });
      // The wave's order entity is its goal: it goes to the outpost.
      const order = byName(`${name}_order`);
      if (order) order.origin = at(SPOTS.outpost[0], SPOTS.outpost[1], 16);
    });
    applyStandardRelations(editor);
  });

  // --- Cinematics -------------------------------------------------------------------------------------------
  recordKit(editor, 'Civil Protection cinematics', () => {
    // The uprising: the camera rises over the outpost and looks across the canal at the old city.
    addSpecs(shotEntities({ name: 'shot_uprising', from: new Vector3(X(43), Y(24), 760), to: new Vector3(X(41), Y(29), 600), lookAt: new Vector3(X(40), Y(45), 320), duration: 9 }));
    // The finale: Striders on the boulevard, the dropship coming in over them.
    addSpecs(shotEntities({ name: 'shot_overwatch', from: new Vector3(X(49), Y(24), 700), to: new Vector3(X(50.5), Y(27), 560), lookAt: new Vector3(X(55.5), Y(13), 200), duration: 10 }));
    addSpecs(pathEntities({ name: 'dropship_route', points: [[56, 1, 900], [56, 14, 860], [52, 24, 660], [44, 30, 540], [38, 37, 600], [30, 44.5, 900]].map(([cx, cy, z]) => new Vector3(X(cx), Y(cy), z)) }));
    addSpecs(pathEntities({ name: 'gunship_route', points: [[24.5, 36.5, 640], [33, 37, 470], [41, 37, 430], [50, 37, 470], [55, 36, 560], [58, 29, 820]].map(([cx, cy, z]) => new Vector3(X(cx), Y(cy), z)) }));
    addSpecs(pathEntities({ name: 'strider_route', points: [[56, 6], [56, 19], [50, 27], [41, 31.4]].map(([cx, cy]) => at(cx, cy, 8)) }));
    // Smoke and fire over the old city, started by the uprising.
    const fx = (effect: string, cx: number, cy: number, dz = 0) => addEnt('info_particle_system', at(cx, cy, dz), { targetname: 'uprising_fx', effect_name: effect, start_active: '0', angles: '0 0 0' });
    fx('smoke_large_01', 28, 45.5, 300);
    fx('smoke_large_01', 52, 45.5, 300);
    fx('smoke_dark_plume_1', 40, 47, 200);
    fx('burning_vehicle', 31, 42.5);
    fx('burning_vehicle', 49, 42.4);
    fx('fire_large_01', 44.5, 46.6);
    fx('embers_large_01', 36, 45);
    // The sirens.
    addEnt('ambient_generic', new Vector3(X(40), Y(30), 240), { targetname: 'uprising_siren', message: 'ambient/levels/citadel/citadel_5sirens.wav', health: '10', pitch: '100', radius: '12000', spawnflags: '49' });
  });
  const firstNode = (path: string) => byName(`${path}_1`)!;
  buildFlyby(editor, firstNode('dropship_route'), 'dropship_container', 650);
  buildFlyby(editor, firstNode('gunship_route'), 'gunship', 700);
  buildSendAlong(editor, firstNode('strider_route'), 'striders', { immortal: true, scripted: true });
  // Screens: the plaza billboard and the outpost's west wall; both cut to static when the rebels take over.
  const plazaScreen = await addScreen(editor, new Vector3(X(9.5), Y(19) + 24, 190), new Vector3(0, -1, 0), 352, 192, 'PROPS/TVSCREEN001A');
  const wallScreen = await addScreen(editor, new Vector3(X(31.5) + 24, Y(28), 96), new Vector3(1, 0, 0), 224, 112, 'PROPS/TVSCREEN001A');
  const screens = [plazaScreen, wallScreen].map((e) => e.get('targetname')!);
  // Atmosphere presets: the Civil Protection lighting arc.
  ATMOSPHERE_PRESETS.forEach((p, i) => buildAtmosphere(editor, p, new Vector3(X(1) + i * 64, Y(1), 96)));

  // --- Decals -----------------------------------------------------------------------------------------------
  const ray = (from: Vector3, dir: Vector3) => new Raycaster(from, dir.normalize(), 0, 600);
  const decal = async (material: string, from: Vector3, dir: Vector3, overlay = 0, rotation = 0) => {
    const e = await placeDecalRay(editor, ray(from, dir), { material, mode: overlay ? 'overlay' : 'decal', size: overlay, rotation });
    if (e) decals++;
    else notes.push(`decal ${material} found no surface`);
  };
  const down = new Vector3(0, 0, -1);
  // Ration papers by the flyer, litter on the plaza.
  await decal('overlays/rationpapers01', new Vector3(X(SPOTS.flyer[0]) + 30, Y(SPOTS.flyer[1]) - 20, 120), down, 96, 20);
  for (const [cx, cy] of [[15, 8.3], [19.5, 8.6], [12.4, 17], [22, 11.3]]) await decal('decals/trashdecal02a', new Vector3(X(cx), Y(cy), 120), down);
  // Lambda graffiti, half painted over, in the alley and on the housing street.
  await decal('decals/decalgraffiti001b', new Vector3(X(29), Y(17), 90), new Vector3(-1, 0, 0), 160, -4);
  await decal('decals/decal_posters002a', new Vector3(X(29), Y(18), 100), new Vector3(1, 0, 0));
  for (const cx of [24, 31, 35]) await decal(rng.pick(['decals/decal_posters001a', 'decals/decal_posters003a', 'decals/decal_posters005a']), new Vector3(X(cx), Y(13), 110), new Vector3(0, 1, 0));
  for (const cx of [26, 33]) await decal('decals/combinepropaganda01a', new Vector3(X(cx), Y(12.5), 150), new Vector3(0, -1, 0));
  // Propaganda in the station: on the concourse's north and west walls.
  for (const cx of [3, 5.5, 13.5]) await decal('decals/combinepropaganda01a', new Vector3(X(cx), Y(17.6), 170), new Vector3(0, 1, 0));
  for (const cy of [13, 16]) await decal(rng.pick(['decals/decal_posters001a', 'decals/decal_posters003a', 'decals/decal_posters005a']), new Vector3(X(1), Y(cy), 120), new Vector3(-1, 0, 0));
  // Scorch marks and blood in the old city.
  for (const [cx, cy] of [[31, 42.5], [49, 42.4], [38, 43.5], [44, 45.5], [27, 42]]) await decal('decals/decal_crater001a', new Vector3(X(cx), Y(cy), 200), down);
  for (const [cx, cy] of [[34, 42], [46, 43]]) await decal('decals/bloodstain_002', new Vector3(X(cx), Y(cy), 200), down);

  // --- Mission ----------------------------------------------------------------------------------------------
  recordKit(editor, 'Civil Protection mission', () => {
    doc.world.set('message', 'Civil Protection');
    doc.world.set('she_description', 'Combine tutorial. Officer Unit 09 starts a routine compliance shift on the station plaza and ends it holding Outpost Kilo against a rebel uprising until Overwatch arrives.');
    // Grey daylight over City 17.
    const sun = doc.entities.find((e) => e.classname === 'light_environment');
    if (sun) {
      sun.set('pitch', '-52');
      sun.set('angles', '0 215 0');
      sun.set('_light', '206 212 220 380');
      sun.set('_ambient', '142 152 166 210');
    }
    doc.entities.find((e) => e.classname === 'env_fog_controller')?.set('fogcolor', ATMOSPHERE_PRESETS[0].fogcolor);
  });
  editor.mission = civilProtectionMission(screens);
  editor.changed();
  const connections = doc.entities.reduce((n, e) => n + getConnections(e).length, 0);
  return { brushes, props, decals, entities: doc.entities.length, connections, notes };
}

// --- Mission flowchart -----------------------------------------------------------------------------------------

/**
 * The tutorial as a flowchart: one stage per objective of the design doc (objectives 1 and 2 share one),
 * plus the outro. Act 1 can't be lost; from the uprising on, losing every unit loses.
 */
export function civilProtectionMission(screens: string[] = ['screen', 'screen_2']): MissionGraph {
  let n = 0;
  const t = (condition: Transition['condition'], to: string, completes = true): Transition => ({ id: `t${++n}`, condition, to, completes });
  const act = (target: string, input: string, param = '', delay = 0) => ({ id: `a${++n}`, target, input, param, delay });
  const gate = (op: AbilityGate['op'], ability: string): AbilityGate => ({ id: `g${++n}`, op, ability, owner: '2' });
  const lost = () => t({ kind: 'destroy_faction', owner: '2' }, 'defeat', false);
  const reach = (area: [number, number, number, number]) => ({ kind: 'reach' as const, area, z: 0, owner: '2' });
  const stage = (id: string, title: string, col: number, row: number, rest: Partial<Stage>): Stage => ({
    // Act rows sit far enough apart for the first stage's long list of locks.
    id, title, x: 40 + col * 320, y: [60, 960, 1300][row], messages: [], objectives: [], actions: [], gates: [], transitions: [], ...rest,
  });
  const stages: Stage[] = [
    // Act 1: Daily Quota.
    stage('shift', 'Daily quota', 0, 0, {
      messages: [{ speaker: 'Dispatch', text: 'Unit 09, sector compliance is at 71 percent. Acceptable is 100. Begin your shift.', hint: 'Left-click your officer to select him, then right-click the ration line to walk there. Drag with the middle mouse button or move to the screen edge to pan, scroll to zoom.' }],
      objectives: [{ id: 'o1', text: 'Select Unit 09 and walk to the ration line' }],
      actions: [act('atmo_day', 'Trigger')],
      gates: [...BUILD_MENU.flatMap((a) => [gate('lock', a), gate('hide', a)]), ...SOLDIERS.map((a) => gate('lock', a)), ...HQ_MENU.map((a) => gate('lock', a))],
      transitions: [t(reach(AREA.rations), 'loiterer')],
    }),
    stage('loiterer', 'The loiterer', 1, 0, {
      messages: [{ speaker: 'Dispatch', text: 'Citizen is loitering. Loitering is a misdemeanor. Correct it.', hint: 'Right-click a target to attack.' }],
      objectives: [{ id: 'o3', text: 'Correct the loitering citizen' }],
      actions: [act('loiterer', 'ChangeOwner', '1')],
      transitions: [t({ kind: 'destroy', target: 'loiterer' }, 'litterer')],
    }),
    stage('litterer', 'Civic litter', 2, 0, {
      messages: [{ speaker: 'Dispatch', text: 'Civic litter detected. Encourage the citizen to resolve it.', hint: 'Attack the citizen. He will learn.' }],
      objectives: [{ id: 'o4', text: 'Correct the citizen who dropped his can' }],
      actions: [act('litterer', 'ChangeOwner', '1')],
      transitions: [t({ kind: 'destroy', target: 'litterer' }, 'runner')],
    }),
    stage('runner', 'The runner', 3, 0, {
      messages: [{ speaker: 'Dispatch', text: 'Fleeing is an admission of guilt. Pursue.', hint: 'Units keep chasing a target until it is down.' }],
      objectives: [{ id: 'o5', text: 'Catch the runner before he reaches the alley' }],
      actions: [act('runner', 'ChangeOwner', '1'), act('runner_flee', 'PerformOrder', '', 1)],
      transitions: [t({ kind: 'destroy', target: 'runner' }, 'flyer')],
    }),
    stage('flyer', 'The flyer', 4, 0, {
      messages: [{ speaker: 'Dispatch', text: 'The runner dropped something on the street. Inspect it.', hint: 'Move Unit 09 onto the paper by the kerb.' }],
      objectives: [{ id: 'o6', text: 'Inspect the dropped flyer' }],
      // The ration area and its three citizens go back under fog of war.
      actions: [act('reveal_rations', 'Kill')],
      transitions: [t(reach(AREA.flyer), 'report')],
    }),
    stage('report', 'Report to Outpost Kilo', 5, 0, {
      messages: [{ speaker: 'Dispatch', text: 'Anticitizen literature. Report to Outpost Kilo for reassignment.', hint: 'Hold Shift and right-click to queue waypoints. The checkpoint gate opens for you.' }],
      objectives: [{ id: 'o7', text: 'Report to Outpost Kilo' }],
      actions: [act('outpost_gate', 'Disable'), act('outpost_gate_nav', 'Disable')],
      transitions: [t(reach(AREA.gate), 'asset')],
    }),
    // Act 2: Outpost Kilo.
    stage('asset', 'The asset', 0, 1, {
      messages: [{ speaker: 'Dispatch', text: 'Asset assigned. The asset does not require breaks.', hint: 'Walk Unit 09 to the Stalker to take command of it. Drag a box to select several units.' }],
      objectives: [{ id: 'o8', text: 'Take command of the Stalker' }],
      transitions: [t(reach(AREA.asset), 'relay')],
    }),
    stage('relay', 'Uprising: secure the relay', 1, 1, {
      messages: [
        { speaker: 'Ringleader', text: 'City 17, they told you to keep your head down. Today we look up.' },
        { speaker: 'Dispatch', text: 'Attention: civil disobedience in sectors 4 through 9. Unit 09, you have temporary sector command. Do not get used to it.' },
        { speaker: 'Dispatch', text: 'Secure the relay. Requisition follows control.', hint: 'Stand next to a control point to capture it. It gives Requisition over time.' },
      ],
      objectives: [{ id: 'o9', text: 'Capture the outpost relay' }],
      actions: [
        act('asset', 'ChangeOwner', '2'),
        act('outpost_hq', 'ChangeOwner', '2'),
        act('shot_uprising', 'Enable', '', 0.5),
        act('uprising_siren', 'PlaySound', '', 1),
        ...screens.map((s) => act(`${s}_static`, 'Enable', '', 2)),
        act('uprising_fx', 'Start', '', 2.5),
        act('atmo_dusk', 'Trigger', '', 3),
      ],
      transitions: [t({ kind: 'capture', target: 'outpost_relay', owner: '2' }, 'power'), lost()],
    }),
    stage('power', 'Power first', 2, 1, {
      messages: [{ speaker: 'Dispatch', text: 'Everything runs on power. So will you.', hint: 'Select the Stalker, open the build menu and place a Power Generator.' }],
      objectives: [{ id: 'o10', text: 'Build a Power Generator' }],
      gates: [gate('unlock', 'build_comb_powergenerator')],
      transitions: [t({ kind: 'building', building: 'build_comb_powergenerator', owner: '2', count: 1, when: 'finished' }, 'scrap'), lost()],
    }),
    stage('scrap', 'Scrap (optional)', 3, 1, {
      messages: [{ speaker: 'Dispatch', text: 'Salvage detected in the yard. Collection is optional. Waste is not.', hint: 'Build a Scrap Power Generator on the scrap pile for extra power, or wait to skip this step.' }],
      objectives: [{ id: 'o11', text: 'Build a Scrap Power Generator on the scrap pile (optional)' }],
      gates: [gate('unlock', 'build_comb_powergenerator_scrap')],
      transitions: [
        t({ kind: 'building', building: 'build_comb_powergenerator_scrap', owner: '2', count: 1, when: 'finished' }, 'garrison'),
        t({ kind: 'survive', seconds: 90 }, 'garrison'),
        lost(),
      ],
    }),
    stage('garrison', 'A garrison', 4, 1, {
      messages: [{ speaker: 'Supervisor', text: 'One officer is not a defence. Build a Garrison and get me more.', hint: 'Some buildings need others first. Hover a greyed-out icon to see why.' }],
      objectives: [{ id: 'o12', text: 'Build a Garrison' }],
      gates: [gate('unlock', 'build_comb_garrison')],
      transitions: [t({ kind: 'building', building: 'build_comb_garrison', owner: '2', count: 1, when: 'finished' }, 'officers'), lost()],
    }),
    stage('officers', 'Train officers', 5, 1, {
      messages: [{ speaker: 'Supervisor', text: 'Three officers. Today.', hint: 'Select the Garrison and train Metro Police. Right-click the ground with the Garrison selected to set a rally point.' }],
      objectives: [{ id: 'o13', text: 'Train 3 Metro Police' }],
      transitions: [t({ kind: 'ability', ability: 'unit_metropolice', owner: '2', count: 3 }, 'armory'), lost()],
    }),
    stage('armory', 'Proper equipment', 0, 2, {
      messages: [{ speaker: 'Supervisor', text: "No proper equipment, no reinforcements. Command's rules, not mine.", hint: 'The Armory costs Power. Build another generator if you run short.' }],
      objectives: [{ id: 'o14', text: 'Build an Armory' }],
      gates: [gate('unlock', 'build_comb_armory'), gate('unlock', 'build_comb_energycell')],
      transitions: [t({ kind: 'building', building: 'build_comb_armory', owner: '2', count: 1, when: 'finished' }, 'barricades'), lost()],
    }),
    // Act 3: Lockdown.
    stage('barricades', 'Fortify the bridge', 1, 2, {
      messages: [{ speaker: 'Dispatch', text: 'Hostile movement in the old city. Fortify the canal bridge.', hint: "Barricades are in the Stalker's defence menu. Place three at the south end of the bridge." }],
      objectives: [{ id: 'o15', text: 'Place 3 barricades at the canal bridge' }],
      gates: [gate('unlock', 'build_comb_barricade')],
      transitions: [t({ kind: 'building', building: 'build_comb_barricade', owner: '2', count: 3, when: 'finished' }, 'wave1'), lost()],
    }),
    stage('wave1', 'The first wave', 2, 2, {
      messages: [{ speaker: 'Dispatch', text: 'Hostiles approaching the canal bridge. Hold.', hint: 'Select all your units with Ctrl+A and attack-move to the bridge.' }],
      objectives: [{ id: 'o16', text: 'Survive the first wave' }],
      actions: [act('wave1', 'Enable', '', 4)],
      transitions: [t({ kind: 'destroy', target: 'wave1' }, 'armup'), lost()],
    }),
    stage('armup', 'Arm the squad', 3, 2, {
      messages: [{ speaker: 'Supervisor', text: 'Crowbars today. Guns tomorrow. Arm your squad.', hint: 'Research Unlock AR2 at the Armory and train two Combine soldiers at the Garrison, in any order.' }],
      objectives: [{ id: 'o17a', text: 'Research Unlock AR2 at the Armory' }, { id: 'o17b', text: 'Train 2 Combine soldiers' }],
      gates: SOLDIERS.map((a) => gate('unlock', a)),
      transitions: [t({ kind: 'all', conditions: [
        { kind: 'ability', ability: 'weaponar2_comb_unlock', owner: '2', count: 1 },
        { kind: 'ability', ability: 'unit_combine', owner: '2', count: 2 },
      ] }, 'hold'), lost()],
    }),
    stage('hold', 'Lockdown', 4, 2, {
      messages: [{ speaker: 'Dispatch', text: 'Overwatch reinforcements inbound. Time to arrival: 4 minutes.', hint: 'Keep your units alive until the timer ends. Rebuild what they destroy.' }],
      objectives: [{ id: 'o18', text: 'Hold until reinforcements arrive' }],
      actions: [act('wave2', 'Enable', '', 5), act('wave3', 'Enable', '', 100)],
      transitions: [t({ kind: 'survive', seconds: 240 }, 'overwatch'), lost()],
    }),
    stage('overwatch', 'Overwatch arrives', 5, 2, {
      messages: [{ speaker: 'Supervisor', text: 'About time. Unit 09, try to stay out from under the feet.' }],
      objectives: [{ id: 'o19', text: 'Watch the counter-attack' }],
      actions: [
        act('atmo_citadel', 'Trigger'),
        act('wave2', 'Disable'), act('wave3', 'Disable'),
        act('striders', 'ChangeOwner', '2'),
        act('strider_route_go', 'Trigger', '', 0.5),
        act('dropship_route_flyby', 'StartForward', '', 0.5),
        act('shot_overwatch', 'Enable', '', 1),
        act('gunship_route_flyby', 'StartForward', '', 4),
      ],
      transitions: [t({ kind: 'survive', seconds: 30 }, 'end')],
    }),
    stage('end', 'Sector contained', 6, 2, {
      messages: [{ speaker: 'Dispatch', text: 'Sector contained. Unit 09, your shift ends in 4 hours. Resume patrol.' }],
      objectives: [{ id: 'o20', text: 'Resume patrol' }],
      transitions: [t({ kind: 'survive', seconds: 8 }, 'victory')],
    }),
  ];
  return { version: 1, start: 'shift', stages };
}
