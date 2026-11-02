// Characterization test for the KISS refactor (research/editor-kiss-plan.md). Delete after K10.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { roomLayout, type RoomBuildingSpec, type RoomSpec } from '../src/gen/rooms/model.ts';
import { ROOM_PRESETS, presetSpec } from '../src/gen/rooms/presets.ts';

const room = (id: string, type: string, x0: number, y0: number, x1: number, y1: number): RoomSpec => ({ id, type, cells: { x0, y0, x1, y1 } });

/** The station from tests/roomBuilding.test.ts. */
const station = (patch: Partial<RoomBuildingSpec> = {}): RoomBuildingSpec => ({
  uid: 't', seed: 1, origin: { x: 0, y: 0, z: 0 }, cell: 128, height: 432,
  rooms: [room('hall', 'trainHall', 0, 0, 12, 6), room('conc', 'concourse', 0, 6, 8, 12), room('wait', 'waiting', 8, 6, 12, 12)],
  doors: [{ x: 0, y: 8, side: 'w', width: 2 }],
  links: [], bands: ['n', 'e'],
  ...patch,
});

/** The rooms dialog's fallback when the preset doesn't fit the brush: no rooms, no doors. */
const emptied = (): RoomBuildingSpec => ({ ...presetSpec('station', 0, 0, 0, 'e'), rooms: [], doors: [] });

const cases: Record<string, () => RoomBuildingSpec> = {
  station: () => station(),
  stationOpenLink: () => station({ links: [{ a: 'conc', b: 'wait', kind: 'open' }] }),
  stationTwoDoors: () => station({ doors: [{ x: 0, y: 8, side: 'w', width: 2 }, { x: 2, y: 11, side: 'n', width: 2 }] }),
  overlap: () => station({ rooms: [room('a', 'waiting', 0, 0, 4, 4), room('b', 'hallway', 3, 0, 6, 4)], doors: [{ x: 0, y: 1, side: 'w', width: 1 }] }),
  doorInside: () => station({ doors: [{ x: 7, y: 6, side: 'e', width: 1 }] }),
  shut: () => station({ links: [{ a: 'wait', b: 'conc', kind: 'wall' }, { a: 'wait', b: 'hall', kind: 'wall' }] }),
  noDoors: () => station({ doors: [] }),
  // Branches the room tests don't reach: no bands under 320 high, a room off the grid, a door too close to a corner,
  // rooms that share too little wall for a door.
  low: () => station({ height: 288 }),
  offGrid: () => station({ rooms: [...station().rooms, room('x', 'waiting', -1, 0, 2, 2)] }),
  cornerDoor: () => station({ doors: [{ x: 11, y: 0, side: 'e', width: 1 }, { x: 0, y: 8, side: 'w', width: 2 }] }),
  thinShare: () => station({ rooms: [room('a', 'waiting', 0, 0, 4, 4), room('b', 'waiting', 4, 3, 8, 6)], doors: [{ x: 0, y: 1, side: 'w', width: 1 }] }),
  // tests/roomStore.test.ts and the rooms dialog.
  storedStation: () => {
    const spec = presetSpec('station', -512, 256, 8, 'abc', 42);
    spec.links.push({ a: 'concourse', b: 'waiting', kind: 'open' });
    return spec;
  },
  ...Object.fromEntries(ROOM_PRESETS.map((preset) => [`preset ${preset.id}`, () => presetSpec(preset.id, 0, 0, 0, 'p', 5)])),
  dialogEmpty: emptied,
};

const golden: Record<string, string> = {
  station: '0d654f4ecd578c24af11aae5bbf85e6a012f33a4',
  stationOpenLink: '7bb8fe39a0c17ec55baef643a1e7883c1f825503',
  stationTwoDoors: '4860ba24d780e53d379dc9c8b4cae3340ede5116',
  overlap: '2bce833a080a2938861f7b5b71631932e5cfa001',
  doorInside: '256106300ca71fe00b940e3a9426f04b5d474a12',
  shut: '6faf0dbfbc7559dc5eaf7a94c09fa7c2e2bad052',
  noDoors: '5dd14abe567d805d11eadf6b3f7d3f14da9d038e',
  low: '686a364f7fd941ef3f2e4f40321661dd78ed9d88',
  offGrid: 'bd0830faaa36e1e1e4f8076d30d604f080a1b0e5',
  cornerDoor: '200e33d4d61809d0b3a1e539960d2576ed6f6d3f',
  thinShare: '2c67ed738165cf9c3e8da020487469c29de4408b',
  storedStation: 'c00c8299b2fa7bd4bdc52dcbf41bcedbf411d68c',
  'preset station': '4e89933f69ba195041122d87b2f57177668292a3',
  'preset customs': '6eed540fa7eb8165e036740f1cecd53e71c5e511',
  'preset rations': '8488572ee0f04b6b9d74967f20dd8331a36234bc',
  dialogEmpty: '646705df3e10529a7c1ca3ada439d87669b0beb8',
};

describe('roomLayout keeps its output (characterization)', () => {
  it.each(Object.keys(cases))('%s', (name) => {
    const hash = createHash('sha1').update(JSON.stringify(roomLayout(cases[name]()))).digest('hex');
    expect(hash).toBe(golden[name]);
  });
});
