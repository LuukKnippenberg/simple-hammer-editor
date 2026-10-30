# Plan: open-top interior buildings in the building generator

A brief for implementing **enterable, roofless "cutaway" houses** in the simple-hammer-editor building
generator: the kind of building Lambda Wars uses so that units inside stay visible from the RTS camera.
Hand this file to the implementing chat as is. It is split into phases; each phase ends usable, tested and
committed, like the earlier "Building phase 1–7" work. [generators-roadmap.md](generators-roadmap.md) sets
its order next to the [point-of-interest generator](poi-generator-plan.md), which reuses these houses
through the `interiorHouse()` function defined there (export it in phase 2).

## 1. Goal

Today every generated building is solid: a world-brush prism with windows painted on the
`BUILDING_TEMPLATE/*` facade textures, decoration as `func_detail`, and a roof. Units walk around it.

The goal is a second kind of building that units can **walk into**, seen from above with the roof and
ceiling cut away:

- Hollow walls with real door and window holes, cut off flat at one height with a plain cap on top.
- Rooms divided by partition walls, every room reachable, doorways wide enough for the unit hulls.
- Floors, furniture, interior lights and grime that read as "inside".
- Sometimes a second storey: stairs plus a partial upper floor (a mezzanine).
- Generated from the Building panel, Generate map, Sketch and the scripts, next to the existing
  solid buildings. Decorative buildings nearby keep their roofs.

### Reference: what defines these buildings (from in-game screenshots)

1. No roof or ceiling: sliced at one horizontal plane.
2. **A flat cap on every cut wall top**, usually a pale cream or white band (sometimes dark). It's the
   strongest visual cue: from far away the building reads as a bright outline of its floor plan.
3. Every wall cut at the same height, even where a pitched roof would peak.
4. Walls are visibly thick (exterior about 16 units, partitions about 8).
5. Sometimes stubs of the roof eaves stay around the outside of the cut.
6. Rectangular or L-shaped, grid-aligned footprints, often on a raised wooden deck or porch.
7. Partition walls split the floor plan into kitchen, hallway, living room, bedroom.
8. Open doorways (no door entities) between rooms and to the outside.
9. Window holes with a sill and lintel, sometimes boarded, sometimes backed with black.
10. Stairs and a partial upper floor at the cut line in two-storey houses.
11. Wooden plank or concrete floors that contrast with the terrain outside.
12. Inner walls in a different material from the outer face (painted plaster or wainscoting inside;
    siding, render or corrugated metal outside).
13. Grime decals: blood, stains, paper, debris.
14. Furniture: fridge, stove, sink, couch, bed, table, chairs, shelves, bathtub.
15. A wall lamp or bulb with its own pool of light. Otherwise the sun lights the rooms through the
    open top, and the walls cast hard shadows across the floor.

## 2. Verified constraints (don't re-derive these)

**Navmesh hulls** (`engine-src/src/game/shared/recast/recast_mesh.cpp`). Recast shrinks the walkable area by
the agent radius, so a doorway must be wider than 2 × radius plus a few cells:

| Mesh | Radius | Height | Max climb | Doorway that works |
|---|---|---|---|---|
| human (soldiers, citizens) | 18.5 | 72 | 18 | 64 |
| medium (antlions, hunters, dogs) | 26 | 80 | 18 | 80 (use 96) |
| large (antlion guard) | 58 | 100 | 18 | 128+ (opt-in "wide doors") |
| verylarge | 90 | 150 | 18 | none: they stay outside |
| air | 42 | 450 | 225 | none: 450 high, never indoors |

- Max climb 18 means floor slabs, porch edges and stair steps rise **16 units at most**.
- Max slope is `recast_maxslope` = 45°, so ramps must stay at 45° or flatter.
- Navmesh geometry is traced with `MASK_NPCWORLDSTATIC`, so it includes world brushes, `func_detail`
  (merged into the world by vbsp), `TOOLS/TOOLSNPCCLIP` brushes, **static props** and dynamic props
  (`recast_mapmesh_loadstaticprops 1`). **Furniture blocks paths**, so the planner must keep clear lanes.
