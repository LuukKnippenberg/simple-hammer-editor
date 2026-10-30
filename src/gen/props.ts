/**
 * Mesh bounds of ground props whose origin is not at their base, measured from the .mdl files, so
 * generators can stand them on the ground and keep them clear of kerbs: [minX, minY, minZ, maxX, maxY, maxZ].
 * The car models point along +x.
 */
export const PROP_BOUNDS: Record<string, readonly [number, number, number, number, number, number]> = {
  'models/props_vehicles/car002a.mdl': [-79, -38, -24, 73, 37, 33],
  'models/props_vehicles/car003a.mdl': [-101, -44, -23, 80, 38, 38],
  'models/props_vehicles/car004a.mdl': [-113, -43, -25, 89, 42, 35],
  'models/props_vehicles/car005a.mdl': [-106, -44, -26, 81, 39, 39],
  'models/props_vehicles/van001a.mdl': [-128, -63, -34, 99, 48, 49],
  'models/props_vehicles/truck003a.mdl': [-138, -61, -58, 155, 59, 71],
  'models/props_c17/fence01a.mdl': [-2, -67, -54, 2, 67, 54],
};

/** Origin height that stands a listed model on the ground at `z`, its lowest point `sink` units into it. */
export function standZ(model: string, z: number, sink = 1): number {
  const b = PROP_BOUNDS[model];
  return Math.round(b ? z - b[2] - sink : z);
}
