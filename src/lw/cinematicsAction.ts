import { Raycaster, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { entityNode, editorBlock } from '../edit/actions.ts';
import { boxFaces, solidNode, type FaceSpec } from '../edit/brushes.ts';
import { loadVmt } from '../assets/vmt.ts';
import { fetchGameFile } from '../assets/fetch.ts';
import { getConnections, setConnections } from '../vmf/io.ts';
import { recordKit, uniqueName } from './kits.ts';
import { settingsEntity, SETTING_GROUPS, createGroupEntity } from './mapSettings.ts';
import {
  CINE_KEY, PATH_CLASSES, STATIC_MATERIAL, anglesStr, atmosphereCcSpec, atmosphereConnections, atmosphereKeys, atmosphereOf, chainOf,
  flybyEntities, followFlybyEntities, lookAngles, pathLength, pathNodeNames, sendAlongConnections, shotEntities, type AtmospherePreset, type EntitySpec,
} from './cinematics.ts';

/** Editor-side actions for the cinematic pieces in cinematics.ts; each is one undo step. */

function addSpecs(editor: Editor, specs: EntitySpec[]): MapEntity[] {
  return specs.map((s) => editor.doc.addEntity(entityNode(editor, s.classname, roundV(s.origin), s.keys)));
}

const roundV = (v: Vector3) => new Vector3(Math.round(v.x), Math.round(v.y), Math.round(v.z));

/** Where the middle of the screen looks: the surface there, or a point 2000 units ahead. */
export function viewTarget(editor: Editor): Vector3 {
  const hit = editor.pickBrush(new Vector2(0, 0));
  if (hit) return hit.point.clone();
  return editor.camera.position.clone().addScaledVector(editor.controls.forward(), 2000);
}

/** A camera shot from the editor's current view: the camera where the editor camera is, looking at the screen centre. */
export function addShotFromView(editor: Editor, duration = 6): MapEntity {
  const name = uniqueName(editor, 'shot');
  const from = editor.camera.position.clone();
  const created = recordKit(editor, 'Add camera shot', () => {
    addSpecs(editor, shotEntities({ name, from, to: from, lookAt: viewTarget(editor), duration }));
  });
  const cam = created.find((e) => e.classname === 'point_viewcontrol')!;
  editor.selection.set([], [cam]);
  return cam;
}

function byName(editor: Editor, name: string | undefined): MapEntity | undefined {
  const n = name?.toLowerCase();
  return n ? editor.doc.entities.find((e) => e.get('targetname')?.toLowerCase() === n) : undefined;
}

/** Changes a shot: start, end (null removes the move), look-at point or duration. Recomputes speed and angles. */
export function editShot(editor: Editor, cam: MapEntity, change: { from?: Vector3; to?: Vector3 | null; lookAt?: Vector3; duration?: number }): void {
  const name = cam.get('targetname') ?? uniqueName(editor, 'shot');
  const look = byName(editor, cam.get('target'));
  const end = byName(editor, cam.get('moveto'));
  const from = change.from ?? cam.origin!;
  const to = change.to === null ? from : change.to ?? end?.origin ?? from;
  const lookAt = change.lookAt ?? look?.origin ?? viewTarget(editor);
  const duration = change.duration ?? (parseFloat(cam.get('wait') ?? '6') || 6);
  const specs = shotEntities({ name, from, to, lookAt, duration });
  editor.history.group('Edit camera shot', () => {
    const touched = [cam, look, end].filter((e): e is MapEntity => !!e);
    const finish = editor.history.begin('Edit camera shot', [], touched);
    const cs = specs[0];
    cam.origin = roundV(cs.origin);
    for (const [k, v] of Object.entries(cs.keys)) cam.set(k, v);
    if (!cs.keys.moveto) cam.node.delete('moveto');
    const ls = specs[1];
    if (look) look.origin = roundV(ls.origin);
    if (end && specs[2]) end.origin = roundV(specs[2].origin);
    finish();
    const added: MapEntity[] = [];
    if (!look) added.push(...addSpecs(editor, [ls]));
    if (!end && specs[2]) added.push(...addSpecs(editor, [specs[2]]));
    if (added.length) editor.history.added('Add shot parts', [], added);
    if (end && !specs[2]) editor.history.remove('Remove camera move', [], [end]);
  });
  editor.changed();
}

/** The ground height under a point (or null over the void). */
export function groundBelow(editor: Editor, p: Vector3): number | null {
  const hit = editor.world.raycast(new Raycaster(new Vector3(p.x, p.y, p.z + 1), new Vector3(0, 0, -1)));
  return hit ? hit.point.z : null;
}

/** The name a path's nodes share (`<name>_<n>`), from the node's she_cine key or its targetname. */
export function pathNameOf(node: MapEntity): string {
  return node.get(CINE_KEY) ?? (node.get('targetname') ?? 'path').replace(/_\d+$/, '');
}

function nextNodeName(editor: Editor, path: string): string {
  const used = new Set(editor.doc.entities.map((e) => e.get('targetname')?.toLowerCase()));
  for (let i = 1; ; i++) if (!used.has(`${path}_${i}`)) return `${path}_${i}`;
}

/**
 * Adds a path node at `at`. After `after` (a node), it is linked in behind it (and before whatever came
 * next); otherwise it starts a new path.
 */
export function addPathNode(editor: Editor, at: Vector3, after: MapEntity | null): MapEntity {
  const path = after ? pathNameOf(after) : (() => {
    const used = new Set(editor.doc.entities.map((e) => e.get('targetname')?.toLowerCase()));
    let name = 'route';
    for (let i = 2; used.has(`${name}_1`); i++) name = `route${i}`;
    return name;
  })();
  const name = nextNodeName(editor, path);
  let node!: MapEntity;
  editor.history.group('Add path node', () => {
    if (after) {
      const finish = editor.history.begin('Link path node', [], [after]);
      const next = after.get('target');
      node = editor.doc.addEntity(entityNode(editor, 'path_track', roundV(at), { targetname: name, [CINE_KEY]: path, ...(next ? { target: next } : {}) }));
      after.set('target', name);
      finish();
    } else {
      node = editor.doc.addEntity(entityNode(editor, 'path_track', roundV(at), { targetname: name, [CINE_KEY]: path }));
    }
    editor.history.added('Add path node', [], [node]);
  });
  editor.changed();
  editor.selection.set([], [node]);
  return node;
}

/** Removes a node and joins its neighbours. */
export function removePathNode(editor: Editor, node: MapEntity): void {
  const name = node.get('targetname')?.toLowerCase();
  const prev = editor.doc.entities.filter((e) => PATH_CLASSES.includes(e.classname) && e.get('target')?.toLowerCase() === name && e !== node);
  editor.history.group('Remove path node', () => {
    const finish = editor.history.begin('Join path', [], prev);
    const next = node.get('target');
    for (const p of prev) {
      if (next && next.toLowerCase() !== p.get('targetname')?.toLowerCase()) p.set('target', next);
      else p.node.delete('target');
    }
    finish();
    editor.history.remove('Remove path node', [], [node]);
  });
  editor.changed();
  editor.selection.set([], prev.slice(0, 1));
}

/** Sets every node of the node's path to `height` above the ground under it. */
export function setPathHeight(editor: Editor, node: MapEntity, height: number, all: boolean): void {
  const nodes = all ? chainOf(editor.doc, node)?.nodes ?? [node] : [node];
  const finish = editor.history.begin('Path height', [], nodes);
  for (const n of nodes) {
    const o = n.origin;
    if (!o) continue;
    const g = groundBelow(editor, o.clone().setZ(o.z + 4096)) ?? 0;
    n.origin = new Vector3(o.x, o.y, Math.round(g + height));
  }
  finish();
  editor.changed();
}

/** Closes the path into a loop (last node leads to the first), or opens it. */
export function setPathLoop(editor: Editor, node: MapEntity, loop: boolean): void {
  const chain = chainOf(editor.doc, node);
  if (!chain || chain.nodes.length < 2) return;
  const last = chain.nodes[chain.nodes.length - 1];
  const finish = editor.history.begin(loop ? 'Close path loop' : 'Open path loop', [], [last]);
  if (loop) last.set('target', chain.nodes[0].get('targetname') ?? '');
  else last.node.delete('target');
  finish();
  editor.changed();
}

/**
 * The `<path>_go` logic_relay that sends a unit along the path when triggered (creating it if needed).
 * Fire `Trigger` on it from a stage action or an output.
 */
export function buildSendAlong(editor: Editor, node: MapEntity, unit: string, opts: { immortal: boolean; scripted: boolean }): MapEntity {
  const path = pathNameOf(node);
  const relayName = `${path}_go`;
  const nodes = pathNodeNames(editor.doc, node);
  let relay = byName(editor, relayName);
  const conns = sendAlongConnections(unit, nodes, opts);
  if (relay) {
    const r = relay;
    const finish = editor.history.begin('Send along path', [], [r]);
    setConnections(r, conns);
    finish();
    editor.changed();
  } else {
    const at = node.origin!.clone().add(new Vector3(0, 0, 48));
    relay = recordKit(editor, 'Send along path', () => {
      const e = editor.doc.addEntity(entityNode(editor, 'logic_relay', roundV(at), { targetname: relayName, [CINE_KEY]: path, spawnflags: '0' }));
      setConnections(e, conns);
    })[0];
  }
  return relay;
}

/** The unit a send-along relay moves (the target of its outputs), if built. */
export function sendAlongUnit(editor: Editor, node: MapEntity): { relay: MapEntity; unit: string; immortal: boolean; scripted: boolean } | null {
  const relay = byName(editor, `${pathNameOf(node)}_go`);
  if (!relay) return null;
  const conns = getConnections(relay);
  const unit = conns.find((c) => c.input === 'Order')?.target ?? conns[0]?.target ?? '';
  return { relay, unit, immortal: conns.some((c) => c.input === 'MakeImmortal'), scripted: conns.some((c) => c.input === 'MakeUncontrollable') };
}

/** A flyby train on the path: `<path>_flyby` (StartForward) carrying the aircraft model. Replaces an existing one. */
export function buildFlyby(editor: Editor, node: MapEntity, modelId: string, speed: number): MapEntity {
  const path = pathNameOf(node);
  const name = `${path}_flyby`;
  const chain = chainOf(editor.doc, node);
  const first = chain?.nodes[0] ?? node;
  const at = first.origin!.clone();
  const old = editor.doc.entities.filter((e) => e.get(CINE_KEY) === name);
  let train!: MapEntity;
  editor.history.group('Flyby', () => {
    if (old.length) editor.history.remove('Remove old flyby', [], old);
    const specs = flybyEntities(name, first.get('targetname') ?? '', at, modelId, speed);
    const t = entityNode(editor, specs[0].classname, null, { ...specs[0].keys, origin: `${Math.round(at.x)} ${Math.round(at.y)} ${Math.round(at.z)}` });
    // A tracktrain needs a brush; a small nodraw block around its origin carries it.
    t.items.push(solidNode(editor.doc, boxFaces(at.clone().addScalar(-8), at.clone().addScalar(8), 'TOOLS/TOOLSNODRAW')), editorBlock());
    train = editor.doc.addEntity(t);
    const model = addSpecs(editor, [specs[1]]);
    editor.history.added('Add flyby', train.solids, [train, ...model]);
  });
  editor.changed();
  return train;
}

/** `<path>_flyby_go`: starts the flyby with the players' camera following it until it arrives. */
export function buildFlybyFollow(editor: Editor, node: MapEntity): MapEntity | null {
  const path = pathNameOf(node);
  const train = byName(editor, `${path}_flyby`);
  const chain = chainOf(editor.doc, node);
  if (!train || !chain) return null;
  const speed = parseFloat(train.get('startspeed') ?? '600') || 600;
  const seconds = pathLength(chain.nodes.map((n) => n.origin!)) / speed + 1;
  const spec = followFlybyEntities(train.get('targetname')!, seconds, chain.nodes[0].origin!.clone().add(new Vector3(0, 64, 0)));
  const old = [byName(editor, `${path}_flyby_cam`), byName(editor, `${path}_flyby_go`)].filter((e): e is MapEntity => !!e);
  let relay!: MapEntity;
  editor.history.group('Camera follows flyby', () => {
    if (old.length) editor.history.remove('Remove old follow', [], old);
    const [follow, r] = addSpecs(editor, [spec.follow, spec.relay]);
    setConnections(r, spec.connections);
    relay = r;
    editor.history.added('Camera follows flyby', [], [follow, r]);
  });
  editor.changed();
  return relay;
}

/** Texture size of a material's base texture (for fitting it to a screen panel). */
async function textureSize(material: string): Promise<[number, number]> {
  const vmt = await loadVmt(material);
  const base = vmt?.params.get('$basetexture');
  const buf = base ? await fetchGameFile(`materials/${base.toLowerCase().replace(/\\/g, '/')}.vtf`) : null;
  if (!buf || buf.byteLength < 20) return [512, 512];
  const v = new DataView(buf);
  return [v.getUint16(16, true) || 512, v.getUint16(18, true) || 512];
}

/** A flat panel in front of a wall, the material fitted to it once across. */
async function panelSolid(editor: Editor, center: Vector3, normal: Vector3, w: number, h: number, offset: number, material: string): Promise<KVNode> {
  const n = Math.abs(normal.x) >= Math.abs(normal.y) ? new Vector3(Math.sign(normal.x) || 1, 0, 0) : new Vector3(0, Math.sign(normal.y) || 1, 0);
  const across = new Vector3(-n.y, n.x, 0).multiplyScalar(n.x !== 0 ? 1 : 1);
  const c = center.clone().addScaledVector(n, offset);
  const a = c.clone().addScaledVector(across, -w / 2), b = c.clone().addScaledVector(across, w / 2);
  const min = new Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), c.z - h / 2).addScaledVector(n.clone().set(Math.abs(n.x), Math.abs(n.y), 0), -0.5);
  const max = new Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), c.z + h / 2).addScaledVector(n.clone().set(Math.abs(n.x), Math.abs(n.y), 0), 0.5);
  min.set(Math.round(min.x), Math.round(min.y), Math.round(min.z));
  max.set(Math.round(max.x), Math.round(max.y), Math.round(max.z));
  if (max.x - min.x < 1) max.x = min.x + 1;
  if (max.y - min.y < 1) max.y = min.y + 1;
  const [tw, th] = await textureSize(material);
  const uAxis = n.x !== 0 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  // Flip u on walls seen from the other side so the picture isn't mirrored.
  const flip = (n.x !== 0 ? -n.x : n.y) < 0 ? -1 : 1;
  const uDir = uAxis.clone().multiplyScalar(flip);
  const uStart = Math.min(uDir.dot(min), uDir.dot(max));
  const uScale = w / tw, vScale = h / th;
  const faces: FaceSpec[] = boxFaces(min, max, 'TOOLS/TOOLSNODRAW').map((f) => {
    const [p0, p1, p2] = f.points;
    const fn = new Vector3().subVectors(p2, p0).cross(new Vector3().subVectors(p1, p0)).normalize();
    if (fn.dot(n) < 0.9) return f;
    return {
      ...f, material,
      u: { axis: uDir, shift: -uStart / uScale, scale: uScale },
      v: { axis: new Vector3(0, 0, -1), shift: max.z / vScale, scale: vScale },
    };
  });
  return solidNode(editor.doc, faces);
}

