/**
 * Room types for interior buildings: what a room is for decides its floor, its walls, how it opens onto the
 * rooms next to it, whether sunlight falls in through skylights, and (`dress`, see dressers.ts) what is put
 * in it.
 */

/** How two rooms meet: a closed wall, one doorway, a row of archways, or no wall at all. */
export type LinkKind = 'wall' | 'door' | 'arches' | 'open';

/** Openness of a link, for picking the less open of two rooms' preferences. */
export const LINK_RANK: Record<LinkKind, number> = { wall: 0, door: 1, arches: 2, open: 3 };

export type Skylights = 'strips' | 'centre' | 'none';

export interface RoomTypeInfo {
  id: string;
  label: string;
  hint: string;
  /** Colour of the room in the editor's room grid. */
  color: string;
  floor: string;
  /** Inner finish of the room's walls. */
  walls: string;
  /** How the room prefers to open onto its neighbours; two rooms meet with the less open of their two. */
  link: LinkKind;
  /** Width of its doorways. */
  doorWidth: number;
  skylights: Skylights;
  /** Smallest size (cells along the short and the long side) the room's furniture is made for. */
  min: [number, number];
}

export const ROOM_TYPES: RoomTypeInfo[] = [
  {
    id: 'trainHall', label: 'Train hall', hint: 'Tracks along the long side with a platform between them, and trains standing at it',
    color: '#8a6d4b', floor: 'CONCRETE/CONCRETEFLOOR028A', walls: 'STONE/STONEWALL050A', link: 'arches', doorWidth: 256, skylights: 'strips', min: [6, 10],
  },
  {
    id: 'concourse', label: 'Concourse', hint: 'A tall open hall between the platforms and the street: pillars, lanterns, a Breencast',
    color: '#c9a66b', floor: 'TILE/TILEFLOOR010A', walls: 'STONE/STONEWALL050A', link: 'arches', doorWidth: 256, skylights: 'strips', min: [4, 6],
  },
  {
    id: 'customs', label: 'Customs', hint: 'Chain-link cages with gates, a guard booth, Civil Protection at the scanners',
    color: '#5f8f9e', floor: 'TILE/TILEFLOOR012A', walls: 'STONE/STONEWALL050A', link: 'door', doorWidth: 192, skylights: 'centre', min: [4, 5],
  },
  {
    id: 'rations', label: 'Rations', hint: 'Lanes between railings up to a counter, crates of rations, a dispenser',
    color: '#b85c4a', floor: 'CONCRETE/CONCRETEFLOOR001A', walls: 'CONCRETE/CONCRETEWALL001A', link: 'door', doorWidth: 224, skylights: 'centre', min: [5, 6],
  },
  {
    id: 'waiting', label: 'Waiting room', hint: 'Rows of benches facing a Breencast, canteen tables, payphones',
    color: '#7f9a5a', floor: 'TILE/TILEFLOOR010A', walls: 'PLASTER/PLASTERWALL003A', link: 'door', doorWidth: 192, skylights: 'none', min: [3, 4],
  },
  {
    id: 'hallway', label: 'Hallway', hint: 'A corridor: benches along the walls, lamps, bins',
    color: '#9a8fb0', floor: 'TILE/TILEFLOOR001A', walls: 'PLASTER/PLASTERWALL003A', link: 'door', doorWidth: 160, skylights: 'none', min: [2, 3],
  },
];

const byId = new Map(ROOM_TYPES.map((t) => [t.id, t]));

/** The room type with this id (a waiting room for an unknown id, so an old map still builds). */
export function roomType(id: string): RoomTypeInfo {
  return byId.get(id) ?? byId.get('waiting')!;
}
