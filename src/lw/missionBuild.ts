import { Vector2, Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { MapEntity, type VmfDocument } from '../vmf/map.ts';
import { getConnections, setConnections, type Connection } from '../vmf/io.ts';
import { boxSolid, solidBounds, solidNode, type FaceSpec } from '../edit/brushes.ts';
import { entity } from '../gen/layout.ts';
import { GATE_OPS, messageTexts, type Condition, type MissionGraph, type Stage, type Transition } from './mission.ts';

/**
 * Builds a mission flowchart into entities and I/O. Everything it creates carries `she_mission` so a
 * rebuild replaces only its own entities; outputs it added to map entities (units, unit makers, capture
 * points) are tagged the same way through their target names (all start with `mf_`).
 *
 * Per stage `S`:
 * - `mf_S_enter` (logic_relay) starts the stage: shows the first message (each message's Continue shows
 *   the next), makes the objectives visible and in progress, enables the stage's transitions and starts
 *   their condition entities, and fires the stage's actions (map entity inputs).
 * - `mf_S_tK` (logic_relay, starts disabled) is transition K. Its condition entities trigger it; when it
 *   fires it disables all of the stage's transitions and conditions, completes or fails the objectives, and
 *   starts the next stage (or calls PlayerVictory / PlayerLost on the win condition).
 * - Building and ability conditions listen to the game's global events (event_building_listener,
 *   wars_ability_manager.AbilityCompleted) and filter them per condition: the ability name with a
 *   logic_case, the player with filter_owner and the building type with filter_unittype, both tested on
 *   the event's activator (the building, or the unit or building that completed the ability). A count above
 *   one goes through a math_counter that is enabled and reset with the stage.
 * - "All of" gives each sub-condition a relay that adds one to a math_counter and then disables itself; the
 *   counter reaching the number of sub-conditions triggers the transition.
 * - Ability gates go to one wars_ability_manager per player (`mf_abilN`), whose inputs act on its owner.
 * - Where a stage's objective is (a reach area, a capture point, a single unit to destroy) gets the marker of
 *   sp_radio_tower: a striped outline on the ground and an arrow above it, shown while the stage runs.
 */

const MARK = 'she_mission';
const SEP_TIME = 1;

export interface BuildReport { entities: number; connections: number; warnings: string[] }

interface Ctx {
  doc: VmfDocument;
  at: Vector3;
  col: number;
  row: number;
  report: BuildReport;
  owners: Map<string, string>;
}

const add = (ctx: Ctx, cls: string, keys: Record<string, string>, origin?: Vector3): MapEntity => {
  const at = origin ?? ctx.at.clone().add(new Vector3(ctx.col * 48, ctx.row * 48, 0));
  if (!origin) ctx.row++;
  const node = entity(ctx.doc, cls, at.round(), { ...keys, [MARK]: '1' });
  ctx.report.entities++;
  return ctx.doc.addEntity(node);
};

const link = (ctx: Ctx, from: MapEntity, output: string, target: string, input: string, param = '', delay = 0): void => {
  const c: Connection = { output, target, input, param, delay, times: -1 };
  setConnections(from, [...getConnections(from), c]);
  ctx.report.connections++;
};

const relay = (ctx: Ctx, name: string, disabled = false) => add(ctx, 'logic_relay', { targetname: name, StartDisabled: disabled ? '1' : '0', spawnflags: '0' });

/** A filter_owner per player, shared by the stage triggers. */
function ownerFilter(ctx: Ctx, owner: string): string {
  let name = ctx.owners.get(owner);
  if (!name) {
    name = `mf_owner${owner}`;
    add(ctx, 'filter_owner', { targetname: name, ownernumber: owner, Negated: '0' });
    ctx.owners.set(owner, name);
  }
  return name;
}

/** Map entities (not the build's own) with this targetname. */
const mapNamed = (doc: VmfDocument, n: string) => doc.entities.filter((e) => e.get('targetname')?.toLowerCase() === n.trim().toLowerCase() && e.get(MARK) !== '1');

/** The output an entity fires when it dies. */
function deathOutput(e: MapEntity): string {
  if (e.classname === 'unit_maker') return 'OnAllSpawnedDead';
  if (/^(prop_physics|prop_dynamic|func_breakable|func_physbox)/.test(e.classname)) return 'OnBreak';
  return 'OnUnitKilled';
}

type Toggle = [string, string, string][];

const MARKER_MATERIAL = 'PG_TEX/PG_RED_STRIPE_MARKER';
const ARROW_MODEL = 'models/pg_props/pg_marks/pg_spawn_flag.mdl';
/** sp_radio_tower's marker: 18.4 units tall, leaning out 8, its 128x32 texture stretched to the height. */
const MARKER_HEIGHT = 18.4;
const MARKER_LEAN = 8;
const MARKER_U = 0.62;
const MARKER_V = 0.58;
/** The arrow model hangs below its origin: this high above the ground it points at the area. */
const ARROW_HEIGHT = 140;

/**
 * An objective marker as sp_radio_tower builds them: a never-solid func_brush around the area whose four
 * outward-leaning sides carry the animated red stripe (top and bottom nodraw), and the orange arrow model
 * above it. Both start hidden; `on` shows them with the stage and `off` hides them again. With `parent` the
 * arrow follows that entity (a unit) and there is no outline.
 */
function marker(ctx: Ctx, name: string, area: [number, number, number, number] | null, z: number, arrow: Vector3, parent?: string): { on: Toggle; off: Toggle } {
  const on: Toggle = [], off: Toggle = [];
  if (area) {
    const [x0, y0, x1, y1] = area;
    const inner = [new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, y1), new Vector2(x0, y1)];
    const outer = inner.map((q, i) => new Vector2(q.x + (i === 0 || i === 3 ? -MARKER_LEAN : MARKER_LEAN), q.y + (i < 2 ? -MARKER_LEAN : MARKER_LEAN)));
    const zb = z + 1, zt = zb + MARKER_HEIGHT;
    const p = (q: Vector2, h: number) => new Vector3(q.x, q.y, h);
    const faces: FaceSpec[] = [
      { points: [p(outer[0], zt), p(outer[2], zt), p(outer[1], zt)], material: 'TOOLS/TOOLSNODRAW' },
      { points: [p(inner[0], zb), p(inner[1], zb), p(inner[2], zb)], material: 'TOOLS/TOOLSNODRAW' },
    ];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const along = new Vector3(inner[j].x - inner[i].x, inner[j].y - inner[i].y, 0).normalize();
      faces.push({
        points: [p(outer[i], zt), p(outer[j], zt), p(inner[i], zb)], material: MARKER_MATERIAL,
        u: { axis: along, shift: 0, scale: MARKER_U },
        v: { axis: new Vector3(0, 0, -1), shift: (zt / MARKER_V) % 32, scale: MARKER_V },
      });
    }
    const outline = add(ctx, 'func_brush', {
      targetname: `${name}_mk`, StartDisabled: '1', Solidity: '1', spawnflags: '2', solidbsp: '0', InputFilter: '0', invert_exclusion: '0',
      disableshadows: '1', disablereceiveshadows: '1', vrad_brush_cast_shadows: '0', rendermode: '0', renderamt: '255', rendercolor: '255 255 255',
    }, new Vector3((x0 + x1) / 2, (y0 + y1) / 2, z));
    outline.node.delete('origin');
    outline.node.items.push(solidNode(ctx.doc, faces, '220 30 220'));
    outline.reload();
    on.push([`${name}_mk`, 'Enable', '']);
    off.push([`${name}_mk`, 'Disable', '']);
  }
  add(ctx, 'prop_dynamic', {
    targetname: `${name}_arrow`, model: ARROW_MODEL, skin: '1', solid: '0', StartDisabled: '1', DefaultAnim: 'idle',
    disableshadows: '1', fademindist: '-1', angles: '0 0 0', ...(parent ? { parentname: parent } : {}),
  }, arrow);
  on.push([`${name}_arrow`, 'Enable', '']);
  off.push([`${name}_arrow`, 'Disable', '']);
  return { on, off };
}