- Upper-floor clearance: storey 128 minus an 8-unit slab leaves 120 clear, enough for every hull indoors.

**Engine and editor facts** (from earlier work in this repo):

- vbsp deletes `prop_static` whose model lacks `$staticprop` or has physics `prop_data`. The editor already
  checks both (`src/edit/preflight.ts`). Prefer the `*_static` variants of furniture models; anything
  without one must be `prop_dynamic` (with `solid 6`) or skipped.
- Lambda Wars maps are HDR-only (`vrad -hdr`), so light entities need `_lightHDR` / `_lightscaleHDR`.
- The RTS spawn camera pitch is forced to 65°, which decides how much floor a wall hides behind it.
- `scripts/compile-map.mjs` compiles without the browser; run it with
  `node --experimental-transform-types`.
- Commits are per phase, **without co-author lines** (the user's request for this repo).
- In-game screenshots go through `scripts/capture-window.ps1`. It has been unreliable (black frames);
  if it fails, say so instead of claiming in-game verification.

**How the current generator is built** (read these first):

- `src/gen/buildings.ts`: `BuildingOptions`, `generateBuildings()`, `partSolids()`. Returns
  `{ solids (world), detail (func_detail), entities, dressing }`. Separate RNG streams per concern
  (`deco`, `roofRng`, `towerRng`, `street.rng`) so a new option never changes existing seeds.
- `src/gen/buildingPlan.ts`: `planBlock()` → `BlockPlan` with `BuildingPlan.parts: Part[]` (convex
  CCW footprints on a 64 grid, `floors`, `kind: 'main' | 'annex'`), yards and sheds.
- `src/gen/facade.ts`: `facadePrism()`, `facadeAxes()`, `offsetPolygon()`, `FLOOR = 128`.
- `src/gen/styles.ts`: `FACADE_STYLES` (windows, ground, door, plain, trim tiles) and `ARCHITECTURES`.
- `src/edit/brushes.ts`: `solidNode()`. `src/gen/buildingAction.ts`: selection → generator.
- Callers: `src/ui/inspector.ts` (Building panel), `src/gen/layout.ts` (Generate map),
  `src/gen/sketch.ts`, `src/examples/sofia.ts`.
- Tests in `tests/*.test.ts` (vitest): see `buildingPlan.test.ts`, `roofs.test.ts`,
  `architecture.test.ts` for the style.

**Assets confirmed in the game's VPKs** (via the dev server's `/api/list`):

- Floors: `WOOD/WOODFLOOR001A`, `002A`, `005A`, `006A`, `006B`, `007A`, `008A`, `WOOD/EP2_WOODFLOOR01`, `02`,
  `CONCRETE/CONCRETEFLOOR0xxA` (many).
- Stairs: `WOOD/WOODSTAIR002A`, `002B`, `002C`.
- Walls: `WOOD/WOODWALL0xxA` (002–045), `PLASTER/PLASTERWALL0xxA` (003–036, plus `b`/`d` variants).
  Wall caps: the facade sets' trim (`BUILDING_TEMPLATE/BUILDING_TEMPLATE002K` is white) or a pale plaster.
- Furniture (`models/props_c17/`): `furniturecouch001a_static`, `furniturebed001a_static`,
  `furnituremattress001a_static`, `furniturebathtub001a_static`, `furnituretable001a/002a/003a`,
  `furniturechair001a`, `furniturestove001a`, `furniturefridge001a`, `furnituresink001a`,
  `furnitureshelf002a`, `furnituretoilet001a`, `furnitureboiler001a`, `furniturefireplace001a`,
  `shelfunit01a`. Also `models/props_interiors/` (`furniture_couch01a_static`, `refrigerator01a`,
  `sinkkitchen01a`, `bathtub01a`, `lightbulb01a`), `models/props_wasteland/` (`kitchen_stove001a`,
  `kitchen_fridge001a`, `kitchen_shelf001a_static`, `cafeteria_table001a_static`,
  `controlroom_desk001a_static`, `prison_bedframe001b_static`), `models/props_junk/wood_crate001a_static`,
  `wood_crate002a_static`.
