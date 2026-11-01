import type { VmfDocument } from '../vmf/map.ts';
import { getConnections } from '../vmf/io.ts';
import { fgdClass } from '../assets/fgd.ts';
import { CONDITIONS, asMessage, describeCondition, type Condition, type MissionGraph, type Stage } from './mission.ts';
import { GAME_ABILITIES } from './gameAbilities.ts';

export interface MissionIssue { severity: 'error' | 'warning'; text: string; stage?: string }

/** Classes whose death the mission build can listen to (see `deathOutput` in missionBuild.ts). */
export const MORTAL = /^(unit_|npc_|prop_physics|prop_dynamic|func_breakable|func_physbox|build_|wars_building)/;
const HAND_LOGIC = new Set(['wars_messagebox', 'wars_mission_objective']);

/** Stages reachable from `from` by following transitions. */
function reachable(g: MissionGraph, from: string[]): Set<string> {
  const seen = new Set<string>();
  const todo = [...from];
  while (todo.length) {
    const id = todo.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = g.stages.find((x) => x.id === id);
    for (const t of s?.transitions ?? []) todo.push(t.to);
  }
  return seen;
}

/**
 * Checks the flowchart and the map it is built into: stages that can't be reached or can't end, missing
 * areas and targets, actions on entities that don't exist, and hand-placed mission logic that would show
 * next to the flowchart's.
 */
