/**
 * Materials for streets: what the carriageway, the gutter strip, the kerb and the pavement are made of. Each part
 * has a list of named choices; a road takes one of each (`RoadMaterials`), or its style's defaults where it doesn't
 * say. The map sketch sets them for all its streets, the road panel per road.
 */

export interface StreetMaterial { id: string; label: string; material: string }

export const CARRIAGEWAYS: StreetMaterial[] = [
  { id: 'asphalt', label: 'Asphalt', material: 'CONCRETE/CONCRETEFLOOR033A' },
  { id: 'asphalt_worn', label: 'Worn asphalt', material: 'CONCRETE/CONCRETEFLOOR033K' },
  { id: 'setts', label: 'Setts', material: 'STONE/STONEFLOOR006B' },
  { id: 'cobbles', label: 'Cobbles', material: 'STONE/STONEFLOOR006A' },
  { id: 'concrete', label: 'Concrete', material: 'CONCRETE/CONCRETEFLOOR013A' },
];

export const PAVEMENTS: StreetMaterial[] = [
  { id: 'concrete', label: 'Concrete', material: 'CONCRETE/CONCRETEFLOOR028A' },
  { id: 'slabs', label: 'Square slabs', material: 'CONCRETE/CONCRETEFLOOR028C' },
  { id: 'large_slabs', label: 'Large slabs', material: 'CONCRETE/CONCRETEFLOOR020A' },
  { id: 'tiles', label: 'Small tiles', material: 'TILE/TILEFLOOR016A' },
  { id: 'bricks', label: 'Bricks', material: 'BRICK/BRICKFLOOR001A' },
  { id: 'cobbles', label: 'Cobbles', material: 'STONE/STONEFLOOR006D' },
];

export const KERBS: StreetMaterial[] = [
  { id: 'concrete', label: 'Concrete', material: 'CONCRETE/CONCRETEFLOOR027A' },
  { id: 'stone', label: 'Stone', material: 'STONE/STONEWALL017A' },
  { id: 'granite', label: 'Granite', material: 'CONCRETE/CONCRETEFLOOR019A' },
];

export const GUTTERS: StreetMaterial[] = [
  { id: 'none', label: 'None', material: '' },
  { id: 'setts', label: 'Setts', material: 'STONE/STONEFLOOR006B' },
  { id: 'cobbles', label: 'Cobbles', material: 'STONE/STONEFLOOR006A' },
  { id: 'concrete', label: 'Concrete', material: 'CONCRETE/CONCRETEFLOOR027A' },
];

/** A road's own choices (ids from the lists above); missing parts keep the style's defaults. */
export interface RoadMaterials {
  carriageway?: string;
  pavement?: string;
  kerb?: string;
  gutter?: string;
  /** Width of the gutter strip along each kerb (default 32 when a gutter is chosen). */
  gutterWidth?: number;
  /** Radius of the kerb at street corners (0: square corners). */
  corner?: number;
}

/** Ready-made sets: the look of a whole street in one choice. */
export const STREET_PRESETS: { id: string; label: string; materials: RoadMaterials }[] = [
  { id: 'classic', label: 'City 17 (asphalt, concrete)', materials: {} },
  { id: 'old_town', label: 'Old town (setts, square slabs, stone gutters)', materials: { carriageway: 'setts', pavement: 'slabs', kerb: 'stone', gutter: 'cobbles', corner: 96 } },
  { id: 'boulevard', label: 'Boulevard (asphalt, large slabs, granite)', materials: { carriageway: 'asphalt_worn', pavement: 'large_slabs', kerb: 'granite', gutter: 'setts', corner: 128 } },
  { id: 'cobbled', label: 'Cobbled lane (cobbles, bricks)', materials: { carriageway: 'cobbles', pavement: 'bricks', kerb: 'stone', corner: 64 } },
];

const find = (list: StreetMaterial[], id: string | undefined) => (id ? list.find((m) => m.id === id) : undefined);
export const carriagewayMaterial = (id?: string) => find(CARRIAGEWAYS, id)?.material;
export const pavementMaterial = (id?: string) => find(PAVEMENTS, id)?.material;
export const kerbMaterial = (id?: string) => find(KERBS, id)?.material;
export const gutterMaterial = (id?: string) => find(GUTTERS, id)?.material || undefined;

/** As `key=value,...` for a road's stored definition. */
export function encodeMaterials(m: RoadMaterials | undefined): string {
  if (!m) return '';
  return Object.entries(m).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`).join(',');
}

export function decodeMaterials(s: string | undefined): RoadMaterials | undefined {
  if (!s) return undefined;
  const out: Record<string, string | number> = {};
  for (const kv of s.split(',')) {
    const [k, v] = kv.split('=');
    if (!k || v === undefined) continue;
    out[k] = k === 'gutterWidth' || k === 'corner' ? Number(v) : v;
  }
  return out as RoadMaterials;
}
