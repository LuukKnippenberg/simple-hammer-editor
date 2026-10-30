import { GATE_OPS, abilityLabel, asMessage, describeCondition, type Condition, type MissionGraph, type MissionMessage, type Transition } from './mission.ts';

/**
 * Steps through a mission flowchart the way the built entities play it: entering a stage shows its
 * messages, makes its objectives active, fires its actions and starts its timers; taking a transition
 * completes or fails the objectives and moves on. Counted conditions ("3 × barricade") take one click per
 * event, and an "all of" transition is taken once each of its parts has been met. The editor plays it in the
 * flowchart dialog.
 */

export type ObjectiveState = 'active' | 'completed' | 'failed';

export interface SimObjective { key: string; text: string; stage: string; state: ObjectiveState }

export interface SimEvent { kind: 'stage' | 'message' | 'objective' | 'action' | 'timer' | 'progress' | 'transition' | 'end'; text: string }

export interface SimState {
  /** The running stage, or null once the mission has ended. */
  stage: string | null;
  result: 'victory' | 'defeat' | null;
  /** Messages of the running stage still to be read (the first is on screen). */
  messages: MissionMessage[];
  /** Events counted so far for the running stage's conditions: by transition id, or `id/part` for "all of". */
  progress: Record<string, number>;
  /** Objectives shown in the HUD: the running stage's, and earlier ones until the next stage hides them. */
  objectives: SimObjective[];
  /** Stage ids in the order they were entered, and the transitions taken. */
  path: string[];
  taken: string[];
  log: SimEvent[];
}

function enter(g: MissionGraph, st: SimState, id: string): SimState {
  const s = g.stages.find((x) => x.id === id);
  if (!s) return { ...st, stage: null, log: [...st.log, { kind: 'end', text: `Stage "${id}" doesn't exist: the mission stops here` }] };
  const log: SimEvent[] = [{ kind: 'stage', text: s.title }];
  const messages = s.messages.map(asMessage).filter((m) => m.text.trim());
  for (const m of messages) log.push({ kind: 'message', text: `${m.speaker ? `${m.speaker}: ` : ''}${m.text}` });
  const objectives = s.objectives.filter((o) => o.text.trim()).map((o): SimObjective => ({ key: `${s.id}/${o.id}`, text: o.text, stage: s.id, state: 'active' }));
  for (const o of objectives) log.push({ kind: 'objective', text: `New objective: ${o.text}` });
  for (const a of s.actions ?? []) if (a.target.trim()) log.push({ kind: 'action', text: `${a.target}.${a.input}${a.param ? `(${a.param})` : ''}${a.delay ? ` after ${a.delay} s` : ''}` });
  for (const gt of s.gates ?? []) if (gt.ability.trim()) log.push({ kind: 'action', text: `${GATE_OPS[gt.op].label}: ${abilityLabel(gt.ability)}${gt.owner === '2' ? '' : ` (owner ${gt.owner})`}` });
  for (const t of s.transitions) {
    const parts = t.condition.kind === 'all' ? t.condition.conditions : [t.condition];
    for (const c of parts) if (c.kind === 'survive') log.push({ kind: 'timer', text: `Timer starts: ${describeCondition(c)}` });
  }
  return {
    ...st,
    stage: s.id,
    messages,
    progress: {},
    objectives: [...st.objectives, ...objectives],
    path: [...st.path, s.id],
    log: [...st.log, ...log],
  };
}

export function simStart(g: MissionGraph): SimState {
  const st: SimState = { stage: null, result: null, messages: [], progress: {}, objectives: [], path: [], taken: [], log: [] };
  return enter(g, st, g.start);
}

/** The running stage's transitions, waiting for their conditions. */
export function simWaiting(g: MissionGraph, st: SimState): Transition[] {
  return g.stages.find((s) => s.id === st.stage)?.transitions ?? [];
}

/** Reads the message on screen (Continue): the next one shows. */
export function simContinue(st: SimState): SimState {
  return { ...st, messages: st.messages.slice(1) };
}

/** How many events a condition waits for. */
export const simNeeds = (c: Condition): number => (c.kind === 'building' || c.kind === 'ability' ? Math.max(1, c.count) : 1);

/** Events counted so far for a transition (or one part of an "all of" transition). */
export const simCount = (st: SimState, transitionId: string, part?: number): number => st.progress[part === undefined ? transitionId : `${transitionId}/${part}`] ?? 0;

/**
 * One event for `transitionId` (or for `part` of an "all of" transition) happens. Once the condition is met
 * the stage ends and the mission moves on; until then the count goes up.
 */
export function simTake(g: MissionGraph, st: SimState, transitionId: string, part?: number): SimState {
  const t = simWaiting(g, st).find((x) => x.id === transitionId);
  if (!t || !st.stage) return st;
  const c = t.condition;
  if (c.kind === 'all') {
    const sub = part === undefined ? undefined : c.conditions[part];
    if (!sub) return st;
    const key = `${t.id}/${part}`;
    const n = Math.min(simNeeds(sub), (st.progress[key] ?? 0) + 1);
    const progress = { ...st.progress, [key]: n };
    const done = c.conditions.filter((x, k) => (progress[`${t.id}/${k}`] ?? 0) >= simNeeds(x)).length;
    const counted: SimState = { ...st, progress, log: [...st.log, { kind: 'progress', text: `${describeCondition(sub)}${simNeeds(sub) > 1 ? ` (${n} of ${simNeeds(sub)})` : ''}: ${done} of ${c.conditions.length} parts met` }] };
    return done < c.conditions.length ? counted : finish(g, counted, t);
  }
  if (simNeeds(c) > 1) {
    const n = (st.progress[t.id] ?? 0) + 1;
    const counted: SimState = { ...st, progress: { ...st.progress, [t.id]: n }, log: [...st.log, { kind: 'progress', text: `${describeCondition(c)}: ${n} of ${simNeeds(c)}` }] };
    return n < simNeeds(c) ? counted : finish(g, counted, t);
  }
  return finish(g, st, t);
}

function finish(g: MissionGraph, st: SimState, t: Transition): SimState {
  const state: ObjectiveState = t.completes ? 'completed' : 'failed';
  const log: SimEvent[] = [{ kind: 'transition', text: describeCondition(t.condition) }];
  const objectives = st.objectives
    // Objectives of stages left earlier are hidden by now.
    .filter((o) => o.stage === st.stage || o.state === 'active')
    .map((o) => {
      if (o.stage !== st.stage) return o;
      log.push({ kind: 'objective', text: `${t.completes ? 'Completed' : 'Failed'}: ${o.text}` });
      return { ...o, state };
    });
  const next: SimState = { ...st, objectives, messages: [], taken: [...st.taken, t.id], log: [...st.log, ...log] };
  if (t.to === 'victory' || t.to === 'defeat') {
    return { ...next, stage: null, result: t.to, log: [...next.log, { kind: 'end', text: t.to === 'victory' ? 'Victory' : 'Defeat' }] };
  }
  return enter(g, next, t.to);
}