- Lamps: `models/props_c17/lampfixture01a`, `light_cagelight01_on`, `models/props_interiors/lightbulb01a`.
- Only names ending `_static` are certain to survive vbsp. Run every other model through the existing
  static-prop check before using it as `prop_static`.

## 3. Phases

### Interior phase 1: floor-plan planner (data only)

New `src/gen/interiorPlan.ts`, pure functions, no brushes yet.

- Input: a convex or L-shaped footprint (from `Part.poly`), number of storeys (1–2), cut height, RNG,
  options (`wideDoors`).
- Output: an `InteriorPlan`:
  - `rooms`: rectangles with a type (`hall`, `living`, `kitchen`, `bedroom`, `bath`, `storage`,
    `workshop`), on the 64 grid, at least 128 × 128 (bath and storage may be 128 × 96).
  - `walls`: segments `{ a, b, thickness, exterior: boolean, storey }` with `openings:
    { from, to, kind: 'door' | 'window' | 'gap', sill, lintel }` measured along the wall.
  - `entrances` (at least one exterior door, two for footprints over 384 units long), `porch?`
    (a deck strip in front of the main door).
  - `stairs?` and `upperFloor?` (rectangles) when storeys = 2 (see phase 4; plan the space here).
  - `lanes`: the door-to-door paths furniture must keep clear (48 wide).
- Algorithm: recursive splitting of the footprint along the 64 grid (pick the longer axis, keep rooms
  ≥ 128), then assign room types by size and position (hall touching the main entrance, kitchen and bath
  next to each other). Doors: one per shared wall between adjacent rooms on a spanning tree, plus a
  few extra for loops. Width 64 (human), 96 when the wall allows it, 128 with `wideDoors`. Doors stay
  ≥ 16 from wall ends and corners. Windows: on exterior walls, 64–96 wide, sill 40, lintel 96, about one
  per 128–192 units of wall, never closer than 32 to a door or corner.
- Tests (`tests/interiorPlan.test.ts`): every room reachable from an entrance; every door ≥ 64 (≥ 128
  with `wideDoors`); openings don't overlap or touch wall ends; rooms tile the footprint exactly;
  same seed gives the same plan; L-shapes work.

### Interior phase 2: hollow shell, caps and floors

New `src/gen/interiorShell.ts`: `InteriorPlan` → brushes.

- **Walls**: each wall segment is split around its openings into convex box brushes: full-height piers
  between openings, a sill block under each window, a lintel block over each door and window up to the
  cut height. Exterior walls 16 thick, partitions 8. Walls meet at corners without gaps or overlaps
  (extend exterior walls to the outer corner; partitions butt into the inner face).
- **Cut height**: an option (default 112; 96–128). Walls stop flat at `z0 + cut`. A one-storey
  house is 128 storey, cut at 112 so the camera at 65° sees most of the floor.
- **Cap**: the top face of every wall brush gets the cap material (default the facade set's trim, or a
  pale plaster), aligned in world space so caps line up across brushes. Optional dark cap per style.
- **Faces**: outer face uses the exterior material, inner face the room's interior material (per room,
  so the kitchen can be tiled and the living room papered), reveals of openings use the interior
  material, bottoms `TOOLS/TOOLSNODRAW`. Texture scale 0.25, aligned to the floor height.
- **Floors**: one slab per room (or one for the whole house), 8–16 thick, top at `z0 + 8` (≤ 16 above
  ground for the 18-unit climb). It sinks into the ground like the solid buildings (`z0 - 32`) so it
  sits on uneven terrain. Porch: a deck slab at the same height, plank material, with an optional
  railing (`metal/metalrail001a` or plank brushes) on the sides.
- **Windows**: either open, black-backed (a thin `TOOLS/TOOLSBLACK` or dark-glass brush in the middle
  of the hole, no collision issues since units don't walk there), or boarded (two or three plank
  brushes across the hole). Pick per house from the style.
