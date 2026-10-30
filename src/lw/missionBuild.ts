import { Vector3 } from 'three';
import { KVNode, KVPair } from '../vmf/keyvalues.ts';
import { MapEntity, type VmfDocument } from '../vmf/map.ts';
import { getConnections, setConnections, type Connection } from '../vmf/io.ts';
import { boxSolid } from '../edit/brushes.ts';
import { entity } from '../gen/layout.ts';
import type { Condition, MissionGraph, Stage, Transition } from './mission.ts';

/**
 * Builds a mission flowchart into entities and I/O. Everything it creates carries `she_mission` so a
 * rebuild replaces only its own entities; outputs it added to map entities (units, unit makers, capture
 * points) are tagged the same way through their target names (all start with `mf_`).
 *
 * Per stage `S`:
 * - `mf_S_enter` (logic_relay) starts the stage: shows the first message (each message's Continue shows
 *   the next), makes the objectives visible and in progress, enables the stage's transitions and starts
 *   their condition entities.
 * - `mf_S_tK` (logic_relay, starts disabled) is transition K. Its condition entities trigger it; when it
 *   fires it disables all of the stage's transitions and conditions, completes or fails the objectives, and
 *   starts the next stage (or calls PlayerVictory / PlayerLost on the win condition).
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

/** The output an entity fires when it dies. */
function deathOutput(e: MapEntity): string {
  if (e.classname === 'unit_maker') return 'OnAllSpawnedDead';
  if (/^(prop_physics|prop_dynamic|func_breakable|func_physbox)/.test(e.classname)) return 'OnBreak';
  return 'OnUnitKilled';
}

/**
 * The condition's entities. Returns how to start and stop them with the stage: [entity name, input, param][].
 */
function buildCondition(ctx: Ctx, s: Stage, t: Transition, rel: string, c: Condition): { on: [string, string, string][]; off: [string, string, string][] } {
  const doc = ctx.doc;
  const base = `${rel}_c`;
  const named = (n: string) => doc.entities.filter((e) => e.get('targetname')?.toLowerCase() === n.toLowerCase() && e.get(MARK) !== '1');
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
  }
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
    s.messages.filter((m) => m.trim()).forEach((m, i, all) => {
      const name = `mf_${s.id}_msg${i}`;
      const box = add(ctx, 'wars_messagebox', { targetname: name, Text: m.replace(/"/g, "'").replace(/\s+/g, ' ').trim() });
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
