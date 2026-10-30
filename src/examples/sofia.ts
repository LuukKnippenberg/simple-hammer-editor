/**
 * "Sofia: Battle for the Largo" – a singleplayer Lambda Wars mission built with the editor's own tools:
 * the map sketch (layout, height levels, surfaces, markers), the building generator, primitive shapes,
 * the Lambda Wars kits, decals and entity I/O.
 *
 * Story: rebels start in the south of Sofia's old town, fight north through zombie-infested alleys and
 * courtyards, climb to the tram line, and must take the Largo (the main square) from the Combine.
 *
 * Grid: 64×64 cells of 128 units; cell (x, y) has its south-west corner at (x·128 − 4096, y·128 − 4096).
 */
import { Box3, Raycaster, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { Feature, Surface, emptySketch, type Sketch, type SketchMarker } from '../gen/sketch.ts';
import { generateBuildings, type FacadeStyle } from '../gen/buildings.ts';
import { shapeSolids, type ShapeKind } from '../edit/shapes.ts';
import { boxSolid } from '../edit/brushes.ts';
import { editorBlock, entityNode } from '../edit/actions.ts';
import { KITS, applyStandardRelations, recordKit, type ParamValue } from '../lw/kits.ts';
import { getConnections, setConnections, type Connection } from '../vmf/io.ts';
import { placeDecalRay } from '../edit/decals.ts';
import { Rng } from '../gen/rng.ts';

const N = 64;
const C = 128;
/** World x/y of a cell edge, and of a cell centre. */
const edge = (c: number) => c * C - (N * C) / 2;
const mid = (c: number) => edge(c) + C / 2;
const STREET = 128; // height of the tram line and the Largo (level 1)
const TERRACE = 256; // cathedral terrace (level 2)

type Rect = [number, number, number, number];

// --- Sketch -------------------------------------------------------------------------------------------

/** Old town blocks (level 0) with optional courtyards and the gaps that open them to the alleys. */
const OLD_TOWN: { r: Rect; court?: Rect; gap?: Rect }[] = [
  { r: [1, 1, 8, 7], court: [3, 3, 6, 5], gap: [4, 6, 5, 7] },
  { r: [11, 0, 19, 5] },
  { r: [1, 10, 7, 20], court: [3, 13, 5, 17], gap: [6, 14, 7, 15] },
  { r: [10, 8, 17, 13] },
  { r: [20, 7, 25, 15], court: [22, 9, 23, 12], gap: [22, 13, 23, 15] },
  { r: [10, 16, 18, 20] },
  { r: [20, 18, 25, 20] },
  { r: [28, 6, 35, 13], court: [30, 8, 33, 11], gap: [31, 12, 32, 13] },
  { r: [29, 15, 34, 19] },
  { r: [38, 0, 47, 5] },
  { r: [50, 0, 62, 7], court: [54, 2, 58, 5], gap: [56, 6, 57, 7] },
  { r: [38, 8, 45, 14] },
  { r: [48, 10, 55, 16], court: [50, 12, 52, 14], gap: [51, 15, 52, 16] },
  { r: [58, 10, 62, 19] },
  { r: [38, 17, 46, 20] },
  { r: [49, 19, 56, 20] },
];
/** Stairs from the old town up to the tram line, and from the side street up to the cathedral terrace. */
const RAMPS: Rect[] = [[8, 21, 9, 23], [28, 21, 35, 23], [47, 21, 48, 23], [57, 21, 58, 23], [52, 51, 53, 55]];

const m = (kind: SketchMarker['kind'], x: number, y: number, params?: Record<string, ParamValue>): SketchMarker => ({ kind, x, y, params });

export function buildSofiaSketch(): Sketch {
  const s = emptySketch(N, N, 'city');
  s.seed = 1944;
  s.floors = [2, 4];
  const fill = (r: Rect, f: (i: number) => void) => {
    for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) f(y * N + x);
  };
  // Height: the old town sits one level below the tram line and the Largo; the cathedral on a terrace.
  fill([0, 24, 63, 63], (i) => (s.levels[i] = 1));
  fill([53, 34, 62, 62], (i) => (s.levels[i] = 2));
  for (const r of RAMPS) fill(r, (i) => (s.ramps[i] = 1));

  // Old town: dense blocks, cobbled alleys, dirt-and-rubble courtyards with debris.
  for (const b of OLD_TOWN) {
    fill(b.r, (i) => (s.features[i] = Feature.Building));
    for (const r of [b.court, b.gap]) if (r) fill(r, (i) => { s.features[i] = Feature.None; s.surface[i] = Surface.Dirt; });
    if (b.court) fill(b.court, (i) => { if ((i * 7) % 3 === 0) s.features[i] = Feature.Rubble; s.surface[i] = Surface.Rubble; });
  }
  // Cross alley under the tram line retaining wall: worn cobble with some rubble.
  fill([0, 21, 63, 23], (i) => { if (s.features[i] === Feature.None && (i * 13) % 11 === 0) s.features[i] = Feature.Rubble; });

  // Tram line: road the full width, parked cars along both kerbs.
  fill([0, 24, 63, 28], (i) => (s.surface[i] = Surface.Road));
  for (let x = 2; x < N; x += 5) {
    s.features[24 * N + x] = Feature.Cars;
    s.features[28 * N + ((x + 2) % N)] = Feature.Cars;
  }
  // North of the tram line: a row of town houses west and east of the Largo.
  fill([0, 29, 13, 32], (i) => (s.features[i] = Feature.Building));
  fill([52, 29, 63, 33], (i) => (s.features[i] = Feature.Building));
  // City park in the north-west, trees around the cathedral terrace.
  fill([0, 33, 5, 62], (i) => { s.surface[i] = Surface.Grass; if ((i % 2) === 0 && (Math.floor(i / N) % 2) === 0) s.features[i] = Feature.Trees; });
  for (let y = 35; y <= 61; y += 3) { s.features[y * N + 62] = Feature.Trees; }
  // The Largo: open paving; tree rows along both sides.
  for (let y = 33; y <= 53; y += 2) { s.features[y * N + 20] = Feature.Trees; s.features[y * N + 43] = Feature.Trees; }

  s.markers = [
    // The player: rebels with support, at the old town's south gate.
    m('sp_start', 31.5, 2, { faction: 'rebels', squad: 'rebel_ar2', count: 6, yaw: 90 }),
    m('rebels', 34, 3, { unit: 'rebel_sg', count: 4 }),
    m('rebels', 29, 3, { unit: 'rebel_medic', count: 2 }),
    m('rebels', 31.5, 4.5, { unit: 'rebel_rpg', count: 2 }),
    // Zombies: every courtyard and the alley junctions.
    m('zombies', 4.5, 4, { count: 6 }),
    m('zombies', 4, 15, { count: 5 }),
    m('zombies', 22.5, 10.5, { unit: 'fastzombie', count: 5 }),
    m('zombies', 31.5, 9.5, { count: 7 }),
    m('zombies', 9, 15, { unit: 'fastzombie', count: 4 }),
    m('zombies', 56, 3.5, { count: 6 }),
    m('zombies', 51, 13, { unit: 'poisonzombie', count: 3 }),
    m('zombies', 47, 9, { count: 5 }),
    m('zombies', 36.5, 11, { unit: 'fastzombie', count: 4 }),
    m('zombies', 13, 22, { count: 5 }),
    m('zombies', 41, 22, { count: 6 }),
    m('zombies', 31.5, 21, { unit: 'zombine', count: 3 }),
    // The Combine garrison on the Largo.
    m('combine', 26, 36, { unit: 'combine', count: 5 }),
    m('combine', 37, 36, { unit: 'combine_sg', count: 4 }),
    m('combine', 24, 46, { unit: 'metropolice', count: 5 }),
    m('combine', 39, 46, { unit: 'metropolice', count: 5 }),
    m('combine', 31.5, 48, { unit: 'combine_elite', count: 3 }),
    m('combine', 31.5, 53, { unit: 'combine', count: 5 }),
    m('combine_wave', 31.5, 54.5, { name: 'party_house_wave', unit: 'combine', count: 8, live: 4, freq: 3 }),
    m('combine_wave', 48.5, 53, { name: 'cathedral_wave', unit: 'combine_sg', count: 6, live: 3, freq: 4 }),
    m('capture_point', 31.5, 42, { name: 'largo_flag', owner: '3', radius: 256, time: 20 }),
  ];
  return s;
}

