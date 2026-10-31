/**
 * "Garden District" – a Combine mission with base building, built with the editor's tools: the map sketch with the
 * Sofia layout (street grid, green courtyards, cobbled streets with parked cars and bollards, building detail by
 * block), POIs (park, parking, market), two interior buildings with rooms (a customs house and the central
 * station), a domed church in a walled garden, the Lambda Wars kits, cinematics, decal scatter and the mission
 * flowchart.
 *
 * Story (see the design doc): an Overseer lands on the palace square with a Citadel, builds a forward base, holds it
 * against rebel raids, clears the customs house, the market and the station, and destroys the rebel command in the
 * garden of the church of Saint George.
 *
 * Grid: 64×52 cells of 128 units; cell (x, y) has its south-west corner at (x·128 − 4096, y·128 − 3328). The square
 * is in the west, the street grid east of the boulevard, the garden in the middle of the east, the station in the
 * north-east corner.
 */
import { Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { Feature, Surface, emptySketch, type Sketch, type SketchMarker, type SketchPoi } from '../gen/sketch.ts';
import { boxSolid } from '../edit/brushes.ts';
import { shapeSolids } from '../edit/shapes.ts';
import { entityNode, editorBlock } from '../edit/actions.ts';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { KITS, applyStandardRelations, recordKit, type ParamValue } from '../lw/kits.ts';
import type { MissionGraph, Stage, Transition } from '../lw/mission.ts';
import { getConnections } from '../vmf/io.ts';
import { placeDecals, type DecalPlacement } from '../edit/decalScatter.ts';
import { MODEL_BOUNDS } from '../gen/poi/models.ts';
import { ATMOSPHERE_PRESETS, pathEntities, shotEntities, type EntitySpec } from '../lw/cinematics.ts';
import { buildAtmosphere, buildFlyby, buildSendAlong, groundBelow } from '../lw/cinematicsAction.ts';
import { Rng } from '../gen/rng.ts';
import { roomLayout, type RoomBuildingSpec, type RoomSpec, type StreetDoor } from '../gen/rooms/model.ts';
import { ellipsePoints } from '../gen/sketchShapes.ts';
import { applyRooms } from '../gen/rooms/action.ts';

const W = 64;
const H = 52;
const C = 128;
/** World x / y of a (fractional) cell coordinate. */
export const X = (c: number) => c * C - (W * C) / 2;
export const Y = (c: number) => c * C - (H * C) / 2;

type Rect = [number, number, number, number];

// --- Layout (cells, inclusive) -----------------------------------------------------------------------------

/**
 * The street grid east of the boulevard: blocks 10 cells wide between 4-cell streets (wide enough for Sofia
 * streets: parked cars along both kerbs and bollards on the pavements).
 */
const BLOCKS: Rect[] = [
  [0, 11, 3, 36], // the palace front on the west side of the square
  [0, 41, 17, 51], // the grand hotel north of the square
  [22, 0, 31, 8], [36, 0, 45, 8], [50, 0, 59, 8], // the south row
  [22, 20, 31, 23], // the newer block over the car park
  [42, 13, 45, 23], // the market's back row
  [36, 28, 45, 36], [50, 28, 59, 36], // north of the market and the garden
  [22, 41, 31, 51], [36, 41, 45, 51], // the north row
];
const SQUARE: Rect = [4, 11, 17, 36];
const GARDEN: Rect = [50, 13, 59, 23];
const CUSTOMS_CELLS: Rect = [22, 28, 31, 36];
const STATION_CELLS: Rect = [50, 41, 62, 50];
const ROADS: Rect[] = [
  [18, 0, 21, 51], // the boulevard between the square and the grid
  [0, 37, 17, 40], // the street between the square and the hotel
  [32, 0, 35, 51], [46, 0, 49, 51], [60, 0, 63, 40], // north–south streets
  [22, 9, 63, 12], [22, 24, 63, 27], [22, 37, 63, 40], // east–west streets
];
/**
 * Building detail: high where the mission's fights are and the camera looks (around the square, the market, the
 * garden), medium along the way there, filler everywhere else (scripts/tjunc-budget.mjs).
 */
const DETAIL_HIGH: Rect[] = [
  [0, 11, 3, 36], [0, 41, 17, 43], // the palace front and the hotel's south side
  [22, 20, 31, 23], [42, 13, 45, 23], // the car park block and the market
  [50, 28, 59, 30], [50, 6, 59, 8], [36, 28, 45, 30], // around the garden
];
const DETAIL_MEDIUM: Rect[] = [
  [22, 0, 31, 8], [22, 41, 31, 44], [36, 0, 45, 8],
];

const POIS: SketchPoi[] = [
  // The park south of the square (the scrap piles lie in it).
  { type: 'park', x: 0, y: 0, w: 18, h: 11, seed: 21, params: { lights: false } },
  // Parked cars in rows on the north half of the square, and the car park under the newer block.
  { type: 'parking', x: 5, y: 30, w: 12, h: 6, seed: 22 },
  { type: 'parking', x: 22, y: 13, w: 10, h: 7, seed: 23 },
  // The street market in front of the market's back row (turned so its long side runs along the street).
  { type: 'market', x: 36, y: 13, w: 6, h: 11, rotation: 90, seed: 24 },
];

const m = (kind: SketchMarker['kind'], x: number, y: number, params?: Record<string, ParamValue>): SketchMarker => ({ kind, x, y, params });

/** Where things stand (cells). */
const SPOTS = {
  hq: [10.5, 22.5],
  start: [12.5, 17],
  raid1: [26, 38.5],
  raid2: [40, 25.5],
  raid3: [56.5, 25.5],
  counter: [[61.5, 18], [47.5, 31]] as [number, number][],
  strider: [19.5, 1.5],
  scouts: [13, 6],
};

export function buildGardenSketch(): Sketch {
  const s = emptySketch(W, H, 'city');
  s.seed = 2203;
  s.floors = [4, 5];
  s.architecture = 'tenement';
  s.interiors = 'some';
  // The Sofia layout: big blocks around green courtyards, some opening onto the street, Sofia streets.
  s.blockSize = 10;
  s.yards = 'green';
  s.openYards = 0.3;
  s.streets = 'sofia';
  s.quality = new Array(W * H).fill(3);
  for (const [level, rects] of [[2, DETAIL_MEDIUM], [1, DETAIL_HIGH]] as const) {
    for (const [x0, y0, x1, y1] of rects) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s.quality[y * W + x] = level;
  }
  const fill = (r: Rect, f: (i: number, x: number, y: number) => void) => {
    for (let y = r[1]; y <= r[3]; y++) for (let x = r[0]; x <= r[2]; x++) f(y * W + x, x, y);
  };
  for (const b of BLOCKS) fill(b, (i) => (s.features[i] = Feature.Building));
  for (const r of ROADS) fill(r, (i) => { s.surface[i] = Surface.Road; s.features[i] = Feature.None; });
  // Paved: the square, and the ground under the two interior buildings.
  for (const r of [SQUARE, CUSTOMS_CELLS, STATION_CELLS]) fill(r, (i) => { s.surface[i] = Surface.Paved; s.features[i] = Feature.None; });
  // The church garden: a lawn with paved paths from the two gates to the church (the rest is added after generating).
  fill(GARDEN, (i, x, y) => {
    const path = (y >= 16 && y <= 17 && x <= 53) || (x >= 54 && x <= 55 && y >= 19);
    s.surface[i] = path ? Surface.Paved : Surface.Grass;
    s.features[i] = Feature.None;
  });
  s.pois = POIS.map((p) => ({ ...p }));
  // Tsar Samuil street's look: asphalt between square slab pavements with stone kerbs, setts gutters, round corners.
  s.streetMaterials = { carriageway: 'asphalt_worn', pavement: 'slabs', kerb: 'stone', gutter: 'setts', corner: 96 };
  // The city goes on round the district; the Combine wall closes it to the north, past the station.
  s.surroundings = { style: 'city', sides: { n: 'wall' } };
  // Not all squares: a diagonal street from the north crossing to the garden's north-west corner, a street curving
  // through the north row, and a round lawn by the palace front.
  s.shapes = [
    { kind: 'street', points: [[33.5, 38.5], [48, 26]], width: 256, pavement: 64 },
    { kind: 'street', points: [[19.5, 44], [24, 46.5], [29, 46.5], [33.5, 44.5]], width: 224, pavement: 64, radius: 384 },
    { kind: 'area', points: ellipsePoints(4.5, 12, 8.5, 16), surface: 'grass' },
  ];
  s.markers = [
    m('sp_start', SPOTS.start[0], SPOTS.start[1], { faction: 'combine', squad: 'unit_stalker:1, unit_combine:4, unit_metropolice:4', yaw: 45 }),
    // Scrap: two piles in the park, one in the car park.
    m('scrap', 4, 3.5), m('scrap', 14.5, 3.5), m('scrap', 30.2, 14.6),
  ];
  return s;
}

// --- Interior buildings ------------------------------------------------------------------------------------------

const room = (id: string, type: string, x0: number, y0: number, x1: number, y1: number, name?: string): RoomSpec => ({ id, type, cells: { x0, y0, x1, y1 }, name });
const door = (x: number, y: number, side: StreetDoor['side'], width = 2): StreetDoor => ({ x, y, side, width });

/** The customs house: a hallway in from the boulevard, the customs hall with its cages, a waiting room. */
export function customsSpec(z: number): RoomBuildingSpec {
  return {
    uid: 'customs', seed: 2203, origin: { x: X(CUSTOMS_CELLS[0]), y: Y(CUSTOMS_CELLS[1]), z }, cell: C, height: 352,
    rooms: [room('hallway', 'hallway', 0, 0, 2, 9, 'Hallway'), room('customs', 'customs', 2, 0, 10, 5, 'Customs hall'), room('waiting', 'waiting', 2, 5, 10, 9, 'Waiting room')],
    doors: [door(0, 3, 'w'), door(5, 0, 's')],
    links: [], bands: ['n', 'e'],
  };
}

/**
 * The central station: the train hall along the north (kept 128 off the map's edges: walls on the edge of the
 * ground brushes cost vbsp t-junctions), the concourse and a waiting room on the street.
 */
export function stationSpec(z: number): RoomBuildingSpec {
  return {
    uid: 'station', seed: 2207, origin: { x: X(STATION_CELLS[0]), y: Y(STATION_CELLS[1]), z }, cell: C, height: 432,
    rooms: [room('hall', 'trainHall', 0, 4, 13, 10, 'Train hall'), room('concourse', 'concourse', 0, 0, 8, 4, 'Concourse'), room('waiting', 'waiting', 8, 0, 13, 4, 'Waiting room')],
    doors: [door(3, 0, 's'), door(10, 0, 's', 1)],
    links: [], bands: ['n', 'e'],
  };
}

// --- Map pieces ---------------------------------------------------------------------------------------------------

export interface GardenReport {
  brushes: number;
  props: number;
  decals: number;
  entities: number;
  connections: number;
  notes: string[];
}

const STUCCO = 'BUILDING_TEMPLATE/BUILDING_TEMPLATE002H';
const ROOF = 'METAL/METALROOF003A';
const NODRAW = 'TOOLS/TOOLSNODRAW';
const RAIL = 'METAL/METALRAIL001A';

/** Adds the set pieces, units, cinematics and logic to the generated map, and the mission flowchart. */
export async function decorateGardenDistrict(editor: Editor): Promise<GardenReport> {
  const doc = editor.doc;
  const rng = new Rng(2203);
  const notes: string[] = [];
  let brushes = 0, props = 0, decals = 0;
  const ground = (x: number, y: number) => groundBelow(editor, new Vector3(x, y, 1400)) ?? 0;
  const at = (cx: number, cy: number, dz = 0) => { const x = X(cx), y = Y(cy); return new Vector3(Math.round(x), Math.round(y), Math.round(ground(x, y) + dz)); };
  const addEnt = (cls: string, origin: Vector3, keys: Record<string, string>) => doc.addEntity(entityNode(editor, cls, origin.clone().round(), keys));
  const addSpecs = (specs: EntitySpec[]) => specs.map((s) => addEnt(s.classname, s.origin, s.keys));
  /** A prop standing on the ground (or `z` above it): prop_static where the model allows it. */
  const prop = (model: string, x: number, y: number, yaw = 0, z = 0, keys: Record<string, string> = {}) => {
    const b = MODEL_BOUNDS[model];
    const cls = b && b[6] === 0 ? 'prop_dynamic' : 'prop_static';
    addEnt(cls, new Vector3(x, y, ground(x, y) + z - (b ? b[2] : 0)), { model: `models/${model}.mdl`, angles: `0 ${Math.round(yaw)} 0`, solid: '6', ...keys });
    props++;
  };
  const detailEntity = (solids: KVNode[], keys: Record<string, string> = {}) => {
    const e = new KVNode('entity');
    e.items.push(new KVPair('id', String(doc.nextId())), new KVPair('classname', 'func_detail'));
    for (const [k, v] of Object.entries(keys)) e.items.push(new KVPair(k, v));
    e.items.push(...solids, editorBlock());
    brushes += solids.length;
    return doc.addEntity(e);
  };
  const kit = (id: string, pos: Vector3, params: Record<string, ParamValue>) => {
    const k = KITS.find((x) => x.id === id)!;
    const defaults = Object.fromEntries(k.params.map((p) => [p.key, p.default]));
    return k.place(editor, pos, { ...defaults, ...params });
  };
  const byName = (n: string) => doc.entities.find((e) => e.get('targetname') === n);
  const g0 = ground(X(55), Y(18));

  // --- Interior buildings ---------------------------------------------------------------------------------------
  const customs = customsSpec(Math.round(ground(X(26), Y(32))));
  const station = stationSpec(Math.round(ground(X(56), Y(46))));
  for (const spec of [customs, station]) {
    const r = applyRooms(editor, spec, `Build ${spec.uid}`);
    if (r.result.layout.issues.length) notes.push(...r.result.layout.issues.map((i) => `${spec.uid}: ${i}`));
    brushes += r.result.counts.walls + r.result.counts.detail + r.result.counts.relief;
    props += r.result.counts.props;
  }
  const roomRect = (spec: RoomBuildingSpec, id: string) => roomLayout(spec).rooms.find((q) => q.spec.id === id)!.inner;
  const centre = (r: { x0: number; y0: number; x1: number; y1: number }) => new Vector3(Math.round((r.x0 + r.x1) / 2), Math.round((r.y0 + r.y1) / 2), 0);

  // --- The church of Saint George and its garden ---------------------------------------------------------------------
  recordKit(editor, 'Garden District set pieces', () => {
    const solids: KVNode[] = [];
    const box = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, top = ROOF, sides = STUCCO) =>
      solids.push(boxSolid(doc, new Vector3(Math.round(X(x0)), Math.round(Y(y0)), g0 + z0), new Vector3(Math.round(X(x1)), Math.round(Y(y1)), g0 + z1), { top, bottom: NODRAW, sides }));
    // A cross-shaped church facing west onto the west gate: the nave, the transept, a raised crossing under the
    // big dome, two towers with small domes either side of the front, an apse at the east end.
    box(51.8, 15.2, 57.2, 18.8, -8, 320);
    box(53.8, 14.2, 55.2, 19.8, -8, 288);
    box(53.6, 15.6, 55.4, 18.4, 320, 368);
    box(51.1, 14.6, 52.5, 16, -8, 416);
    box(51.1, 18, 52.5, 19.4, -8, 416);
    solids.push(...shapeSolids(doc, 'cylinder', new Vector3(X(57.2) - 8, Y(15.8), g0 - 8), new Vector3(X(58.4), Y(18.2), g0 + 256), { top: ROOF, bottom: NODRAW, sides: STUCCO }, 12));
    // Plinth and cornice bands in a darker stone around the nave.
    box(51.7, 15.1, 57.3, 18.9, -8, 40, 'STONE/STONEWALL029B', 'STONE/STONEWALL029B');
    box(51.75, 15.15, 57.25, 18.85, 296, 320, ROOF, 'BUILDING_TEMPLATE/BUILDING_TEMPLATE003A');
    detailEntity(solids, { targetname: 'church' });
    prop('lostcoast/props_monastery/dome_large', X(54.5), Y(17), 0, 368 - (ground(X(54.5), Y(17)) - g0));
    for (const cy of [15.3, 18.7]) prop('props_rooftop/dome004', X(51.8), Y(cy), 0, 416 - (ground(X(51.8), Y(cy)) - g0));
    // The door and the windows along the nave (the camera sees the south and west sides best).
    prop('lostcoast/props_monastery/door01_left', X(51.8) - 2, Y(17) - 48, 180, 54);
    for (const cx of [52.9, 56.2]) for (const cy of [15.2, 18.8]) prop('lostcoast/props_monastery/monastery_window001a', X(cx), Y(cy) + (cy < 17 ? -2 : 2), cy < 17 ? 90 : 270, 220);
    // A low railing round the garden, open at the two gates (the rebels close them with barricades).
    const rail: KVNode[] = [];
    const railX = (x: number, y0: number, y1: number) => rail.push(boxSolid(doc, new Vector3(Math.round(X(x)) - 3, Math.round(Y(y0)), g0 - 8), new Vector3(Math.round(X(x)) + 3, Math.round(Y(y1)), g0 + 40), RAIL));
    const railY = (y: number, x0: number, x1: number) => rail.push(boxSolid(doc, new Vector3(Math.round(X(x0)), Math.round(Y(y)) - 3, g0 - 8), new Vector3(Math.round(X(x1)), Math.round(Y(y)) + 3, g0 + 40), RAIL));
    railX(50.2, 13.2, 16.5); railX(50.2, 17.5, 23.8);
    railX(59.8, 13.2, 23.8);
    railY(13.2, 50.2, 59.8);
    railY(23.8, 50.2, 54.5); railY(23.8, 55.5, 59.8);
    detailEntity(rail, { targetname: 'garden_railing' });
    // Benches along the paths, big bare trees on the lawn, lamp posts by the gates.
    for (const cx of [50.8, 52.6]) for (const cy of [16.1, 17.9]) prop('props_trainstation/benchoutdoor01a', X(cx), Y(cy), cy < 17 ? 90 : 270);
    for (const [cx, cy] of [[51, 13.9], [53.5, 13.8], [56.5, 13.9], [50.9, 20.2], [59, 16.5], [56, 20.2]]) prop(rng.pick(['props_foliage/tree_dead03', 'props_foliage/tree_dead04', 'props_foliage/tree_deciduous_03a']), X(cx), Y(cy), rng.int(0, 359));
    for (const [cx, cy, yaw] of [[49.9, 15.8, 180], [53.9, 24.1, 90]]) prop('props_c17/lamppost03a_off', X(cx), Y(cy), yaw);

    // The palace square: lamp posts round the base site, a Combine banner screen by the palace.
    for (const cy of [13, 19, 25]) for (const cx of [4.6, 16.4]) prop('props_c17/lamppost03a_off', X(cx), Y(cy), cx < 10 ? 0 : 180);
    // Burnt-out cars and debris in the streets where the raids come from.
    for (const [model, cx, cy, yaw] of [['props_vehicles/car002b', 29, 38.6, 15], ['props_vehicles/car004b', 41, 26.2, 170], ['props_vehicles/car003b', 57.5, 26.4, 80]] as const) prop(model, X(cx), Y(cy), yaw);
  });

  // --- Units ------------------------------------------------------------------------------------------------------
  recordKit(editor, 'Garden District units', () => {
    // The Overseer's Citadel on the square, and the forward command's budget (a mission starts the player with next
    // to nothing; the first stage gives it).
    addEnt('build_comb_hq', at(SPOTS.hq[0], SPOTS.hq[1]), { targetname: 'combine_hq', ownernumber: '2', constructed: '2', angles: '0 0 0' });
    addEnt('give_resources', at(SPOTS.hq[0], SPOTS.hq[1] - 3, 64), { targetname: 'start_funds', ownernumber: '2', resourcetype: 'requisition', takeresources: '0' });
    // Rebel scouts in the park.
    kit('unit_group', at(SPOTS.scouts[0], SPOTS.scouts[1]), { unit: 'unit_rebel_scout', count: 3, owner: '1', name: 'park_scouts' });
    // The customs house: rebels in the customs hall and the hallway, its capture point in the hall.
    const hall = centre(roomRect(customs, 'customs'));
    kit('capture_point', hall.clone().setZ(customs.origin.z + 2), { name: 'cp_customs', radius: 224, owner: '1', time: 15 });
    kit('unit_group', hall.clone().add(new Vector3(-200, 60, customs.origin.z + 8)), { unit: 'unit_rebel_sg', count: 3, owner: '1', name: 'customs_rebels' });
    kit('unit_group', centre(roomRect(customs, 'hallway')).add(new Vector3(0, 0, customs.origin.z + 8)), { unit: 'unit_rebel', count: 3, owner: '1', name: 'customs_rebels' });
    // The street market.
    kit('capture_point', at(39, 18.5), { name: 'cp_market', radius: 224, owner: '1', time: 15 });
    kit('unit_group', at(38.4, 21), { unit: 'unit_rebel', count: 4, owner: '1', name: 'market_rebels' });
    kit('unit_group', at(38.4, 15.6), { unit: 'unit_rebel_partisan', count: 2, owner: '1', name: 'market_rebels' });
    // The station: RPGs on the platform, a heavy and riflemen in the concourse, a medic in the waiting room; its
    // capture point on the platform.
    const train = roomRect(station, 'hall'), conc = centre(roomRect(station, 'concourse')), wait = centre(roomRect(station, 'waiting'));
    const platform = new Vector3(Math.round((train.x0 + train.x1) / 2), train.y0 + 128, station.origin.z + 22);
    kit('capture_point', platform, { name: 'cp_station', radius: 224, owner: '1', time: 20 });
    kit('unit_group', platform.clone().add(new Vector3(-420, 0, 8)), { unit: 'unit_rebel_rpg', count: 3, owner: '1', name: 'station_rebels' });
    kit('unit_group', conc.clone().add(new Vector3(-160, 80, station.origin.z + 8)), { unit: 'unit_rebel_heavy', count: 1, owner: '1', name: 'station_rebels' });
    kit('unit_group', conc.clone().add(new Vector3(160, 80, station.origin.z + 8)), { unit: 'unit_rebel_ar2', count: 3, owner: '1', name: 'station_rebels' });
    kit('unit_group', wait.clone().add(new Vector3(0, 0, station.origin.z + 8)), { unit: 'unit_rebel_medic', count: 1, owner: '1', name: 'station_rebels' });
    kit('unit_group', wait.clone().add(new Vector3(96, 60, station.origin.z + 8)), { unit: 'unit_rebel', count: 2, owner: '1', name: 'station_rebels' });
    // Rebel command in the garden: headquarters, barracks, a munition depot, barricades in both gates, defenders and
    // Deacon himself.
    addEnt('build_reb_hq', at(58, 20.9), { targetname: 'reb_hq', ownernumber: '1', constructed: '2', angles: '0 180 0' });
    addEnt('build_reb_barracks', at(52.2, 21.9), { targetname: 'reb_barracks', ownernumber: '1', constructed: '2', angles: '0 0 0' });
    addEnt('build_reb_munitiondepot', at(58.4, 14.8), { targetname: 'reb_depot', ownernumber: '1', constructed: '2', angles: '0 90 0' });
    addEnt('build_barricade_rebels', at(55, 23.8), { targetname: 'gate_north', unittype: 'build_reb_barricade', ownernumber: '1', constructed: '2', angles: '0 0 0' });
    addEnt('build_barricade_rebels', at(50.2, 17), { targetname: 'gate_west', unittype: 'build_reb_barricade', ownernumber: '1', constructed: '2', angles: '0 90 0' });
    kit('unit_group', at(55, 21.6), { unit: 'unit_rebel_ar2', count: 4, owner: '1', name: 'garden_rebels' });
    kit('unit_group', at(51.8, 19.6), { unit: 'unit_rebel_sg', count: 2, owner: '1', name: 'garden_rebels' });
    kit('unit_group', at(57.6, 18.6), { unit: 'unit_rebel_rpg', count: 2, owner: '1', name: 'garden_rebels' });
    kit('unit_group', at(56.2, 19.6), { unit: 'unit_rebel_veteran', count: 1, owner: '1', name: 'deacon' });
    // Raids on the Citadel, staged in the streets around the grid, each ordered to the Citadel as it spawns.
    const raid = (name: string, unit: string, [cx, cy]: number[], count: number, live: number, freq = 1) => {
      kit('wave', at(cx, cy), { name, unit, count, live, freq, owner: '1', goal: 0, disabled: true });
      const order = byName(`${name}_order`);
      if (order) order.origin = at(SPOTS.hq[0] + 2, SPOTS.hq[1], 16);
    };
    raid('raid1', 'unit_rebel_partisan_molotov', SPOTS.raid1, 3, 3);
    raid('raid1b', 'unit_rebel_partisan', [SPOTS.raid1[0] + 1.5, SPOTS.raid1[1]], 3, 3);
    raid('raid2', 'unit_rebel', SPOTS.raid2, 6, 6);
    raid('raid2b', 'unit_rebel_rpg', [SPOTS.raid2[0] + 1.5, SPOTS.raid2[1]], 2, 2);
    raid('raid3', 'unit_rebel_ar2', SPOTS.raid3, 6, 6);
    raid('raid3b', 'unit_rebel_medic', [SPOTS.raid3[0] + 1.5, SPOTS.raid3[1]], 2, 2);
    raid('counter1', 'unit_rebel', SPOTS.counter[0], 8, 6, 2);
    raid('counter2', 'unit_rebel_sg', SPOTS.counter[1], 6, 6, 2);
    // Deacon's last stand: the barracks keeps sending squads out of the garden's north gate.
    raid('laststand', 'unit_rebel_ar2', [55, 25.6], 8, 4, 6);
    // Overwatch reinforcements: elite soldiers and Hunters off the train, onto the platform (the player's).
    const reinforce = (name: string, unit: string, dx: number, count: number) => {
      kit('wave', platform.clone().add(new Vector3(dx, 0, 0)), { name, unit, count, live: count, freq: 1, owner: '2', goal: 0, disabled: true });
      const order = byName(`${name}_order`);
      if (order) order.origin = conc.clone().setZ(station.origin.z + 24);
    };
    reinforce('train_elites', 'unit_combine_elite', 360, 4);
    reinforce('train_hunters', 'unit_hunter', 560, 2);
    // A Strider waits at the south end of the boulevard (neutral) and walks up to the square when the rail line
    // is back.
    kit('unit_group', at(SPOTS.strider[0], SPOTS.strider[1]), { unit: 'unit_strider', count: 1, owner: '0', name: 'strider' });
    // Citizens: neutral, sitting in the garden and standing at the market.
    kit('unit_group', at(52.6, 17), { unit: 'unit_citizen', count: 3, owner: '0', name: 'garden_citizens' });
    kit('unit_group', at(37, 23.2), { unit: 'unit_citizen', count: 4, owner: '0', name: 'market_citizens' });
    applyStandardRelations(editor);
  });

  // --- Cinematics -------------------------------------------------------------------------------------------------
  recordKit(editor, 'Garden District cinematics', () => {
    // The landing: the dropship comes in over the hotel and drops onto the square.
    addSpecs(shotEntities({ name: 'shot_landing', from: new Vector3(X(26), Y(10), 900), to: new Vector3(X(20), Y(16), 640), lookAt: new Vector3(X(10.5), Y(22.5), 60), duration: 8 }));
    addSpecs(pathEntities({ name: 'dropship_route', points: [[30, 50, 1100], [20, 42, 900], [12, 30, 620], [10.5, 23, 520], [4, 12, 760], [-2, 2, 1100]].map(([cx, cy, z]) => new Vector3(X(cx), Y(cy), z)) }));
    // The train: the camera over the platform as the reinforcements step off.
    addSpecs(shotEntities({ name: 'shot_train', from: new Vector3(X(60), Y(42), 900), to: new Vector3(X(58), Y(43), 720), lookAt: new Vector3(X(56), Y(46.5), 40), duration: 7 }));
    // The garden: the camera swings round the church as act 3 starts.
    addSpecs(shotEntities({ name: 'shot_garden', from: new Vector3(X(47), Y(12), 900), to: new Vector3(X(50), Y(10.5), 760), lookAt: new Vector3(X(55), Y(18), 200), duration: 8 }));
    addSpecs(pathEntities({ name: 'strider_route', points: [[19.5, 3], [19.5, 12], [18.5, 20]].map(([cx, cy]) => at(cx, cy, 8)) }));
    addSpecs(pathEntities({ name: 'gunship_route', points: [[64, 30, 900], [56, 22, 620], [47, 17, 560], [36, 18, 620], [24, 22, 760], [10, 30, 1000]].map(([cx, cy, z]) => new Vector3(X(cx), Y(cy), z)) }));
    // Smoke over the garden and fire in the streets, started with act 3.
    const fx = (effect: string, cx: number, cy: number, dz = 0) => addEnt('info_particle_system', at(cx, cy, dz), { targetname: 'garden_fx', effect_name: effect, start_active: '0', angles: '0 0 0' });
    fx('smoke_large_01', 55, 22, 300);
    fx('smoke_dark_plume_1', 58, 15, 200);
    fx('burning_vehicle', 41, 26.2);
    fx('burning_vehicle', 57.5, 26.4);
    fx('fire_large_01', 29, 38.6);
    // The church bell's loudspeaker.
    addEnt('ambient_generic', new Vector3(X(54.5), Y(17), g0 + 400), { targetname: 'garden_bell', message: 'ambient/misc/brass_bell_c.wav', health: '9', pitch: '100', radius: '6000', spawnflags: '49' });
    addEnt('ambient_generic', new Vector3(X(10), Y(22), 400), { targetname: 'raid_siren', message: 'ambient/alarms/city_siren_loop2.wav', health: '8', pitch: '100', radius: '14000', spawnflags: '49' });
  });
  const firstNode = (path: string) => byName(`${path}_1`)!;
  buildFlyby(editor, firstNode('dropship_route'), 'dropship_container', 650);
  buildFlyby(editor, firstNode('gunship_route'), 'gunship', 700);
  buildSendAlong(editor, firstNode('strider_route'), 'strider', { immortal: false, scripted: false });
  ATMOSPHERE_PRESETS.forEach((p, i) => buildAtmosphere(editor, p, new Vector3(X(1) + i * 64, Y(1), 96)));

  // --- Decals: wear on the streets and walls the camera sees -------------------------------------------------------
  const wear = gardenDecals(rng);
  const worn = await placeDecals(editor, wear, 700);
  decals += worn.overlays + worn.decals;
  if (worn.missed) notes.push(`${worn.missed} of ${wear.length} decals found no surface`);

  // --- World settings ---------------------------------------------------------------------------------------------
  recordKit(editor, 'Garden District mission', () => {
    doc.world.set('message', 'Garden District');
    doc.world.set('she_description', 'Combine mission. Land on the palace square, build a forward base, hold it against the raids and take the district back block by block, to the rebel command in the church garden.');
    // A grey spring afternoon.
    const sun = doc.entities.find((e) => e.classname === 'light_environment');
    if (sun) {
      sun.set('pitch', '-48');
      sun.set('angles', '0 215 0');
      sun.set('_light', '212 214 218 360');
      sun.set('_ambient', '146 154 166 220');
    }
    doc.entities.find((e) => e.classname === 'env_fog_controller')?.set('fogcolor', ATMOSPHERE_PRESETS[0].fogcolor);
  });
  editor.mission = gardenDistrictMission();
  editor.changed();
  const connections = doc.entities.reduce((n, e) => n + getConnections(e).length, 0);
  return { brushes, props, decals, entities: doc.entities.length, connections, notes };
}