- **Brush entity split**: put all interior-house brushes in the `detail` list (func_detail). Open-top
  walls don't seal or block vis usefully at RTS heights, and it keeps vvis fast. The floor slab may stay
  world. The house is still solid to units and the navmesh (func_detail merges into the world).
- **Styles**: add `INTERIOR_STYLES` in `src/gen/styles.ts`: `{ outer, inner[], floor[], cap, stair,
  windows: 'open' | 'black' | 'boarded' }` sets. Examples: wooden shack (WOODWALL outer, WOODWALL inner,
  WOODFLOOR), plaster farmhouse (PLASTERWALL outer and inner, WOODFLOOR, white cap), concrete
  outbuilding (CONCRETE walls, CONCRETEFLOOR, grey cap).
- Tests: every brush is convex and valid (reuse `tests/brush.test.ts` helpers); wall brushes don't
  overlap; openings are holes (no brush intersects an opening's box); every wall top is at `z0 + cut`;
  cap faces use the cap material.
- Demo: generate a row of houses from one selected block; screenshot from the RTS angle and from
  above in the editor.

### Interior phase 3: furniture, lights and grime

New `src/gen/interiorDressing.ts`.

- **Prop sets per room type**, each item `{ model, size (x, y), against: 'wall' | 'corner' | 'free',
  facing }`: kitchen (stove, fridge, sink, shelf), living (couch, table, chairs, fireplace), bedroom
  (bed or mattress, shelf), bath (bathtub, toilet, sink), storage and workshop (crates, shelf units,
  table). Measure model sizes once from the MDL bounds (the editor's MDL loader has them) and store
  them in the table, or read them at generation time if that's easy.
- **Placement**: along walls, facing into the room, rotated in 90° steps, never in a door's swing
  area (64 in front of every door) or on a `lane`. Keep at least one 48-wide free lane between all
  doors of a room (the navmesh sees static props). 0–4 items per room depending on its size; a
  "Furnish" option of none / sparse / full.
- **Lights**: one `light` per room near a wall lamp model (`lampfixture01a`, `light_cagelight01_on`,
  or a hanging `lightbulb01a`), warm colour (`255 214 170`), modest brightness (~80–150), with
  `_lightHDR` / `_lightscaleHDR` keys. Some rooms dark on purpose (abandoned look). A "Lights" option.
- **Grime**: `infodecal` blood, stain and paper decals on floors and inner walls, scaled by the existing
  Weathering option; optional debris props (`models/props_debris/plaster_floorpile001a` etc.).
- Draw from its own RNG stream (`seed * 23 + 13`) so furnishing never changes the floor plan.
- Tests: props stay inside their room and clear of lanes and door zones; only `_static` or
  checked-static models become `prop_static`; light count matches rooms with lights.

### Interior phase 4: second storey and stairs

- Two-storey houses: the ground-floor walls run full height to the upper slab (`z0 + 128`), the upper
  storey's walls stop at `z0 + 128 + cut`. The upper floor covers **at most half** of the footprint
  (a mezzanine or one upper wing), so the rooms below stay visible from above, like the reference
  screenshots. The rest stays one storey, cut at the normal height.
- **Stairs**: a straight run along a wall from the ground floor to the upper slab: 8 steps of 16 rise
  and 24 tread (or a single landing for a U-turn), stair material on the treads, side stringer
  brushes. Over the steps add a `TOOLS/TOOLSNPCCLIP` ramp brush (≤ 45°; 128 rise needs ≥ 128 run) so
  Recast gets a smooth slope (`MASK_NPCWORLDSTATIC` includes npc clip). Stair width ≥ 64.
- Upper slab edge facing the open part gets a railing (detail brushes or `metal/metalrail001a`).
- The planner (phase 1) reserves the stair rectangle and keeps its foot and head clear.
- Tests: step rise ≤ 16, ramp slope ≤ 45°, stair foot and head connect to a room lane, upper floor
  ≤ 50% of the footprint.
- **Must verify in game** (see phase 6): the navmesh connects both floors, and units can be ordered
  upstairs. If Recast doesn't connect them, first try a `recast_offmesh_connection` pair (an entity in
  the game's FGD for manual navmesh links) from the stair foot to the stair head. If that fails too,
  ship two-storey houses with the upper floor as decoration only and say so in the README.

### Interior phase 5: integration and the panel

- `BuildingOptions.interiors?: 'none' | 'some' | 'all'` (default `'none'`, so existing maps and seeds
  are unchanged), plus `cutHeight?`, `furnish?`, `interiorLights?`, `wideDoors?`.
- Which buildings get interiors: small free-standing lots and annexes of 1–2 floors (footprint up to
  about 640 × 640). Courtyard ring buildings and anything taller stay solid. With `'some'`, about
  40% of eligible lots.
- **New architectures** in `ARCHITECTURES`: "Village houses" (plaster and wood, 1–2 floors, mostly
  interiors) and "Slum shacks" (wood and corrugated metal, 1 floor, all interiors). Each architecture
  gets an `interiors` default. Solid neighbours keep their roofs.
- An interior house skips the roof, tower, oriels, balconies, awnings and roof props. It keeps the
  base course and weathering on its outer face, and optional eave stubs (a short overhang band just
  under the cap) at detail level 2+.
- **Building panel** (`src/ui/inspector.ts`): Interiors (none / some / all), Cut height, Furnish,
  Lights, Wide doors. **Generate map** (`layout.ts`) and **Sketch** (`sketch.ts`): an Interiors
  setting, and in the layout painter a "houses" cell kind (or a flag on building cells) for enterable
  buildings. Rural layouts default to some interiors.
- `GeneratedBuildings.dressing.obstacles` must not treat interior houses as solid blockers where the
  street pass would otherwise skip them; doors need a clear approach outside (no lamp post or car in
  front of a door).
- One undo step still reverts the whole generation (`buildingAction.ts`).
- Tests: `interiors: 'none'` gives byte-identical output to before for a fixed seed (golden test);
  `'all'` on a small block produces only interior houses.

### Interior phase 6: test map, compile and in-game check

- `scripts/interiors-demo.mjs` (pattern of `buildings-p6-demo.mjs`) builds `maps/interiors_test.vmf`:
  one row per interior style, one-storey and two-storey, furnish none / full, plus a mixed rural block,
  with player starts and a few units placed near the houses (Lambda Wars kits from `src/lw/kits.ts`).
- Compile with `node --experimental-transform-types scripts/compile-map.mjs`; require no vbsp errors,
  no "deleted prop_static" lines, no leaks, and the navmesh built for all five meshes. Report brush,
  prop, light and decal counts and the compile time, as the earlier phases did.
- In game (`lambdawars.exe -game lambdawars -dev -windowed +map interiors_test`, `sv_cheats 1`):
  `recast_draw_navmesh 1` with `recast_debug_mesh human` and `medium`. Check the navmesh runs through
  every door, around furniture and up the stairs. Order a squad into a house and upstairs. Screenshot
  from the RTS camera.
- README: a new "Interior buildings" section with the phase notes and screenshots in
  `docs/screenshots/interiors-pN-*.png`, and update the memory file
  `simple-hammer-editor.md` with anything non-obvious learned.

## 4. Out of scope (for now)

- Roofs that fade out when the camera or a unit gets close. That needs engine or Python work (a
  client-side entity that hides a roof `func_brush` based on camera distance or unit occupancy) and is
  a separate project.
- Garrisoning (`func_brush_garrisonable`) and capture logic tied to houses.
- Interiors in the tall City 17 blocks: their windows are painted on the facade textures, so they
  can't be opened up without replacing the whole facade system.
- Doors as entities (`prop_door_rotating`): open doorways only.

## 5. Definition of done

Every phase: typecheck and `npm test` pass, a demo screenshot in `docs/screenshots/`, a README section,
one commit per phase (no co-author line). Phase 6 additionally: the test map compiles cleanly, and
units path through doors (and upstairs, or the README says why not).