/**
 * A screen on a wall: `<name>` shows `material`, `<name>_static` (starts disabled, a unit in front) shows
 * static. Enable `<name>_static` to cut the broadcast to static.
 */
export async function addScreen(editor: Editor, center: Vector3, normal: Vector3, w: number, h: number, material: string): Promise<MapEntity> {
  const name = uniqueName(editor, 'screen');
  const front = await panelSolid(editor, center, normal, w, h, 1, material);
  const stat = await panelSolid(editor, center, normal, w, h, 2, STATIC_MATERIAL);
  const make = (cls: string, keys: Record<string, string>, solid: KVNode) => {
    const e = new KVNode('entity');
    e.items.push(new KVPair('id', String(editor.doc.nextId())), new KVPair('classname', cls));
    for (const [k, v] of Object.entries(keys)) e.items.push(new KVPair(k, v));
    e.items.push(solid, editorBlock('0 200 120'));
    return editor.doc.addEntity(e);
  };
  const base = { Solidity: '1', disableshadows: '1', vrad_brush_cast_shadows: '0', rendermode: '0', [CINE_KEY]: name };
  let screen!: MapEntity;
  editor.history.group('Add screen', () => {
    screen = make('func_brush', { ...base, targetname: name, StartDisabled: '0' }, front);
    const s = make('func_brush', { ...base, targetname: `${name}_static`, StartDisabled: '1' }, stat);
    editor.history.added('Add screen', [...screen.solids, ...s.solids], [screen, s]);
  });
  editor.changed();
  editor.selection.set([], [screen]);
  return screen;
}