/** The marker for a condition's location, if it has one: a reach area, a capture point, a single unit. */
function conditionMarker(ctx: Ctx, base: string, c: Condition): { on: Toggle; off: Toggle } | null {
  const doc = ctx.doc;
  if (c.kind === 'reach' && c.area) {
    const [x0, y0, x1, y1] = c.area;
    return marker(ctx, base, c.area, c.z, new Vector3((x0 + x1) / 2, (y0 + y1) / 2, c.z + ARROW_HEIGHT));
  }
  if (c.kind === 'capture') {
    const point = mapNamed(doc, c.target).find((e) => e.classname === 'control_point' && e.origin);
    if (!point) return null;
    const zone = doc.entities.find((e) => e.classname === 'trigger_capture_area' && e.get('control_point')?.toLowerCase() === c.target.trim().toLowerCase() && e.solids.length);
    const at = point.origin!;
    let area: [number, number, number, number] = [at.x - 128, at.y - 128, at.x + 128, at.y + 128];
    let z = at.z;
    if (zone) {
      const box = zone.solids.map(solidBounds).reduce((a, b) => a.union(b));
      area = [box.min.x, box.min.y, box.max.x, box.max.y];
      z = box.min.z;
    }
    return marker(ctx, base, area, z, new Vector3(at.x, at.y, z + ARROW_HEIGHT));
  }
  if (c.kind === 'destroy') {
    // One unit: the arrow rides on it. A group or a wave has no single place to point at.
    const ents = mapNamed(doc, c.target);
    const unit = ents.length === 1 && ents[0].origin && /^unit_/.test(ents[0].classname) && ents[0].classname !== 'unit_maker' ? ents[0] : null;
    if (!unit) return null;
    return marker(ctx, base, null, unit.origin!.z, unit.origin!.clone().add(new Vector3(0, 0, ARROW_HEIGHT - 30)), c.target.trim());
  }
  return null;
}

