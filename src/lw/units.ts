import type { MapEntity } from '../vmf/map.ts';
import { UNIT_CATALOG, type CatalogUnit } from './unitCatalog.ts';

export type Faction = CatalogUnit['faction'];

export const FACTIONS: { id: Faction; label: string }[] = [
  { id: 'combine', label: 'Combine' }, { id: 'rebels', label: 'Rebels' }, { id: 'citizens', label: 'Citizens' },
  { id: 'zombies', label: 'Zombies' }, { id: 'antlions', label: 'Antlions' }, { id: 'mission', label: 'Mission' },
  { id: 'other', label: 'Other' },
];

/** A unit type the kits can place: a catalog entry plus the id kit settings store. */
export interface UnitType extends CatalogUnit {
  id: string;
}

/**
 * Ids of the first, hand-kept kit list, still used by the POI catalogue and saved kit settings.
 * Every other unit's id is its unittype.
 */
const LEGACY_IDS: Record<string, string> = {
  unit_zombie: 'zombie', unit_fastzombie: 'fastzombie', unit_poisonzombie: 'poisonzombie', unit_zombine: 'zombine',
  unit_headcrab: 'headcrab', unit_combine: 'combine', unit_combine_sg: 'combine_sg', unit_combine_elite: 'combine_elite',
  unit_metropolice_smg1: 'metropolice', unit_rebel: 'rebel', unit_rebel_sg: 'rebel_sg', unit_rebel_ar2: 'rebel_ar2',
  unit_rebel_medic: 'rebel_medic', unit_rebel_rpg: 'rebel_rpg',
};

/** Every unit type of the game (see scripts/gen-unit-catalog.py), Combine first. */
export const UNITS: UnitType[] = UNIT_CATALOG.map((u) => ({ ...u, id: LEGACY_IDS[u.unittype] ?? u.unittype }));

const byId = new Map(UNITS.map((u) => [u.id, u]));
const byType = new Map(UNITS.map((u) => [u.unittype.toLowerCase(), u]));

/** A unit by kit id or by unittype. */
export function findUnit(id: string): UnitType | undefined {
  return byId.get(id) ?? byType.get(id.toLowerCase());
}

/**
 * The unit type an entity spawns as: its `unittype` key, else the class's own unittype (an entity
 * without the key uses the FGD default, which is the class name), else the first type of that class.
 * A custom unittype the catalog does not know falls back to the class too.
 */
export function unitForEntity(e: MapEntity): UnitType | undefined {
  const cls = e.classname.toLowerCase();
  if (!cls.startsWith('unit_') || cls === 'unit_maker') return undefined;
  const t = e.get('unittype');
  const u = t ? byType.get(t.toLowerCase()) : undefined;
  // The game switches the unit info (and model) by the unittype key, whatever the class.
  if (u) return u;
  return byType.get(cls) ?? UNITS.find((x) => x.cls === cls && !x.variant) ?? UNITS.find((x) => x.cls === cls);
}

/** Grid spacing big units need so they do not spawn inside each other (from the unit's hull). */
export function hullSpacing(u: UnitType): number {
  switch (u.hull) {
    case 'HULL_LARGE_CENTERED': return 320;
    case 'HULL_LARGE': return 160;
    case 'HULL_MEDIUM': case 'HULL_MEDIUM_TALL': return 96;
    default: return 0;
  }
}

/** Short searchable text for a unit: label, unittype and class. */
export function unitSearchText(u: UnitType): string {
  return `${u.label} ${u.unittype} ${u.cls} ${u.faction}`.toLowerCase();
}

/** One entry of a mixed squad: unit id, count and an optional custom unittype. */
export interface SquadEntry {
  unit: string;
  count: number;
  unittype: string;
}

/** Squads are stored as one kit setting string: `unit_metropolice_riot:1, unit_metropolice:2:sp_custom`. */
export function parseSquad(s: string): SquadEntry[] {
  return s.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [unit, count, unittype] = part.split(':').map((x) => x.trim());
    return { unit, count: Math.max(0, parseInt(count ?? '1', 10) || 0), unittype: unittype ?? '' };
  }).filter((e) => e.unit);
}

export function formatSquad(entries: SquadEntry[]): string {
  return entries.map((e) => `${e.unit}:${e.count}${e.unittype ? `:${e.unittype}` : ''}`).join(', ');
}
