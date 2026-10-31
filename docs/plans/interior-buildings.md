# Advanced interior buildings

A building you can walk into, made of rooms. You give it a footprint and divide it into rooms; each room gets
an interior type (train hall, customs, rations, waiting room, hallway, concourse) and the generator builds the
shell and furnishes every room for its type. The Civil Protection station (`buildStation`) is the hand-made
first version of this; this generalises it.

## What is kept from the station work

- Walls: plain world brushes, cut only for doorways and one window band per outer wall (`src/gen/hall.ts`).
  Window holes per window, a roof resting on the wall tops, or walls flush with neighbours cost more vbsp
  t-junctions than a generated city leaves (see `scripts/tjunc-budget.mjs`).
- Roof: invisible (`TOOLSBLOCKLIGHT` in a func_brush that casts vrad shadows), floating above the walls, open
  over skylights. Nothing hangs under it: from the RTS camera girders and beams only cross the floor as dark
  lines.
- Decoration (pilasters, cornices, plinths, frames) in one func_brush per building: free for vbsp's
  t-junctions. Wear through `src/edit/decalScatter.ts`.
- Light: only lamps you can see, short falloff; sunlight through skylights and window bands.
- The RTS camera looks north-west: relief and posters go on the inner faces of north and west walls.

## Phases

### A1: Model and shell
`src/gen/rooms/` with the data model (`RoomBuildingSpec`: a cell grid and rooms as rectangles of cells, each
with a type; the rooms together are the building's shape, so an L or a T is just rooms placed that way) and the shell generator: walls on every room edge (outer walls where the
edge is on the outline, partitions between rooms), doorways where rooms meet (one per shared edge, or none for
a type that wants to be closed off), street doors on outer walls the spec names, window bands on outer walls,
a floor per room in its type's material, the invisible roof with per-room skylights. Tests for the layout rules.

Done: `model.ts` (`roomLayout`: wall runs on the grid lines, corners kept by the walls along x, doorways and
archways between rooms, street doors, window bands on the north and east walls, floors per room, and issues
for overlapping rooms, doors off the outline and rooms you can't reach), `types.ts` (the room type catalogue)
and `shell.ts` (`roomShell`: walls with per-room inner finishes, the floating roof with skylights per room
type, glass). Room floors come with the furniture in A2 (as POI-kit pads, which overlays stick to).

### A2: Room types
A catalogue of room types, each a dresser that furnishes a room given its rectangle and its doorways (kept
clear): train hall (tracks, platforms and coaches), customs (chain-link cages, gates, a guard booth, Civil
Protection), rations (counter, lanes and walking queues), waiting room (benches facing a Breencast, canteen
tables, payphones), hallway (benches along the walls, lamps) and concourse (pillars, open floor). Tests that
every type stays inside its room and off its doorways.

Done: `dressers.ts` furnishes each room through a POI kit over its floor (props stand on the floor, keep off
each other and off reserved ways; fences come in whole pieces). Doorways are kept clear and joined by walkways
first. The kit is turned per type: the train hall and hallway along their long side, customs and rations with
the main way in on local south. Train hall: platform along the side it is entered from (nobody crosses a
track to reach it), tracks with buffers, coaches, a far platform in a wide hall. Customs: rows of chain-link
cages against the long walls with gates onto a corridor, a scanner line and a guard booth. `build.ts` puts
walls in the world, floors and fittings in one func_detail, roof and glass in func_brushes. `presets.ts`:
Train station, Customs house, Ration centre. `scripts/rooms-demo.mjs` builds all three in the editor.

### A3: Relief, lamps and wear per room
Pilasters, plinth, ledge and cornice on the camera-facing walls of each room, lanterns on them, lamps over the
furniture, and decals per type (litter where people wait, papers by the ration lanes, stripes on platforms).

Done: `relief.ts` finds every room's north and west faces that are wall all along (`cameraFaces`), puts a
plinth, ledge, cornice and pilasters on them (pilasters stop under window bands, nothing crosses a doorway),
lanterns with lights on every other pilaster, posters, propaganda and stains as overlays on the wall brushes.
The dressers hang lamps over the furniture and put floor overlays down per type (hazard stripes on platform
edges, boot prints into customs, ration papers in the lanes, litter by the benches); concourse pillars get
bases, capitals and a lantern. Street doors keep 40 units from the room's corners.

### A4: Storage and regeneration
The spec is stored in the map like a block of buildings (a key on the building's func_detail, with its members
listed), so the editor can rebuild a building after its rooms change, and a handle to move it.

### A5: Editor
An Interior building dialog: footprint size, a room grid to paint rooms on, a type per room, doors, presets
(Train station, Customs house, Ration centre), Generate and Regenerate.

### A6: Demo and docs
A demo station built from a preset with every room type, compiled and checked in the game with screenshots,
and a README section.