// --- Decoration -----------------------------------------------------------------------------------------

const MAT = {
  stone: 'STONE/STONEWALL050A',
  ochre: 'PLASTER/PLASTERWALL009A',
  white: 'PLASTER/PLASTERWALL034A',
  gold: 'PLASTER/PLASTERWALL009A',
  copper: 'METAL/METALROOF003A',
  dark: 'METAL/METALROOF006A',
  tiles: 'TILE/TILEFLOOR012A',
  rail: 'METAL/METALTRACK001A',
  glass: 'GLASS/GLASSWINDOW007A',
  nodraw: 'TOOLS/TOOLSNODRAW',
  trigger: 'TOOLS/TOOLSTRIGGER',
};

/** Props with their origin offsets (models whose origin is not at their base). */
const PROPS = {
  tram: { model: 'models/props_junk/train003.mdl', z: 96 },
  tram2: { model: 'models/props_junk/train002.mdl', z: 96 },
  lamp: { model: 'models/props_c17/lamppost03a_off.mdl', z: 0 },
  bench: { model: 'models/props_trainstation/benchoutdoor01a.mdl', z: 11 },
  dumpster: { model: 'models/props_junk/trashdumpster01a_static.mdl', z: 27 },
  cart: { model: 'models/props_junk/pushcart01a.mdl', z: 34 },
  bicycle: { model: 'models/props_junk/bicycle01a.mdl', z: 12 },
  crate: { model: 'models/props_junk/wood_crate001a_static.mdl', z: 20 },
  drum: { model: 'models/props_c17/oildrum001_static.mdl', z: 0 },
  trashbin: { model: 'models/props_junk/trashbin01a.mdl', z: 20 },
  barricade: { model: 'models/props_combine/combine_barricade_med01a.mdl', z: 30 },
  barricadeTall: { model: 'models/props_combine/combine_barricade_tall01a.mdl', z: 30 },
  fence: { model: 'models/props_combine/combine_fence01a.mdl', z: 40 },
  bunker: { model: 'models/props_combine/combine_bunker01.mdl', z: 17 },
  thumper: { model: 'models/props_combine/combinethumper002.mdl', z: 0 },
  tree: { model: 'models/props_foliage/mall_tree_medium01.mdl', z: 0 },
};