/** The map's fog controller targetname, adding the Settings tab's fog entity if the map has none. */
function fogName(editor: Editor): string {
  const g = SETTING_GROUPS.find((x) => x.id === 'fog')!;
  let fog = settingsEntity(editor.doc, g);
  if (!fog) fog = createGroupEntity(editor.doc, g)[0];
  if (!fog.get('targetname')) fog.set('targetname', 'fog');
  return fog.get('targetname')!;
}

/** Atmosphere relays in the map (logic_relay with she_atmo_* keys). */
export function atmosphereRelays(editor: Editor): MapEntity[] {
  return editor.doc.entities.filter((e) => atmosphereOf(e));
}

/**
 * Adds or rebuilds an atmosphere preset: its relay (`Trigger` blends to it) and its colour correction
 * entity, and refreshes every preset's outputs so each one switches the others' colour correction off.
 */
export function buildAtmosphere(editor: Editor, preset: AtmospherePreset, at: Vector3): MapEntity {
  let relay = byName(editor, preset.name);
  editor.history.group('Atmosphere', () => {
    const relays = atmosphereRelays(editor);
    const ccs = editor.doc.entities.filter((e) => e.classname === 'color_correction' && e.get(CINE_KEY));
    const fogEnt = () => editor.doc.entities.find((e) => e.classname === 'env_fog_controller');
    const touched = [...relays, ...ccs, ...(fogEnt() ? [fogEnt()!] : [])];
    const finish = editor.history.begin('Atmosphere', [], touched);
    const before = new Set(editor.doc.entities);
    const fog = fogName(editor);
    if (!relay) relay = editor.doc.addEntity(entityNode(editor, 'logic_relay', roundV(at), { targetname: preset.name, spawnflags: '0', [CINE_KEY]: preset.name }));
    for (const [k, v] of Object.entries(atmosphereKeys(preset))) relay.set(k, v);
    let cc = byName(editor, `${preset.name}_cc`);
    const ccSpec = atmosphereCcSpec(preset, relay.origin!.clone().add(new Vector3(32, 0, 0)));
    if (preset.cc) {
      if (!cc) cc = addSpecs(editor, [ccSpec])[0];
      for (const [k, v] of Object.entries(ccSpec.keys)) cc.set(k, v);
    }
    // Every preset turns the others' colour correction off.
    const all = atmosphereRelays(editor);
    const ccNames = all.map((r) => atmosphereOf(r)!).filter((p) => p.cc).map((p) => `${p.name}_cc`);
    for (const r of all) {
      const p = atmosphereOf(r)!;
      setConnections(r, atmosphereConnections(p, fog, ccNames.filter((n) => n !== `${p.name}_cc`)));
    }
    finish();
    const added = editor.doc.entities.filter((e) => !before.has(e));
    if (added.length) editor.history.added('Add atmosphere', [], added);
    if (!preset.cc && cc) editor.history.remove('Remove colour correction', [], [cc]);
  });
  editor.changed();
  return relay!;
}

export { anglesStr, lookAngles };