/**
 * The condition's entities. Returns how to start and stop them with the stage: [entity name, input, param][].
 */
function buildCondition(ctx: Ctx, s: Stage, t: Transition, rel: string, c: Condition): { on: Toggle; off: Toggle } {
  const parts = conditionEntities(ctx, s, t, rel, c);
  // Only the way forward is marked, not what leads to defeat.
  const mk = t.completes && t.to !== 'defeat' ? conditionMarker(ctx, `${rel}_c`, c) : null;
  return mk ? { on: [...parts.on, ...mk.on], off: [...parts.off, ...mk.off] } : parts;
}

function conditionEntities(ctx: Ctx, s: Stage, t: Transition, rel: string, c: Condition): { on: Toggle; off: Toggle } {
  const doc = ctx.doc;
  const base = `${rel}_c`;
  const named = (n: string) => mapNamed(doc, n);
  switch (c.kind) {
    case 'reach': {
      if (!c.area) { ctx.report.warnings.push(`${s.title}: "reach" has no area`); return { on: [], off: [] }; }
      const [x0, y0, x1, y1] = c.area;
      const trig = add(ctx, 'trigger_multiple', {
        targetname: base, StartDisabled: '1', spawnflags: '66', wait: '1', filtername: ownerFilter(ctx, c.owner),
      }, new Vector3((x0 + x1) / 2, (y0 + y1) / 2, c.z));
      // A brush entity takes its position from its brush, not an origin key.
      trig.node.delete('origin');
      trig.node.items.push(boxSolid(doc, new Vector3(x0, y0, c.z - 32), new Vector3(x1, y1, c.z + 320), 'TOOLS/TOOLSTRIGGER'));
      const ed = new KVNode('editor');
      ed.items.push(new KVPair('color', '220 30 220'), new KVPair('visgroupshown', '1'), new KVPair('visgroupautoshown', '1'));
      trig.node.items.push(ed);
      trig.reload();
      link(ctx, trig, 'OnStartTouch', rel, 'Trigger');
      return { on: [[base, 'Enable', '']], off: [[base, 'Disable', '']] };
    }
    case 'destroy': case 'lost': {
      const ents = c.target ? named(c.target) : [];
      if (!ents.length) { ctx.report.warnings.push(`${s.title}: no entity is named "${c.target}"`); return { on: [], off: [] }; }
      if (c.kind === 'lost' || ents.length === 1) {
        for (const e of ents) link(ctx, e, deathOutput(e), rel, 'Trigger');
        return { on: [], off: [] };
      }
      // All of a group: count the deaths.
      const counter = add(ctx, 'math_counter', { targetname: base, min: '0', max: String(ents.length), startvalue: '0' });
      for (const e of ents) link(ctx, e, deathOutput(e), base, 'Add', '1');
      link(ctx, counter, 'OnHitMax', rel, 'Trigger');
      return { on: [], off: [] };
    }
    case 'destroy_faction': case 'troops': {
      const listener = add(ctx, 'wars_population_listener', { targetname: base, ownernumber: c.owner, StartDisabled: '1' });
      const value = c.kind === 'destroy_faction' ? 0 : c.compare === 'atleast' ? c.count - 0.5 : c.count + 0.5;
      const cmp = add(ctx, 'logic_compare', { targetname: `${base}_cmp`, InitialValue: '-1', CompareValue: String(value) });
      link(ctx, listener, 'OnPopulationChanged', `${base}_cmp`, 'SetValueCompare');
      const out = c.kind === 'destroy_faction' ? 'OnEqualTo' : c.compare === 'atleast' ? 'OnGreaterThan' : 'OnLessThan';
      link(ctx, cmp, out, rel, 'Trigger');
      return { on: [[base, 'Enable', '']], off: [[base, 'Disable', '']] };
    }
    case 'survive': {
      const timer = add(ctx, 'wars_mission_timer', { targetname: base, Timer: String(c.seconds), description: t.to === 'defeat' ? 'Time left' : 'Hold out', visible: '0', StartDisabled: '0', timerthreshold: '10', ontimeoutdo: '0' });
      link(ctx, timer, 'OnTimedOut', rel, 'Trigger');
      return { on: [[base, 'SetVisible', '1'], [base, 'Start', '']], off: [[base, 'Pause', ''], [base, 'SetVisible', '0']] };
    }
    case 'capture': {
      const points = c.target ? named(c.target).filter((e) => e.classname === 'control_point') : [];
      if (!points.length) { ctx.report.warnings.push(`${s.title}: no control point is named "${c.target}"`); return { on: [], off: [] }; }
      for (const p of points) link(ctx, p, `OnCaptured_Player${Number(c.owner) - 2}`, rel, 'Trigger');
      return { on: [], off: [] };
    }
    case 'resources':
      ctx.report.warnings.push(`${s.title}: "gain resources" can't be built yet (the game has no entity that reports resources)`);
      return { on: [], off: [] };
    case 'building': case 'ability': {
      const what = c.kind === 'building' ? c.building : c.ability;
      if (!what.trim()) { ctx.report.warnings.push(`${s.title}: a "${c.kind}" condition has nothing chosen`); return { on: [], off: [] }; }
      const counted = c.count > 1;
      const own = add(ctx, 'filter_owner', { targetname: `${base}_own`, ownernumber: c.owner, Negated: '0' });
      // The last filter fires the transition, or adds one to the counter.
      let last = own;
      if (c.kind === 'building') {
        const listener = add(ctx, 'event_building_listener', { targetname: base });
        link(ctx, listener, c.when === 'started' ? 'OnBuildingStarted' : 'OnBuildingFinished', `${base}_own`, 'TestActivator');
        last = add(ctx, 'filter_unittype', { targetname: `${base}_type`, unittype: what.trim(), Negated: '0' });
        link(ctx, own, 'OnPass', `${base}_type`, 'TestActivator');
      } else {
        // Without a unit (a cheat) the manager is the activator: give it the owner so the filter still applies.
        const manager = add(ctx, 'wars_ability_manager', { targetname: base, ownernumber: c.owner });
        const sw = add(ctx, 'logic_case', { targetname: `${base}_case`, Case01: what.trim() });
        link(ctx, manager, 'AbilityCompleted', `${base}_case`, 'InValue');
        link(ctx, sw, 'OnCase01', `${base}_own`, 'TestActivator');
      }
      if (!counted) {
        link(ctx, last, 'OnPass', rel, 'Trigger');
        return { on: [], off: [] };
      }
      const counter = add(ctx, 'math_counter', { targetname: `${base}_n`, min: '0', max: String(c.count), startvalue: '0', StartDisabled: '1' });
      link(ctx, last, 'OnPass', `${base}_n`, 'Add', '1');
      link(ctx, counter, 'OnHitMax', rel, 'Trigger');
      return { on: [[`${base}_n`, 'SetValueNoFire', '0'], [`${base}_n`, 'Enable', '']], off: [[`${base}_n`, 'Disable', '']] };
    }
    case 'all': {
      const subs = c.conditions.filter((x) => x.kind !== 'all');
      if (!subs.length) { ctx.report.warnings.push(`${s.title}: an "all of" condition has no conditions`); return { on: [], off: [] }; }
      const counter = add(ctx, 'math_counter', { targetname: `${rel}_all`, min: '0', max: String(subs.length), startvalue: '0', StartDisabled: '1' });
      link(ctx, counter, 'OnHitMax', rel, 'Trigger');
      const on: [string, string, string][] = [[`${rel}_all`, 'SetValueNoFire', '0'], [`${rel}_all`, 'Enable', '']];
      const off: [string, string, string][] = [[`${rel}_all`, 'Disable', '']];
      subs.forEach((sub, k) => {
        // Each part counts once: its relay adds one and switches itself off.
        const name = `${rel}_s${k}`;
        const r = relay(ctx, name, true);
        link(ctx, r, 'OnTrigger', `${rel}_all`, 'Add', '1');
        link(ctx, r, 'OnTrigger', name, 'Disable');
        const part = buildCondition(ctx, s, t, name, sub);
        // A part that is done stops (and its marker goes away) while the others still run.
        for (const [n, input, p] of part.off) link(ctx, r, 'OnTrigger', n, input, p);
        on.push([name, 'Enable', ''], ...part.on);
        off.push([name, 'Disable', ''], ...part.off);
      });
      return { on, off };
    }
  }
}

