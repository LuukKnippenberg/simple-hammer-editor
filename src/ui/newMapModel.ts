import { emptySketch, SKETCH_CELL, type Sketch, type SketchMarker } from '../gen/sketch.ts';
import { BASICS, buildBasics, buildTemplate, templateInfo, type BuiltTemplate, type MapSize, type TemplateKind, type TemplateOptions, type TemplatePlan } from '../lw/mapTemplates.ts';

/**
 * The New map wizard's choices, copy and rules, without the DOM (newMapDialog.ts draws them). The maps themselves
 * come from mapTemplates.ts: "Template layout" builds exactly what the dialog built before the wizard.
 */

export type StartFrom = 'template' | 'sketch' | 'basics';

export interface Card<T> { value: T; title: string; text: string; note?: string }

export const MODE_CARDS: Card<TemplateKind>[] = [
  { value: 'annihilation', title: 'Annihilation', text: 'Competitive skirmish: destroy every enemy base.', note: 'hlw_ · 2, 4, 6 or 8 players' },
  { value: 'overrun', title: 'Overrun', text: 'Co-op defence: hold the centre against growing waves.', note: 'or_ · 1–4 players, wave type' },
  { value: 'mission', title: 'Singleplayer mission', text: 'A story mission with stages and objectives.', note: 'sp_ · your faction' },
  { value: 'empty', title: 'Empty', text: 'Just ground, sky and sun. No mode yet.', note: 'any name' },
];

export const SIZE_CARDS: Card<MapSize>[] = [
  { value: 'small', title: 'Small', note: '4096 u', text: 'Quick 1v1 games. Good for 2 players.' },
  { value: 'medium', title: 'Medium', note: '6144 u', text: '2v2 or a roomy 1v1.' },
  { value: 'large', title: 'Large', note: '8192 u', text: '6 to 8 players, long games.' },
];

export const START_CARDS: Card<StartFrom>[] = [
  { value: 'template', title: 'Template layout', text: 'Bases, resources and boundary placed for you, as in the preview.' },
  { value: 'sketch', title: 'Sketch it', text: 'Paint the layout on a grid with height levels, then generate buildings and streets.' },
  { value: 'basics', title: 'Empty ground', text: 'Only the basics from the preview’s last line. You place the rest.' },
];

export const PLAYERS_HINT = 'Overrun: 1–4 · Mission: you alone';
export const GROUND_HINT = 'A blend you can paint over with the Ground tool';

/** The map name prefix the game lists each mode by (see mapTemplates.ts); Empty has none. */
const PREFIXES: Record<TemplateKind, string> = { annihilation: 'hlw_', overrun: 'or_', mission: 'sp_', empty: '' };
export const prefixFor = (kind: TemplateKind): string => PREFIXES[kind];

/** What the first name check says the prefix does. */
const PREFIX_USES: Record<TemplateKind, string> = {
  annihilation: 'hlw_ prefix: listed in the multiplayer lobby',
  overrun: 'or_ prefix: listed in the multiplayer lobby',
  mission: 'sp_ prefix: compiled as a singleplayer mission',
  empty: 'no prefix: any name until you pick a mode',
};

/** The player count closest to `wanted` that the mode offers (the lower one on a tie); 1 when it offers none. */
export function validPlayers(kind: TemplateKind, wanted: number): number {
  const offered = templateInfo(kind).players;
  if (!offered.length) return templateInfo(kind).defaultPlayers;
  return offered.reduce((best, n) => (Math.abs(n - wanted) < Math.abs(best - wanted) ? n : best));
}

/** The name field without the prefix chip: a pasted prefix or ".vmf" is dropped, the rest kept as typed. */
export function nameRest(kind: TemplateKind, typed: string): string {
  const prefix = prefixFor(kind);
  let rest = typed.trim().replace(/\.vmf$/i, '');
  if (prefix && rest.toLowerCase().startsWith(prefix)) rest = rest.slice(prefix.length);
  return rest;
}

export const fileNameFor = (kind: TemplateKind, rest: string): string => `${prefixFor(kind)}${rest}.vmf`;

export interface NameCheck { text: string; ok: boolean }