export function checkMission(g: MissionGraph, doc: VmfDocument): MissionIssue[] {
  const issues: MissionIssue[] = [];
  const err = (text: string, s?: Stage) => issues.push({ severity: 'error', text: s ? `${s.title}: ${text}` : text, stage: s?.id });
  const warn = (text: string, s?: Stage) => issues.push({ severity: 'warning', text: s ? `${s.title}: ${text}` : text, stage: s?.id });
  if (!g.stages.length) { err('The flowchart has no stages'); return issues; }
  const start = g.stages.find((s) => s.id === g.start);
  if (!start) err('No start stage is set');

  // Map entities by name, without the flowchart's own build.
  const byName = new Map<string, string[]>();
  for (const e of doc.entities) {
    const n = e.get('targetname')?.toLowerCase();
    if (n && e.get('she_mission') !== '1') byName.set(n, [...(byName.get(n) ?? []), e.classname]);
  }
  const classes = (n: string) => byName.get(n.trim().toLowerCase()) ?? [];

  const fromStart = start ? reachable(g, [start.id]) : new Set<string>();
  if (start && !fromStart.has('victory')) err('Nothing leads to Victory from the start stage: the mission can\'t be won');
  if (start && !fromStart.has('defeat')) warn('Nothing leads to Defeat: the player can\'t lose (add "destroy a faction" for your own units)');

  for (const s of g.stages) {
    if (start && !fromStart.has(s.id)) warn('no transition leads here, so the stage never starts', s);
    if (!s.transitions.length) err('has no transitions: the mission gets stuck here', s);
    else if (start && fromStart.has(s.id) && fromStart.has('victory') && !reachable(g, [s.id]).has('victory')) warn('can\'t lead to Victory from here', s);
    if (s.id === g.start && !s.objectives.some((o) => o.text.trim())) warn('the start stage has no objective, so the HUD shows nothing to do', s);

    const checkCondition = (c: Condition, inAll: boolean): void => {
      const what = `"${describeCondition(c)}"`;
      switch (c.kind) {
        case 'reach':
          if (!c.area) err(`${what}: no area is drawn`, s);
          break;
        case 'destroy': case 'lost': {
          if (!c.target.trim()) { err(`${what}: nothing is chosen`, s); break; }
          const cls = classes(c.target);
          if (!cls.length) err(`${what}: no entity in the map is named "${c.target}"`, s);
          else if (!cls.some((x) => MORTAL.test(x) || x === 'unit_maker')) warn(`${what}: "${c.target}" is a ${cls[0]}, which can't be destroyed`, s);
          break;
        }
        case 'capture': {
          if (!c.target.trim()) { err(`${what}: no control point is chosen`, s); break; }
          if (!classes(c.target).includes('control_point')) err(`${what}: no control point in the map is named "${c.target}"`, s);
          if (Number(c.owner) < 2) err(`${what}: only players can capture a point`, s);
          break;
        }
        case 'resources':
          warn(`${what}: ${CONDITIONS.resources.hint}`, s);
          break;
        case 'building': case 'ability': {
          const name = (c.kind === 'building' ? c.building : c.ability).trim();
          if (!name) { err(`${what}: nothing is chosen`, s); break; }
          const known = GAME_ABILITIES.find((a) => a.name === name);
          if (!known) warn(`${what}: the game has no ${c.kind === 'building' ? 'building' : 'ability'} named "${name}" (names come from the game's Python)`, s);
          else if (c.kind === 'building' && known.kind !== 'building') err(`${what}: "${name}" is a ${known.kind}, not a building`, s);
          if (!(c.count >= 1)) err(`${what}: the count must be at least 1`, s);
          break;
        }
        case 'all':
          if (inAll) { err(`${what}: "all of" can't be nested`, s); break; }
          if (c.conditions.length < 2) warn(`${what}: "all of" needs two or more conditions to mean anything`, s);
          for (const sub of c.conditions) checkCondition(sub, true);
          break;
      }
    };
    for (const t of s.transitions) {
      if (t.to !== 'victory' && t.to !== 'defeat' && !g.stages.some((x) => x.id === t.to)) err(`"${describeCondition(t.condition)}" leads to a stage that no longer exists`, s);
      checkCondition(t.condition, false);
    }

    for (const gt of s.gates ?? []) {
      if (!gt.ability.trim()) { err('an ability gate has no ability chosen', s); continue; }
      if (!GAME_ABILITIES.some((a) => a.name === gt.ability.trim())) warn(`the ability gate "${gt.ability}": the game has no ability with that name`, s);
    }
    for (const m of s.messages.map(asMessage)) {
      if (m.text.trim().startsWith('#') && (m.speaker?.trim() || m.hint?.trim())) warn(`the message "${m.text.trim()}" is a localisation token: the game looks up the whole text, so its speaker and hint are left out`, s);
      if (!m.text.trim() && (m.speaker?.trim() || m.hint?.trim())) warn('a message has a speaker or hint but no text, so it is skipped', s);
    }

    for (const a of s.actions ?? []) {
      if (!a.target.trim() || !a.input.trim()) { err('an action has no target or input', s); continue; }
      const cls = classes(a.target);
      if (!cls.length) { err(`the action ${a.target}.${a.input}: no entity in the map is named "${a.target}"`, s); continue; }
      const fgd = fgdClass(cls[0]);
      if (fgd?.inputs.length && !fgd.inputs.some((x) => x.name.toLowerCase() === a.input.trim().toLowerCase())) warn(`the action ${a.target}.${a.input}: a ${cls[0]} has no input "${a.input}"`, s);
    }
  }

  // Messages and objectives placed by hand still show, on top of the flowchart's.
  const hand = doc.entities.filter((e) => e.get('she_mission') !== '1' && HAND_LOGIC.has(e.classname));
  if (hand.length) {
    const names = hand.map((e) => e.get('targetname') || e.classname);
    warn(`The map also has ${hand.length} hand-placed message${hand.length > 1 ? 's' : ''} or objective${hand.length > 1 ? 's' : ''} (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''}): they show alongside the flowchart's`);
  }
  const triggers = doc.entities.filter((e) => e.get('she_mission') !== '1' && getConnections(e).some((c) => hand.some((x) => x.get('targetname') === c.target)));
  if (triggers.length && hand.length) warn(`Hand-made logic still drives them: ${triggers.map((e) => e.get('targetname') || e.classname).slice(0, 4).join(', ')}`);
  return issues;
}