export interface SofiaReport {
  brushes: number;
  props: number;
  decals: number;
  connections: number;
}

/** Adds the landmarks, street furniture, Combine fortifications, decals and the mission logic. */
export async function decorateSofia(editor: Editor): Promise<SofiaReport> {
  const doc = editor.doc;
  const rng = new Rng(1944);
  let brushes = 0, props = 0, decals = 0;
  const solid = (nodes: ReturnType<typeof boxSolid>[]) => { for (const n of nodes) { doc.addSolid(n); brushes++; } };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, top = mat) =>
    solid([boxSolid(doc, new Vector3(x0, y0, z0), new Vector3(x1, y1, z1), { top, bottom: MAT.nodraw, sides: mat })]);
  const shape = (kind: ShapeKind, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: string, sides = 16, top = mat) =>
    solid(shapeSolids(doc, kind, new Vector3(x0, y0, z0), new Vector3(x1, y1, z1), { top, bottom: MAT.nodraw, sides: mat }, sides));
  /** Round shape centred on (x, y) with radius r. */
  const round = (kind: ShapeKind, x: number, y: number, r: number, z0: number, z1: number, mat: string, sides = 16, top = mat) =>
    shape(kind, x - r, y - r, z0, x + r, y + r, z1, mat, sides, top);
  const prop = (p: { model: string; z: number }, x: number, y: number, z: number, yaw = 0) => {
    doc.addEntity(entityNode(editor, 'prop_static', new Vector3(Math.round(x), Math.round(y), Math.round(z + p.z)), { model: p.model, angles: `0 ${Math.round(yaw)} 0`, solid: '6' }));
    props++;
  };
  const buildings = (r: Rect, z: number, style: FacadeStyle, floors: [number, number], seed: number) => {
    const fp = new Box3(new Vector3(edge(r[0]), edge(r[1]), z), new Vector3(edge(r[2] + 1), edge(r[3] + 1), z));
    const b = generateBuildings(doc, fp, { seed, minFloors: floors[0], maxFloors: floors[1], alleys: false, roofProps: true, style });
    solid(b.solids);
    for (const e of b.entities) doc.addEntity(entityNode(editor, e.classname, e.origin, e.keys));
  };

  recordKit(editor, 'Sofia landmarks', () => {
    // Stalinist blocks flanking the Largo (image 2), town houses at the corner.
    buildings([6, 33, 18, 58], STREET, 'pale', [5, 6], 11);
    buildings([45, 29, 51, 50], STREET, 'pale', [5, 6], 12);
    buildings([14, 29, 16, 32], STREET, 'stucco', [3, 4], 13);

    // The Largo paving with ochre inlays (image 2) and a glass dome over the Serdica ruins.
    box(edge(19), edge(29), STREET, edge(45), edge(55), STREET + 2, MAT.tiles);
    for (const [x0, y0] of [[22, 34], [36, 34], [22, 44], [36, 44]]) box(edge(x0), edge(y0), STREET + 2, edge(x0 + 6), edge(y0 + 4), STREET + 3, MAT.ochre);
    round('dome', mid(31) + 64, mid(39), 224, STREET + 2, STREET + 130, MAT.glass, 16);

    // Party House at the north end: colonnade, tower and spire.
    const ph = { x0: -896, x1: 896, y0: edge(57), y1: edge(62) };
    box(ph.x0, ph.y0, STREET, ph.x1, ph.y1, STREET + 640, MAT.white);
    box(-1088, ph.y0 + 128, STREET, ph.x0, ph.y1 - 64, STREET + 512, MAT.white);
    box(ph.x1, ph.y0 + 128, STREET, 1088, ph.y1 - 64, STREET + 512, MAT.white);
    box(-512, ph.y0 - 256, STREET, 512, ph.y0 - 192, STREET + 16, MAT.stone);
    box(-480, ph.y0 - 192, STREET, 480, ph.y0, STREET + 32, MAT.stone);
    for (let i = 0; i < 6; i++) round('cylinder', -385 + i * 154, ph.y0 - 96, 36, STREET + 32, STREET + 512, MAT.white, 10);
    box(-448, ph.y0 - 160, STREET + 512, 448, ph.y0, STREET + 576, MAT.white);
    box(-256, ph.y0 + 128, STREET + 640, 256, ph.y0 + 512, STREET + 896, MAT.white);
    box(-160, ph.y0 + 224, STREET + 896, 160, ph.y0 + 416, STREET + 1088, MAT.white);
    round('cone', 0, ph.y0 + 320, 80, STREET + 1088, STREET + 1440, MAT.dark, 8);

    // Alexander Nevsky Cathedral on the terrace (image 5): nave, transept, drum, gold domes, bell tower.
    const cx = 3328, cy = edge(48) + 64;
    box(2880, cy - 256, TERRACE, 3776, cy + 256, TERRACE + 512, MAT.stone, MAT.copper);
    box(3136, cy - 512, TERRACE, 3520, cy + 512, TERRACE + 448, MAT.stone, MAT.copper);
    round('cylinder', cx, cy, 224, TERRACE + 512, TERRACE + 832, MAT.stone, 16);
    round('dome', cx, cy, 240, TERRACE + 832, TERRACE + 1120, MAT.gold, 16);
    round('cylinder', cx, cy, 40, TERRACE + 1120, TERRACE + 1200, MAT.gold, 8);
    round('cone', cx, cy, 40, TERRACE + 1200, TERRACE + 1300, MAT.gold, 8);
    for (const [dx, dy] of [[0, -416], [0, 416], [-352, 0], [352, 0]]) {
      round('cylinder', cx + dx, cy + dy, 104, TERRACE + 448, TERRACE + 576, MAT.stone, 12);
      round('dome', cx + dx, cy + dy, 112, TERRACE + 576, TERRACE + 720, MAT.copper, 12);
    }
    box(2720, cy - 112, TERRACE, 2912, cy + 112, TERRACE + 960, MAT.stone, MAT.stone);
    round('cylinder', 2816, cy, 88, TERRACE + 960, TERRACE + 1056, MAT.stone, 12);
    round('dome', 2816, cy, 96, TERRACE + 1056, TERRACE + 1184, MAT.gold, 12);

    // The ochre corner tower with its dark dome (image 1), where the tram line meets the Largo.
    const tx = edge(18), ty = mid(30) + 64;
    round('cylinder', tx, ty, 176, STREET - 32, STREET + 768, MAT.ochre, 16);
    round('cylinder', tx, ty, 200, STREET + 768, STREET + 800, MAT.white, 16);
    round('cylinder', tx, ty, 136, STREET + 800, STREET + 928, MAT.white, 16);
    round('dome', tx, ty, 150, STREET + 928, STREET + 1168, MAT.dark, 16);
    round('cylinder', tx, ty, 24, STREET + 1168, STREET + 1232, MAT.dark, 8);

    // Planters with trees on the Largo.
    for (const [x, y] of [[-1024, 640], [1024, 640], [-1024, 1664], [1024, 1664], [-640, 2560], [640, 2560]]) {
      round('cylinder', x, y, 72, STREET + 2, STREET + 50, MAT.stone, 12, MAT.stone);
      prop(PROPS.tree, x, y, STREET + 50, rng.int(0, 359));
    }
    // Tram rails: two tracks down the middle of the tram line.
    for (const yc of [mid(25) + 32, mid(27) - 32]) {
      for (const off of [-28, 28]) box(edge(0) + 8, yc + off - 3, STREET, edge(N) - 8, yc + off + 3, STREET + 4, MAT.rail);
    }
  });

  recordKit(editor, 'Sofia props', () => {
    const streetY = [mid(25) + 32, mid(27) - 32];
    prop(PROPS.tram, -2600, streetY[0], STREET + 4, 90);
    prop(PROPS.tram2, 1700, streetY[1], STREET + 4, 97);
    for (let x = -3584; x <= 3584; x += 896) {
      prop(PROPS.lamp, x, edge(24) + 40, STREET, 90);
      if (Math.abs(x) > 1700) prop(PROPS.lamp, x + 448, edge(29) - 40, STREET, 270);
    }
    // Largo benches facing the paths.
    for (const y of [384, 1152, 1920]) {
      for (const x of [-1408, 1408]) prop(PROPS.bench, x, y, STREET + 2, x < 0 ? 0 : 180);
    }
    // Old town clutter: dumpsters, carts (image 3), bicycles, crates and drums in alleys and courtyards.
    const ground = 0;
    const spots: [keyof typeof PROPS, number, number][] = [
      ['dumpster', 9.5, 4], ['dumpster', 26.5, 9], ['dumpster', 36.5, 14], ['dumpster', 47, 17], ['dumpster', 19.5, 15],
      ['cart', 4, 3.5], ['cart', 32, 10], ['cart', 55, 4.5], ['bicycle', 27, 2], ['bicycle', 9.5, 9],
      ['crate', 22.5, 11.5], ['crate', 23, 9.5], ['crate', 51.5, 12.5], ['drum', 3.5, 16], ['drum', 5, 14],
      ['drum', 30.5, 11], ['trashbin', 26.5, 4.5], ['trashbin', 37, 4.5], ['trashbin', 57.5, 22],
    ];
    for (const [k, x, y] of spots) prop(PROPS[k], mid(0) + x * C - C / 2, mid(0) + y * C - C / 2, ground, rng.int(0, 359));
    // Combine fortifications around the garrison.
    for (const [x, y] of [[26, 34], [37, 34], [24, 44.5], [39, 44.5], [31.5, 46.5]]) {
      for (const dx of [-1, 0, 1]) prop(PROPS.barricade, edge(0) + x * C + dx * 96, edge(0) + y * C, STREET + 2, 0);
    }
    prop(PROPS.barricadeTall, -256, edge(30), STREET + 2, 0);
    prop(PROPS.barricadeTall, 256, edge(30), STREET + 2, 0);
    prop(PROPS.bunker, -704, edge(54), STREET + 2, 270);
    prop(PROPS.bunker, 704, edge(54), STREET + 2, 270);
    prop(PROPS.thumper, 0, edge(53) + 64, STREET + 2, 0);
    for (let x = edge(44) + 32; x < edge(52); x += 64) prop(PROPS.fence, x, edge(51), STREET, 0);
  });

  // Decals: posters and graffiti on alley walls, blood and trash in courtyards, propaganda on the Largo.
  const ray = (from: Vector3, dir: Vector3) => new Raycaster(from, dir.normalize(), 0, 400);
  const decal = async (material: string, from: Vector3, dir: Vector3, overlay = 0, rotation = 0) => {
    const e = await placeDecalRay(editor, ray(from, dir), { material, mode: overlay ? 'overlay' : 'decal', size: overlay, rotation });
    if (e) decals++;
  };
  const posters = ['decals/decal_posters001a', 'decals/decal_posters002a', 'decals/decal_posters003a', 'decals/decal_posters005a', 'decals/decal_signroute004b'];
  const alleys: [number, number, number][] = [[9.5, 3, 1], [9.5, 12, -1], [8.5, 17, 1], [26.5, 8, 1], [37, 7, -1], [36.5, 16, -1], [46.5, 12, 1], [56.5, 13, 1], [27, 17, -1]];
  for (const [x, y, side] of alleys) {
    await decal(rng.pick(posters), new Vector3(edge(0) + x * C, edge(0) + y * C, 96), new Vector3(side, 0, 0));
  }
  for (const [x, y, side] of [[9.5, 6, -1], [26.5, 12, -1], [37, 11, 1], [46.5, 15, -1]] as const) {
    await decal(rng.chance(0.5) ? 'decals/decalgraffiti001a' : 'decals/decalgraffiti001b', new Vector3(edge(0) + x * C, edge(0) + y * C, 80), new Vector3(side, 0, 0), 176, rng.int(-8, 8));
  }
  for (const [x, y] of [[4.5, 4], [31.5, 9.5], [56, 3.5], [22.5, 10.5], [4, 15], [51, 13], [31.5, 21]]) {
    await decal(rng.pick(['decals/bloodstain_001', 'decals/bloodstain_002', 'decals/bloodstain_003']), new Vector3(edge(0) + x * C + 40, edge(0) + y * C, 64), new Vector3(0, 0, -1));
    await decal(rng.pick(['decals/trashdecal01a', 'decals/trashdecal02a', 'decals/trashdecal03a']), new Vector3(edge(0) + x * C - 60, edge(0) + y * C + 50, 64), new Vector3(0, 0, -1));
  }
  for (const x of [-3000, -1200, 600, 2600]) await decal('decals/decal_crater001a', new Vector3(x, mid(26), STREET + 64), new Vector3(0, 0, -1));
  for (const y of [400, 1200, 2000]) {
    await decal(rng.pick(['decals/combinepropaganda01a', 'decals/combinepropaganda01b', 'decals/combinepropaganda01c']), new Vector3(-1400, y, STREET + 160), new Vector3(-1, 0, 0));
    await decal(rng.pick(['decals/combinepropaganda01a', 'decals/combinepropaganda01d']), new Vector3(1400, y, STREET + 160), new Vector3(1, 0, 0));
  }

  // --- Mission logic ------------------------------------------------------------------------------------
  const byName = (n: string) => doc.entities.find((e) => e.get('targetname') === n);
  const connect = (e: MapEntity | undefined, c: Partial<Connection> & { output: string; target: string; input: string }) => {
    if (e) setConnections(e, [...getConnections(e), { param: '', delay: 0, times: -1, ...c }]);
  };
  const kit = (id: string, at: Vector3, params: Record<string, ParamValue>) => {
    const k = KITS.find((x) => x.id === id)!;
    const defaults = Object.fromEntries(k.params.map((p) => [p.key, p.default]));
    return k.place(editor, at, { ...defaults, ...params });
  };
  const trigger = (name: string, min: Vector3, max: Vector3) => {
    const node = entityNode(editor, 'trigger_once', null, { targetname: name, spawnflags: '2', StartDisabled: '0', filtername: 'player_filter' });
    const e = doc.addEntity(node);
    node.items.push(boxSolid(doc, min, max, MAT.trigger), editorBlock());
    e.reload();
    return e;
  };

  recordKit(editor, 'Sofia mission', () => {
    doc.world.set('message', 'Sofia: Battle for the Largo');
    doc.world.set('she_description', 'Lead the rebels north through the zombie-infested alleys of Sofia\'s old town, then take the Largo from the Combine.');
    const logicAt = new Vector3(mid(31), mid(1), 64);
    doc.addEntity(entityNode(editor, 'filter_owner', logicAt.clone().add(new Vector3(-96, 0, 0)), { targetname: 'player_filter', ownernumber: '2', Negated: '0' }));

    const [intro] = kit('message', logicAt, { text: 'Sofia, old town. The Combine garrison holds the Largo, but the alleys between us are crawling with the dead. Push north through the courtyards to the tram line.', when: 'start', delay: 2 });
    intro.set('targetname', 'msg_intro');
    const start = byName('map_start')!;
    setConnections(start, getConnections(start).map((c) => (c.input === 'Display' ? { ...c, target: 'msg_intro' } : c)));
    const [oldtown] = kit('objective', logicAt.clone().add(new Vector3(32, 0, 0)), { text: 'Fight through the old town to the tram line', visible: true, wins: false, priority: 10 });
    oldtown.set('targetname', 'obj_oldtown');
    const [largo] = kit('objective', logicAt.clone().add(new Vector3(64, 0, 0)), { text: 'Take the Largo: capture the flag at the Party House', visible: false, wins: true, priority: 20 });
    largo.set('targetname', 'obj_largo');
    const [tramMsg] = kit('message', logicAt.clone().add(new Vector3(0, 32, 0)), { text: 'The tram line. The Largo is just north and the Combine are dug in around the Party House. Reinforcements are coming up the line from the east.', when: 'none' });
    tramMsg.set('targetname', 'msg_tram');
    const [largoMsg] = kit('message', logicAt.clone().add(new Vector3(32, 32, 0)), { text: 'They have seen us! Combine reinforcements are pouring out of the Party House and the cathedral.', when: 'none' });
    largoMsg.set('targetname', 'msg_largo');

    // Rebel reinforcements arrive along the tram line when the player reaches it.
    kit('wave', new Vector3(edge(62), mid(26), STREET + 8), { name: 'rebel_reinforce', unit: 'rebel_ar2', count: 4, live: 4, freq: 1, owner: '2', goal: -1600, disabled: true });

    const tram = trigger('trigger_tramline', new Vector3(edge(0) + 32, edge(24), STREET - 16), new Vector3(edge(N) - 32, edge(28), STREET + 384));
    connect(tram, { output: 'OnStartTouch', target: 'obj_oldtown', input: 'SetCompleted' });
    connect(tram, { output: 'OnStartTouch', target: 'msg_tram', input: 'Display', delay: 1 });
    connect(tram, { output: 'OnStartTouch', target: 'obj_largo', input: 'SetVisible', param: '1', delay: 2 });
    connect(tram, { output: 'OnStartTouch', target: 'rebel_reinforce', input: 'Enable', delay: 6 });
    const enter = trigger('trigger_largo', new Vector3(edge(19), edge(30), STREET - 16), new Vector3(edge(45), edge(33), STREET + 384));
    connect(enter, { output: 'OnStartTouch', target: 'msg_largo', input: 'Display' });
    connect(enter, { output: 'OnStartTouch', target: 'party_house_wave', input: 'Enable', delay: 4 });
    connect(enter, { output: 'OnStartTouch', target: 'cathedral_wave', input: 'Enable', delay: 25 });
    connect(byName('largo_flag'), { output: 'OnCaptured_Player0', target: 'obj_largo', input: 'SetCompleted' });
    // Both Combine waves converge on the flag.
    const flag = byName('largo_flag')?.origin;
    for (const w of ['party_house_wave', 'cathedral_wave']) {
      const goal = byName(`${w}_goal`);
      if (goal && flag) goal.origin = flag.clone().add(new Vector3(0, 0, 16));
    }
    applyStandardRelations(editor);

    // Late afternoon light over Sofia.
    const sun = doc.entities.find((e) => e.classname === 'light_environment');
    if (sun) {
      sun.set('pitch', '-38');
      sun.set('angles', '0 225 0');
      sun.set('_light', '255 226 188 620');
      sun.set('_ambient', '168 180 205 190');
    }
    doc.entities.find((e) => e.classname === 'env_fog_controller')?.set('fogcolor', '196 186 168');
  });
  editor.changed();
  const connections = doc.entities.reduce((n, e) => n + getConnections(e).length, 0);
  return { brushes, props, decals, connections };
}
