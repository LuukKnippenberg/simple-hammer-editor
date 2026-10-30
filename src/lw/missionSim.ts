import { describeCondition, type MissionGraph, type Transition } from './mission.ts';

/**
 * Steps through a mission flowchart the way the built entities play it: entering a stage shows its
 * messages, makes its objectives active, fires its actions and starts its timers; taking a transition
 * completes or fails the objectives and moves on. The editor plays it in the flowchart dialog.
 */

export type ObjectiveState = 'active' | 'completed' | 'failed';

export interface SimObjective { key: string; text: string; stage: string; state: ObjectiveState }

export interface SimEvent { kind: 'stage' | 'message' | 'objective' | 'action' | 'timer' | 'transition' | 'end'; text: string }

export interface SimState {
  /** The running stage, or null once the mission has ended. */
  stage: string | null;
  result: 'victory' | 'defeat' | null;
  /** Messages of the running stage still to be read (the first is on screen). */
  messages: string[];
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
  const messages = s.messages.filter((m) => m.trim());
  for (const m of messages) log.push({ kind: 'message', text: m });
  const objectives = s.objectives.filter((o) => o.text.trim()).map((o): SimObjective => ({ key: `${s.id}/${o.id}`, text: o.text, stage: s.id, state: 'active' }));
  for (const o of objectives) log.push({ kind: 'objective', text: `New objective: ${o.text}` });
  for (const a of s.actions ?? []) if (a.target.trim()) log.push({ kind: 'action', text: `${a.target}.${a.input}${a.param ? `(${a.param})` : ''}${a.delay ? ` after ${a.delay} s` : ''}` });
  for (const t of s.transitions) if (t.condition.kind === 'survive') log.push({ kind: 'timer', text: `Timer starts: ${describeCondition(t.condition)}` });
  return {
    ...st,
    stage: s.id,
    messages,
    objectives: [...st.objectives, ...objectives],
    path: [...st.path, s.id],
    log: [...st.log, ...log],
  };
}

export function simStart(g: MissionGraph): SimState {
  const st: SimState = { stage: null, result: null, messages: [], objectives: [], path: [], taken: [], log: [] };
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

/** The condition of `transitionId` is met: the stage ends and the mission moves on. */
export function simTake(g: MissionGraph, st: SimState, transitionId: string): SimState {
  const t = simWaiting(g, st).find((x) => x.id === transitionId);
  if (!t || !st.stage) return st;
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
