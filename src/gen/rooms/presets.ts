import type { RoomBuildingSpec, RoomSpec, Side, StreetDoor } from './model.ts';

/** Ready-made buildings to start from (cells of 128). */
export interface RoomPreset {
  id: string;
  label: string;
  hint: string;
  rooms: RoomSpec[];
  doors: StreetDoor[];
  height: number;
}

const room = (id: string, type: string, x0: number, y0: number, x1: number, y1: number, name?: string): RoomSpec => ({ id, type, cells: { x0, y0, x1, y1 }, name });
const door = (x: number, y: number, side: Side, width = 2): StreetDoor => ({ x, y, side, width });

export const ROOM_PRESETS: RoomPreset[] = [
  {
    id: 'station', label: 'Train station', height: 432,
    hint: 'Trains arrive in the hall along the south; travellers go through customs into the concourse, past the waiting room and the ration hall',
    rooms: [
      room('hall', 'trainHall', 0, 0, 24, 8, 'Train hall'),
      room('concourse', 'concourse', 0, 8, 12, 16, 'Concourse'),
      room('customs', 'customs', 12, 8, 24, 13, 'Customs'),
      room('waiting', 'waiting', 12, 13, 24, 16, 'Waiting room'),
      room('hallway', 'hallway', 0, 16, 24, 18, 'Hallway'),
      room('rations', 'rations', 0, 18, 9, 24, 'Rations'),
    ],
    doors: [door(0, 11, 'w'), door(23, 16, 'e'), door(3, 23, 'n')],
  },
  {
    id: 'customs', label: 'Customs house', height: 352,
    hint: 'A checkpoint building: in from the street through a hallway, customs, a waiting room',
    rooms: [
      room('hallway', 'hallway', 0, 0, 3, 10, 'Hallway'),
      room('customs', 'customs', 3, 0, 11, 6, 'Customs'),
      room('waiting', 'waiting', 3, 6, 11, 10, 'Waiting room'),
    ],
    doors: [door(0, 1, 'w'), door(10, 0, 's', 1)],
  },
  {
    id: 'rations', label: 'Ration centre', height: 384,
    hint: 'A ration hall with a waiting room and a hallway along the street',
    rooms: [
      room('hallway', 'hallway', 0, 0, 12, 2, 'Hallway'),
      room('rations', 'rations', 0, 2, 7, 9, 'Rations'),
      room('waiting', 'waiting', 7, 2, 12, 9, 'Waiting room'),
    ],
    doors: [door(1, 0, 's'), door(9, 0, 's')],
  },
];

/** A building from a preset at a world position (the grid's south-west corner) and ground height. */
export function presetSpec(id: string, x: number, y: number, z: number, uid: string, seed = 1): RoomBuildingSpec {
  const p = ROOM_PRESETS.find((q) => q.id === id) ?? ROOM_PRESETS[0];
  return {
    uid, seed, origin: { x, y, z }, cell: 128, height: p.height,
    rooms: p.rooms.map((r) => ({ ...r, cells: { ...r.cells } })), doors: p.doors.map((d) => ({ ...d })), links: [], bands: ['n', 'e'],
  };
}