const POSTERS = [
  ...Array.from({ length: 15 }, (_, i) => `posters/poster${i + 1}`),
  'decals/decal_posterbreen', 'decals/decal_posters001a', 'decals/decal_posters003a', 'decals/decal_posters005a',
];
const PROPAGANDA = ['decals/combinepropaganda01a', 'decals/combinepropaganda01b', 'decals/combinepropaganda01c', 'decals/combinepropaganda01d'];
const LITTER = ['decals/trashdecal01a', 'decals/trashdecal02a', 'decals/trashdecal03a', 'decals/trashdecal04a', 'decals/trashdecal05a'];
const DIRT = ['overlays/stains_05a', 'overlays/stains_05b', 'overlays/stain_01', 'overlays/stain_04', 'overlays/dirt01a'];
const GRAFFITI = ['decals/decalgraffiti001b', 'decals/decalgraffiti010a', 'decals/decalgraffiti017a'];

/**
 * Wear for the district: posters and propaganda on the facades along the streets (rays from the middle of the
 * street to both sides at head height), litter and stains on the carriageways, scorch marks where the raids come
 * from, lambda graffiti by the garden.
 */
export function gardenDecals(rng: Rng): DecalPlacement[] {
  const out: DecalPlacement[] = [];
  const down = new Vector3(0, 0, -1);
  // East–west streets: rays north and south from the middle of the street; north–south streets: east and west.
  const ew: [number, number, number][] = [[10.5, 22, 46], [25.5, 22, 46], [38.5, 22, 46]];
  const ns: [number, number, number][] = [[33.5, 0, 50], [47.5, 0, 50], [19.5, 0, 50]];
  for (const [cy, x0, x1] of ew) for (let cx = x0 + 1; cx < x1; cx += rng.range(2.2, 3.6)) {
    for (const dir of [1, -1]) {
      if (!rng.chance(0.55)) continue;
      const mat = rng.chance(0.25) ? rng.pick(PROPAGANDA) : rng.pick(POSTERS);
      out.push({ material: mat, from: new Vector3(X(cx), Y(cy), 150 + rng.range(-10, 20)), dir: new Vector3(0, dir, 0), size: Math.round(rng.range(90, 130)) });
    }
  }
  for (const [cx, y0, y1] of ns) for (let cy = y0 + 1; cy < y1; cy += rng.range(2.4, 3.8)) {
    for (const dir of [1, -1]) {
      if (!rng.chance(0.45)) continue;
      out.push({ material: rng.chance(0.25) ? rng.pick(PROPAGANDA) : rng.pick(POSTERS), from: new Vector3(X(cx), Y(cy), 150 + rng.range(-10, 20)), dir: new Vector3(dir, 0, 0), size: Math.round(rng.range(90, 130)) });
    }
  }
  // Litter and stains on the streets.
  const floor = (cx0: number, cy0: number, cx1: number, cy1: number, n: number, mats: string[], size: [number, number]) => {
    for (let i = 0; i < n; i++) out.push({ material: rng.pick(mats), from: new Vector3(X(rng.range(cx0, cx1)), Y(rng.range(cy0, cy1)), 300), dir: down.clone(), size: Math.round(rng.range(size[0], size[1])), rotation: rng.int(0, 359) });
  };
  for (const [cy] of ew) { floor(22, cy - 1.5, 46, cy + 1.5, 10, LITTER, [64, 96]); floor(22, cy - 1.5, 46, cy + 1.5, 6, DIRT, [160, 256]); }
  for (const [cx] of ns) { floor(cx - 1.5, 1, cx + 1.5, 50, 8, LITTER, [64, 96]); floor(cx - 1.5, 1, cx + 1.5, 50, 5, DIRT, [160, 256]); }
  // The square: stains on the pavers, tyre marks by the parking rows.
  floor(5, 12, 17, 29, 10, DIRT, [192, 320]);
  floor(5, 12, 17, 29, 6, LITTER, [64, 96]);
  // Scorch marks where the raids start, and blood on the garden paths.
  for (const [cx, cy] of [[29, 38.6], [41, 26.2], [57.5, 26.4], [26, 38.4], [40.5, 25]]) out.push({ material: 'decals/decal_crater001a', from: new Vector3(X(cx), Y(cy), 300), dir: down.clone(), size: 0 });
  // Lambda graffiti on the blocks facing the garden.
  for (const cx of [51.5, 54.5, 57.5]) out.push({ material: rng.pick(GRAFFITI), from: new Vector3(X(cx), Y(25.5), 120), dir: new Vector3(0, 1, 0), size: 160 });
  return out;
}