/** The three live checks under the name; Create waits until all pass. `existing` holds lowercase maps/ file names. */
export function nameChecks(kind: TemplateKind, rest: string, existing: ReadonlySet<string>): NameCheck[] {
  return [
    { text: PREFIX_USES[kind], ok: true },
    { text: 'lowercase, no spaces', ok: /^[a-z0-9_]+$/.test(rest) },
    { text: 'no map with this name yet', ok: !existing.has(fileNameFor(kind, rest).toLowerCase()) },
  ];
}

/** The mode's default name without its prefix, numbered (_2, _3, ...) past names maps/ already has. */
export function defaultRest(o: TemplateOptions, existing: ReadonlySet<string>): string {
  const base = nameRest(o.kind, templateInfo(o.kind).defaultName(o));
  let rest = base;
  for (let n = 2; existing.has(fileNameFor(o.kind, rest)); n++) rest = `${base}_${n}`;
  return rest;
}

/** The plan the preview draws: nothing but the boundary for "Empty ground". */
export function previewPlan(plan: TemplatePlan, start: StartFrom): TemplatePlan {
  return start === 'basics' ? { ...plan, starts: [], points: [], scrap: [], waves: [], squad: [], goal: null } : plan;
}

/** Whether Create builds only the basics: "Empty ground", and Empty with any start. */
const basicsOnly = (o: TemplateOptions, start: StartFrom): boolean => start === 'basics' || o.kind === 'empty';

/** The "What gets placed" lines. */
export function placedLines(o: TemplateOptions, start: StartFrom): string[] {
  return basicsOnly(o, start) ? [BASICS] : templateInfo(o.kind).places(o);
}

const CHECKLIST_SUBJECTS: Record<TemplateKind, string> = { annihilation: 'Annihilation', overrun: 'Overrun', mission: 'a mission', empty: 'every map' };
export const checklistSentence = (kind: TemplateKind): string =>
  `The map checklist then tracks what ${CHECKLIST_SUBJECTS[kind]} needs, so nothing has to be remembered.`;

/**
 * The map Create builds. "Sketch it" builds the template layout too, so closing the sketch leaves a playable map.
 * Empty is the basics whatever the start (buildTemplate's empty document is the old dialog's).
 */
export function buildNewMap(o: TemplateOptions, start: StartFrom): BuiltTemplate {
  return basicsOnly(o, start) ? buildBasics(o) : buildTemplate(o);
}

/**
 * A sketch the size of the map with the template's starts, requisition points, scrap, wave spawns and Overrun
 * manager as markers, so generating it keeps what the mode needs.
 */
export function sketchFromPlan(o: TemplateOptions, plan: TemplatePlan): Sketch {
  const cells = plan.size / SKETCH_CELL;
  const sketch = emptySketch(cells, cells, 'rural');
  const at = (x: number, y: number) => ({ x: (x + plan.size / 2) / SKETCH_CELL, y: (y + plan.size / 2) / SKETCH_CELL });
  const markers: SketchMarker[] = [
    ...plan.starts.map((s): SketchMarker => o.kind === 'mission'
      ? { kind: 'sp_start', ...at(s.x, s.y), params: { faction: o.faction ?? 'rebels', yaw: s.yaw } }
      : { kind: 'mp_start', ...at(s.x, s.y), params: { yaw: s.yaw, ...(s.team ? { team: s.team } : {}) } }),
    ...plan.points.map((p): SketchMarker => ({ kind: 'capture_point', ...at(p.x, p.y) })),
    ...plan.scrap.map((p): SketchMarker => ({ kind: 'scrap', ...at(p.x, p.y) })),
    ...plan.waves.map((w): SketchMarker => ({ kind: 'wave_spawn', ...at(w.x, w.y), params: { yaw: w.yaw } })),
    // Where the template puts it (mapTemplates.ts).
    ...(o.kind === 'overrun' ? [{ kind: 'overrun_manager', ...at(0, -256), params: { wavetype: o.wavetype ?? 'antlions' } } satisfies SketchMarker] : []),
  ];
  sketch.markers.push(...markers);
  return sketch;
}
