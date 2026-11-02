# Simple interior buildings

Enterable, roofless "cutaway" houses: hollow walls cut off flat at one height, rooms with doorways, furniture and
lights, sometimes stairs to a partial upper floor. Units walk into them and stay visible from the RTS camera.

They come from the **Simple interior building** generator (Generate menu, key 3), from the building generator's
**Interiors** option, and from points of interest that contain a house (gas station kiosk, farmhouse, chapel, beach
huts, lighthouse keeper's house) through `interiorHouse()` in `src/gen/interiorHouse.ts`. For buildings made of
typed rooms (a train station, a customs house) see [rooms.md](rooms.md). Design notes:
[interior-buildings-plan.md](../interior-buildings-plan.md).

## Floor plan

`src/gen/interiorPlan.ts` turns a footprint into a plan (data only):

- **Rooms**: the footprint is rasterised on a 64 grid, cut into rectangles through its inner corners, and each
  rectangle is split along its longer side into rooms of at least 128 × 128 (192 with wide doors).
- **Walls**: exterior walls 16 thick, partitions 8 thick. Overlaps are resolved so wall boxes never intersect, and
  pieces are split wherever the room on either side changes, so each face looks into exactly one room.
- **Openings**: entrances first (a second one for houses over 384 long), then a spanning tree of inner doors so
  every room is reachable, plus a few extra doors. Doors are 64 or 96 wide (128 with wide doors). Windows (64 or
  96, sill 40, lintel 96) go on outside walls every 128 to 192 units. Walls against a neighbour or a courtyard
  wall get no entrance.
- **Room types**: a hall or living room at the front door, a kitchen next to it, the bath next to the kitchen,
  then bedrooms and storage; workshops get a workshop and storage rooms.
- **Lanes** (48 wide, from each door and the stairs to the middle of the room), **door zones** (64 deep on both
  sides of every doorway) and a **porch** in front of the main door are kept free of furniture.

## Shell

`src/gen/interiorShell.ts` builds the plan:

- Walls are split round their openings into convex boxes and stop flat at the **cut height** (default 112; 96 to 128
  work). The top of every wall carries the **cap** material, world aligned, so from above the house reads as a
  bright outline of its floor plan.
- The outer face gets the house's outside finish, inner faces their room's finish (tiles in kitchens and baths,
  wallpaper or plaster elsewhere). Textures are 0.25 scale with one 128-unit tile per storey.
- Floor slabs are world brushes, one per room, with their top 8 above the ground (a step for units) and sunk 32
  into it, so houses sit on uneven terrain. Walls and the porch are `func_detail`, which still blocks units and
  the navmesh.
- Windows are open, backed with a black panel, or boarded, per house.

| Style | Outside | Inside | Floors | Windows |
|---|---|---|---|---|
| Plaster farmhouse | cream, yellow and grey plaster | wallpapers, white tiles | wood planks, tiled kitchens | black or open |
| Wooden shack | weathered white, red and grey siding | plank walls | worn planks | boarded or open |
| Brick cottage | red and brown brick | plaster and wallpaper, tiles | wood, tiles | black or boarded |
| Concrete outbuilding | concrete | concrete block | concrete | open |
| Corrugated slum shack | rusty, red, yellow and grey corrugated metal | planks | planks, concrete | open or boarded |

## Furniture, lights and grime

`src/gen/interiorDressing.ts`, with **Furnish** (none, sparse, full), **Lights** and **Weathering** options:

- Furniture comes from a table of the game's models with bounds measured from the MDL hulls. Models with a static
  version are `prop_static`; tables and chairs become `prop_dynamic`.
- Kitchens get a stove, fridge, sink and table; living rooms a couch, heater, table and chair; bedrooms a bed and
  boxes; baths a tub, toilet and sink; storage rooms and workshops crates, drums, a desk or bench.
- Wall items stand against a wall facing into the room. Nothing goes on a lane, in a door zone, over the stairs,
  on another prop, in front of a window (when taller than 36) or above the cut walls, so every room stays walkable.
- Three rooms in four get a caged wall lamp with a warm `light` in front of it; the rest stay dark.
- Grime: blood, burns, rubble and stain decals on floors, stains, posters and graffiti on inner walls, and plaster
  debris when weathering is high.

## Second storey

With two storeys, an upper floor covers one end of the house (a third to half of it), so the rooms below the open
part stay visible from above:

- The slab is 8 thick with its top at 136 (120 clear below, enough for every hull), with a plaster ceiling and a
  see-through railing along its open edge.
- A straight flight of 8 steps (16 rise, 24 tread, 96 wide, 128 with wide doors) runs along an outside wall up to
  the slab.
- A `TOOLS/TOOLSNPCCLIP` ramp lies on the step nosings (128 rise over 192 run, 34°), so units and the navmesh see
  one smooth slope while players and the camera don't. Recast connects both floors through it.

## In the building generator

`BuildingOptions.interiors` (none, some, all; the default comes from the architecture, which is none for the city
architectures) plus **interior style**, **cut height**, **furnish**, **lights** and **wide doors**:

- Lots of 1 to 2 floors whose wings are axis-aligned rectangles, and the sheds in yards and courtyards, can become
  enterable. The two wings of an L-shaped lot become one L-shaped house when it fits in 640 × 640. A single lot
  longer than 640 gets a 384 to 576 house at the street and the rest becomes its yard.
- An enterable house skips the roof, tower, cornice, oriels, balconies, awnings, wall clutter and the stone base
  course (which would rise above the 18-unit climb and close the doorways). It keeps the weathering and gets eave
  stubs in the cap material at Medium detail and up.
- **Generate map** has an Interiors setting and a **Houses (enterable)** cell kind: village houses in the
  countryside, slum shacks in the city.