// --- Mission flowchart -----------------------------------------------------------------------------------------

/**
 * The mission as a flowchart: one stage per objective of the design doc (objectives 5 and 6 share one, since they
 * can be done in either order), and the outro. Losing the Citadel loses at every stage.
 */
export function gardenDistrictMission(): MissionGraph {
  let n = 0;
  const t = (condition: Transition['condition'], to: string, completes = true): Transition => ({ id: `t${++n}`, condition, to, completes });
  const act = (target: string, input: string, param = '', delay = 0) => ({ id: `a${++n}`, target, input, param, delay });
  const lost = () => t({ kind: 'lost', target: 'combine_hq' }, 'defeat', false);
  const stage = (id: string, title: string, col: number, row: number, rest: Partial<Stage>): Stage => ({
    id, title, x: 40 + col * 320, y: [60, 420, 780][row], messages: [], objectives: [], actions: [], gates: [], transitions: [], ...rest,
  });
  const stages: Stage[] = [
    // Act 1: Forward command.
    stage('deploy', 'Deploy the command post', 0, 0, {
      messages: [
        { speaker: 'Dispatch', text: 'Forward command, Garden District. Deploy power and a garrison.', hint: 'Build with the Stalker.' },
        { speaker: 'Kessler', text: 'Every minute you spend admiring the palace, the vermin dig in deeper.' },
      ],
      objectives: [{ id: 'o1a', text: 'Build a Power Generator' }, { id: 'o1b', text: 'Build a Garrison' }],
      actions: [act('atmo_day', 'Trigger'), act('start_funds', 'GiveResources', '250'), act('dropship_route_flyby', 'StartForward', '', 0.5), act('shot_landing', 'Enable', '', 0.5)],
      transitions: [t({ kind: 'all', conditions: [
        { kind: 'building', building: 'build_comb_powergenerator', owner: '2', count: 1, when: 'finished' },
        { kind: 'building', building: 'build_comb_garrison', owner: '2', count: 1, when: 'finished' },
      ] }, 'scrap'), lost()],
    }),
    stage('scrap', 'Power from scrap', 1, 0, {
      messages: [{ speaker: 'Dispatch', text: 'Scrap reserves detected in the park. Convert them.', hint: 'Scrap generators go on scrap piles.' }],
      objectives: [{ id: 'o2', text: 'Build a Scrap Power Generator in the park' }],
      transitions: [t({ kind: 'building', building: 'build_comb_powergenerator_scrap', owner: '2', count: 1, when: 'finished' }, 'muster'), lost()],
    }),
    stage('muster', 'Muster', 2, 0, {
      messages: [
        { speaker: 'Dispatch', text: 'Raise the force to sixteen. Movement on the north street.', hint: 'The Citadel holds 9; its population upgrade raises that to 20.' },
        { speaker: 'Deacon', text: 'Welcome to the garden, Overseer. Mind the bells.' },
      ],
      objectives: [{ id: 'o3', text: 'Raise your force to 16 population' }],
      actions: [act('garden_bell', 'PlaySound', '', 6), act('raid_siren', 'PlaySound', '', 88), act('raid_siren', 'StopSound', '', 100), act('raid1', 'Enable', '', 90), act('raid1b', 'Enable', '', 90)],
      transitions: [t({ kind: 'troops', owner: '2', count: 16, compare: 'atleast' }, 'hold'), lost()],
    }),
    stage('hold', 'Hold the square', 3, 0, {
      messages: [{ speaker: 'Dispatch', text: 'Hostile column, east approach. Hold the square.' }],
      objectives: [{ id: 'o4', text: 'Hold the square for 3 minutes' }],
      actions: [act('raid_siren', 'PlaySound', '', 2), act('raid_siren', 'StopSound', '', 14), act('raid2', 'Enable', '', 5), act('raid2b', 'Enable', '', 8)],
      transitions: [t({ kind: 'survive', seconds: 180 }, 'blocks'), lost()],
    }),
    // Act 2: Block by block.
    stage('blocks', 'Customs house, market and armory', 0, 1, {
      messages: [
        { speaker: 'Kessler', text: 'The customs house and the market feed them. Take both.', hint: 'Capture points give requisition.' },
        { speaker: 'Dispatch', text: 'Armory required for issue of pulse rifles.' },
      ],
      objectives: [{ id: 'o5a', text: 'Clear the customs house and take its capture point' }, { id: 'o5b', text: 'Take the street market' }, { id: 'o6', text: 'Build an Armory' }],
      actions: [act('raid3', 'Enable', '', 240), act('raid3b', 'Enable', '', 242), act('raid_siren', 'PlaySound', '', 236), act('raid_siren', 'StopSound', '', 248)],
      transitions: [t({ kind: 'all', conditions: [
        { kind: 'capture', target: 'cp_customs', owner: '2' },
        { kind: 'capture', target: 'cp_market', owner: '2' },
        { kind: 'building', building: 'build_comb_armory', owner: '2', count: 1, when: 'finished' },
      ] }, 'station'), lost()],
    }),
    stage('station', 'Retake the central station', 1, 1, {
      messages: [
        { speaker: 'Kessler', text: 'The station. Clear it room by room and give me back my rail line.' },
        { speaker: 'Deacon', text: 'You took a building. We are the district.' },
      ],
      objectives: [{ id: 'o7', text: 'Take the capture point in the train hall' }],
      transitions: [t({ kind: 'capture', target: 'cp_station', owner: '2' }, 'reinforce'), lost()],
    }),
    stage('reinforce', 'Reinforcements', 2, 1, {
      messages: [{ speaker: 'Dispatch', text: 'Rail line restored. Overwatch reinforcement arriving, platform one.' }],
      objectives: [{ id: 'o8', text: 'Meet the reinforcements at the platform' }],
      actions: [
        act('shot_train', 'Enable', '', 0.5),
        act('train_elites', 'Enable', '', 1), act('train_hunters', 'Enable', '', 2),
        act('strider', 'ChangeOwner', '2', 1), act('strider_route_go', 'Trigger', '', 1.5),
      ],
      transitions: [t({ kind: 'survive', seconds: 20 }, 'gates'), lost()],
    }),
    // Act 3: The garden.
    stage('gates', 'Break into the garden', 0, 2, {
      messages: [
        { speaker: 'Dispatch', text: 'Rebel command located: church garden. Break the gates.' },
        { speaker: 'Deacon', text: 'Ring the bells! Everyone, to the square!' },
      ],
      objectives: [{ id: 'o9', text: 'Destroy the barricades in both garden gates' }],
      actions: [
        act('shot_garden', 'Enable', '', 0.5), act('garden_bell', 'PlaySound', '', 1), act('atmo_dusk', 'Trigger', '', 2), act('garden_fx', 'Start', '', 2),
        act('counter1', 'Enable', '', 6), act('counter2', 'Enable', '', 10), act('gunship_route_flyby', 'StartForward', '', 4),
      ],
      transitions: [t({ kind: 'all', conditions: [{ kind: 'destroy', target: 'gate_north' }, { kind: 'destroy', target: 'gate_west' }] }, 'command'), lost()],
    }),
    stage('command', 'Rebel command', 1, 2, {
      messages: [{ speaker: 'Kessler', text: 'Burn the nest. Leave the church; it makes a fine example.' }],
      objectives: [{ id: 'o10', text: 'Destroy the rebel headquarters in the church garden' }],
      actions: [act('laststand', 'Enable', '', 3)],
      transitions: [t({ kind: 'destroy', target: 'reb_hq' }, 'end'), lost()],
    }),
    stage('end', 'District secured', 2, 2, {
      messages: [{ speaker: 'Dispatch', text: 'Garden District: contained. Resume compliance.' }],
      objectives: [{ id: 'o11', text: 'District secured' }],
      actions: [act('laststand', 'Disable'), act('counter1', 'Disable'), act('counter2', 'Disable'), act('garden_bell', 'StopSound'), act('atmo_citadel', 'Trigger', '', 2)],
      transitions: [t({ kind: 'survive', seconds: 10 }, 'victory')],
    }),
  ];
  return { version: 1, start: 'deploy', stages };
}

/** Cell rectangles the build and test scripts look things up by. */
export const AREAS = { square: SQUARE, garden: GARDEN, customs: CUSTOMS_CELLS, station: STATION_CELLS };