/** One wars_ability_manager per player for the stage gates: its inputs act on its own owner's tech tree. */
function gateManager(ctx: Ctx, owner: string): string {
  const name = `mf_abil${owner}`;
  if (!ctx.doc.entities.some((e) => e.get('targetname') === name && e.get(MARK) === '1')) add(ctx, 'wars_ability_manager', { targetname: name, ownernumber: owner });
  return name;
}

/** Removes everything a previous build made (entities and the outputs it added to map entities). */
export function clearMission(doc: VmfDocument): MapEntity[] {
  const removed = doc.entities.filter((e) => e.get(MARK) === '1');
  for (const e of removed) doc.removeEntity(e);
  for (const e of doc.entities) {
    const cs = getConnections(e);
    const kept = cs.filter((c) => !c.target.toLowerCase().startsWith('mf_'));
    if (kept.length !== cs.length) setConnections(e, kept);
  }
  return removed;
}

/** Builds the flowchart into `doc` (after clearing a previous build). `near` is where the logic entities go. */
export function buildMissionInto(doc: VmfDocument, g: MissionGraph, near: Vector3): BuildReport {
  clearMission(doc);
  const report: BuildReport = { entities: 0, connections: 0, warnings: [] };
  const ctx: Ctx = { doc, at: near.clone(), col: 0, row: 0, report, owners: new Map() };
  if (!g.stages.length) return report;
  const win = doc.entities.find((e) => e.classname === 'wars_win_condition')?.get('targetname')
    ?? add(ctx, 'wars_win_condition', { targetname: 'mf_result' }).get('targetname')!;
  const start = add(ctx, 'logic_auto', { targetname: 'mf_start', spawnflags: '1' });
  link(ctx, start, 'OnMapSpawn', `mf_${g.start}_enter`, 'Trigger', '', SEP_TIME);

  g.stages.forEach((s, si) => {
    ctx.col = si * 3;
    ctx.row = 0;
    const enter = relay(ctx, `mf_${s.id}_enter`);
    // Messages, one after another.
    s.messages.flatMap(messageTexts).forEach((m, i, all) => {
      const name = `mf_${s.id}_msg${i}`;
      const box = add(ctx, 'wars_messagebox', { targetname: name, Text: m });
      if (i === 0) link(ctx, enter, 'OnTrigger', name, 'Display', '', 0.5);
      if (i + 1 < all.length) link(ctx, box, 'OnPressContinue', `mf_${s.id}_msg${i + 1}`, 'Display', '', 0.3);
    });
    const objs = s.objectives.filter((o) => o.text.trim()).map((o, i) => {
      const name = `mf_${s.id}_obj${i}`;
      add(ctx, 'wars_mission_objective', { targetname: name, description: o.text.replace(/"/g, "'"), visible: '0', priority: String(10 - i), StartDisabled: '0' });
      link(ctx, enter, 'OnTrigger', name, 'SetVisible', '1', 1);
      link(ctx, enter, 'OnTrigger', name, 'SetInProgress', '', 1);
      return name;
    });
    for (const a of s.actions ?? []) {
      if (!a.target.trim() || !a.input.trim()) continue;
      if (!mapNamed(doc, a.target).length) ctx.report.warnings.push(`${s.title}: the action's target "${a.target}" is not in the map`);
      link(ctx, enter, 'OnTrigger', a.target.trim(), a.input.trim(), a.param, a.delay);
    }
    for (const gt of s.gates ?? []) {
      if (!gt.ability.trim()) continue;
      link(ctx, enter, 'OnTrigger', gateManager(ctx, gt.owner), GATE_OPS[gt.op].input, gt.ability.trim());
    }
    ctx.col++;
    ctx.row = 0;
    const offs: [string, string, string][] = [];
    const rels = s.transitions.map((t, k) => {
      const name = `mf_${s.id}_t${k}`;
      const r = relay(ctx, name, true);
      link(ctx, enter, 'OnTrigger', name, 'Enable');
      const { on, off } = buildCondition(ctx, s, t, name, t.condition);
      for (const [n, input, p] of on) link(ctx, enter, 'OnTrigger', n, input, p, 0.1);
      offs.push(...off);
      return { t, r };
    });
    for (const { t, r } of rels) {
      for (const other of rels) link(ctx, r, 'OnTrigger', other.r.get('targetname')!, 'Disable');
      for (const [n, input, p] of offs) link(ctx, r, 'OnTrigger', n, input, p);
      for (const o of objs) link(ctx, r, 'OnTrigger', o, t.completes ? 'SetCompleted' : 'SetFailed');
      if (t.to === 'victory') link(ctx, r, 'OnTrigger', win, 'PlayerVictory', '', 3);
      else if (t.to === 'defeat') link(ctx, r, 'OnTrigger', win, 'PlayerLost', '', 3);
      else {
        // Objectives of the stage left behind are hidden as the next one starts.
        for (const o of objs) link(ctx, r, 'OnTrigger', o, 'SetVisible', '0', 4);
        link(ctx, r, 'OnTrigger', `mf_${t.to}_enter`, 'Trigger', '', SEP_TIME);
      }
    }
  });
  return report;
}
