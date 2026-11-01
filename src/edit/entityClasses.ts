/** How entity classes are grouped, coloured, named and searched in the palette, the Entity tool and the inspector. */

export interface ClassInfo {
  name: string;
  /** PointClass, SolidClass, NPCClass, ... (from the FGD). */
  type: string;
  description: string;
}

export interface ClassGroup {
  id: string;
  label: string;
  color: string;
  /** The class patterns in the group, shown next to a collapsed group. */
  pattern: string;
}

export const CLASS_GROUPS: ClassGroup[] = [
  { id: 'wars', label: 'Lambda Wars', color: '#f0b555', pattern: 'wars, control points, scrap' },
  { id: 'props', label: 'Props', color: '#a8977a', pattern: 'prop_*' },
  { id: 'units', label: 'Units', color: '#e8796a', pattern: 'unit_*, npc_*' },
  { id: 'lights', label: 'Lights', color: '#f2d14b', pattern: 'light_*' },
  { id: 'env', label: 'Environment', color: '#8fb8d8', pattern: 'env_*' },
  { id: 'logic', label: 'Logic', color: '#b48ce0', pattern: 'logic_*, math_*' },
  { id: 'triggers', label: 'Triggers', color: '#e86fa8', pattern: 'trigger_*' },
  { id: 'info', label: 'Info & targets', color: '#a3a7a9', pattern: 'info_*, path_*' },
  { id: 'brush', label: 'Brush entities', color: '#c98a3a', pattern: 'func_*' },
  { id: 'other', label: 'Other', color: '#646b74', pattern: 'everything else' },
];

/** The entities a Lambda Wars map needs most, with a short name and explanation each. */
export const FEATURED: { cls: string; label: string; hint: string }[] = [
  { cls: 'info_start_wars', label: 'Player start', hint: 'Base location of one player. Place one per player slot.' },
  { cls: 'control_point', label: 'Control point', hint: 'Capturable flag; a capture area trigger is added around it.' },
  { cls: 'scrap_marker', label: 'Scrap (large)', hint: 'Resource node rebels harvest.' },
  { cls: 'scrap_marker_small', label: 'Scrap (small)', hint: 'Small resource node.' },
  { cls: 'info_player_wars', label: 'Spectator spawn', hint: 'Where the player camera spawns.' },
  { cls: 'prop_static', label: 'Static prop', hint: 'Decoration model; vbsp bakes it into the map.' },
  { cls: 'prop_dynamic', label: 'Dynamic prop', hint: 'Model that can animate or be toggled.' },
  { cls: 'light_environment', label: 'Sun light', hint: 'One per map: sun and ambient light.' },
  { cls: 'env_fog_controller', label: 'Fog', hint: 'Map fog colour and distances.' },
  { cls: 'light', label: 'Point light', hint: 'Local light source.' },
  { cls: 'light_spot', label: 'Spot light', hint: 'Cone light; aim it with the angles.' },
  { cls: 'light_deferred', label: 'Dynamic light', hint: 'Lambda Wars deferred light (radius, colour, optional shadows).' },
];

const FEATURED_BY = new Map(FEATURED.map((f) => [f.cls, f]));

export function classGroup(c: Pick<ClassInfo, 'name' | 'type'>): ClassGroup {
  const n = c.name.toLowerCase();
  const id =
    /^solidclass$/i.test(c.type) ? (/^trigger_/.test(n) ? 'triggers' : 'brush')
    : /wars|^control_point|^scrap_|^overrun_/.test(n) ? 'wars'
    : /^prop_/.test(n) ? 'props'
    : /^npcclass$/i.test(c.type) || /^(unit_|npc_)/.test(n) ? 'units'
    : /^(light|point_spotlight|env_projectedtexture|env_lightglow|env_sun$)/.test(n) ? 'lights'
    : /^(env_|shadow_control|color_correction|postprocess_controller|sky_camera|fog_volume|water_lod)/.test(n) ? 'env'
    : /^(logic_|math_|filter_|game_|point_template|ai_)/.test(n) || /^filterclass$/i.test(c.type) ? 'logic'
    : /^trigger_/.test(n) ? 'triggers'
    : /^(info_|path_|keyframe_|move_|point_)/.test(n) ? 'info'
    : 'other';
  return CLASS_GROUPS.find((g) => g.id === id)!;
}

/** A readable name: the featured label, or the class name itself. */
export function classLabel(name: string): string {
  return FEATURED_BY.get(name.toLowerCase())?.label ?? name;
}

/** One line on what the class is: the featured hint, or the FGD description's first sentence. */
export function classHint(c: ClassInfo | undefined, name = c?.name ?? ''): string {
  const f = FEATURED_BY.get(name.toLowerCase());
  if (f) return f.hint;
  const d = (c?.description ?? '').replace(/\s+/g, ' ').trim();
  const first = d.match(/^.{0,140}?[.!?](\s|$)/)?.[0] ?? d.slice(0, 140);
  return first.trim();
}

/** Point classes can be placed with a click; brush classes need brushes. */
export function isPointClass(c: Pick<ClassInfo, 'type'>): boolean {
  return !/^solidclass$/i.test(c.type);
}

/**
 * Classes matching a search, best first: name starts with the query, then a word of the name does
 * (`fog` finds env_fog_controller), then the name contains it, then the description does.
 */
export function searchClasses<T extends ClassInfo>(classes: T[], query: string, limit = 40): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored: { c: T; score: number }[] = [];
  for (const c of classes) {
    const n = c.name.toLowerCase();
    const label = classLabel(c.name).toLowerCase();
    const d = c.description.toLowerCase();
    let score = 0;
    if (n.startsWith(q) || label.startsWith(q)) score = 4;
    else if (n.split('_').some((p) => p.startsWith(q)) || label.split(' ').some((p) => p.startsWith(q))) score = 3;
    else if (words.every((w) => n.includes(w) || label.includes(w))) score = 2;
    else if (words.every((w) => d.includes(w))) score = 1;
    if (score) scored.push({ c, score: score + (FEATURED_BY.has(n) ? 0.5 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.c.name.length - b.c.name.length || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, limit).map((s) => s.c);
}

/** Classes a class can be changed into without losing its shape: same family first, then the rest of the same kind. */
export function classChoices<T extends ClassInfo>(classes: T[], from: ClassInfo, query: string): { family: T[]; other: T[] } {
  const point = isPointClass(from);
  const pool = classes.filter((c) => isPointClass(c) === point && c.name.toLowerCase() !== from.name.toLowerCase());
  const list = query.trim() ? searchClasses(pool, query, 60) : pool.slice().sort((a, b) => a.name.localeCompare(b.name));
  const fam = classGroup(from).id;
  const prefix = from.name.toLowerCase().split('_')[0] + '_';
  const same = (c: T) => c.name.toLowerCase().startsWith(prefix) || classGroup(c).id === fam;
  return { family: list.filter(same), other: list.filter((c) => !same(c)) };
}
