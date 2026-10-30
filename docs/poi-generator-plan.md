# Plan: point-of-interest generator

A brief for adding a **point-of-interest (POI) generator** to simple-hammer-editor: one tool that fills an
area with a finished piece of content (a playground, a market, a Combine checkpoint, a dock) for Lambda Wars
maps. Hand this file to the implementing chat as is. It sits next to
[interior-buildings-plan.md](interior-buildings-plan.md); [generators-roadmap.md](generators-roadmap.md) sets the
order of both.

## 1. Goal

- Drag a rectangle (or select a block brush), pick a POI type, tweak a few parameters, get a complete
  area: ground surface, edges (fence, wall, hedge, kerb), brush structures, props, decals, lights and
  optional gameplay entities. One undo step.
- **Editable afterwards**, like roads: the spec is stored on the POI's `func_detail`, so selecting it
  shows its parameters again, and *Regenerate* / *Re-roll* rebuild it in place.
- Works in every landscape the user maps: **city, forest, beach, rocky**.
- Every POI is built for an RTS, not just to look nice. It offers cover, a chokepoint, high ground, a
  vision blocker, a place to capture or a scrap source, and it always leaves paths open for the big
  units.

## 2. Catalogue

**Requested** (tier 1) are the six the user asked for. **Tier 2** are the strongest additions: a clear
Half-Life 2 identity, real RTS value, and the props already in the game. **Tier 3** comes later.
Props marked ✓ were found in the game's VPKs (via the dev server's `/api/list`). "Brush" means there
is no model, so build it from brushes.

### City

| POI | Tier | What it is | RTS role | Key assets |
|---|---|---|---|---|
| Square | Requested | Paved plaza with a monument, benches, lamp posts, trees in planters | Open killing ground around a centre capture point; low cover at the edges | ✓ `props_c17/lamppost03a_on`, `props_trainstation/benchoutdoor01a`, `props_c17/gravestone_statue001a` / `props_combine/breenbust` as the monument; plinth and fountain from brushes |
| Parking lot | Requested | Marked bays, parked and wrecked cars, a ticket booth, lamp posts, kerbs | Rows of hard cover; lanes between them | ✓ `props_vehicles/car002a`–`005a`, `van001a`, `truck003a`, tyres; bay lines as overlays |
| Playground | Requested | Swings, slide, carousel, climbing frame, seesaw, sandpit, low fence, benches | Light cover, a clear landmark | ✓ `props_c17/playground_swingset01`, `playgroundslide01`, `playground_carousel01`, `playground_jungle_gym01a/b`, `playground_teetertoter_*`, `playgroundtick-tack-toe_*`; sandpit from brushes |
| Market | Requested | Rows of stalls with awnings, crates, produce, carts, a covered hall option | Dense soft cover, narrow lanes (a good place to ambush) | ✓ crates, `props_junk/pushcart01a`, `watermelon01_large`, `props_c17/awning001a/002a`, `pg_props/pg_deko/pg_beach_umbrella`; stalls from brushes |
| Combine checkpoint | 2 | Barricades, a booth, a scanner gate, floodlights across a street | Chokepoint for the Combine; a natural capture point | ✓ `props_combine/combine_barricade_*` (tall, med, short, brackets), `combine_booth_med01a/short01a`, floodlights |
| Rebel barricade | 2 | Cars, furniture, sandbags, crates and barrels piled across a street, with a gap | Defensive line with one gap; "Anticitizen One" look | ✓ cars, `props_c17/furniture*`, `props_junk/wood_crate*`, `pg_props/pg_buildings/other/pg_*_barricade`; sandbag walls from brushes |
| Ration distribution | 3 | Queue barriers to a Combine booth, a Breencast screen | Funnel lanes; story set piece | ✓ booths, `props_c17/tv_monitor01`, barricades |
| Junkyard / scrapyard | 2 | Car wrecks, tyre stacks, dumpsters, containers, scrap piles inside a fence | **Scrap source** (Lambda Wars resource) with cover | ✓ cars, `props_silo/tirestack*`, `props_junk/trashdumpster01a_static`, `props_wasteland/cargo_container01*`; `scrap_marker` entities |
| Construction site | 3 | Scaffolding, half-built walls, a crane, sand and gravel piles, containers | Height and cover, many lanes | ✓ `cranes/crane_frame`, containers; scaffolding from brushes |
| Rail yard / station | 2 | Tracks, platforms, parked and wrecked train cars | Long lines of hard cover, platforms as low high ground | ✓ `props_trainstation/train001`–`005`, `props_junk/train002/003`, `pg_props/pg_obj/pg_rail_256/512`, `pg_tram`, `pg_train_bumper` |
| Gas station | 2 | Pumps under a canopy, a kiosk you can walk into, propane tanks | Cover plus explosive hazards | ✓ `props_wasteland/gaspump001a`, `props_junk/propane_tank001a`; canopy from brushes; kiosk from the interior generator |
| Canal crossing | 3 | A sunken canal with bridges and ladders (Route Kanal) | Chokepoint at the bridges | ✓ `props_canal/canal_bridge01`, `canal_bars*`; channel from brushes, water material |
| Tank farm / fuel depot | 3 | Storage tanks, pipes, a fence | Big hard cover | ✓ `props_wasteland/coolingtank01/02`, `horizontalcoolingtank04`, `props_mining/oiltank01` |

### Forest and rural

| POI | Tier | What it is | RTS role | Key assets |
|---|---|---|---|---|
| Park | Requested | Paths, lawns, trees, hedges, benches, a pond or fountain, a bandstand | Vision blockers (hedges), soft cover, open lawns | ✓ `props_foliage/*` trees and `mall_bush*`, benches, `props_junk/trashbin01a`; hedges as brush + `fow_blocker` |
| Sport fields | Requested | Football pitch (goals, lines, low bleachers, floodlights), basketball court, running track | Wide-open area flanked by bleachers | Lines as overlays; **goals, hoops and bleachers from brushes** (no models exist); ✓ floodlights |
| Rebel camp | 2 | Tents, a shack, campfire, supply crates, radio mast, a watch post | Rebel base or objective; garrison | ✓ `pg_props/pg_obj/pg_tent`, `structures/resistance/shack`, `pg_props/pg_buildings/pg_rebel_radio_tower`, `props/crates/supplycrate*`, `items/ammocrate_*_static` |
| Farmstead | 2 | Farmhouse (interior), barn, fences, hay, tractor tyres, a well | Garrisonable house, fenced fields | Interior generator for the houses; ✓ `brush/fence_wood_*`, `props_vehicles/tire001a_tractor_static` |
| Graveyard and chapel | 2 | Gravestones in rows, a low stone wall, a small chapel (interior), dead trees (Ravenholm) | Low cover in rows; a zombie spawn site | ✓ `props_c17/gravestone001a`–`004a`, `gravestone_cross001a/b`, `gravestone_statue001a`, `brush/cross_stone01` |
| Thumper site / antlion field | 2 | A Combine thumper in a ring of sand and rocks, antlion burrows around it | Objective (hold the thumper); antlion and zombie spawn points | ✓ `props_combine/thumper001a`, `thumper002`; rocks from `props_foliage` and `cliffs/` |
| Crash site | 2 | A crashed dropship container or gunship debris, burnt trees, scattered crates | **Scrap** plus cover in a clearing | ✓ `combine_dropship_container_static`, debris, crates |
| Lookout tower | 3 | A wooden or concrete watchtower on a rise | High ground with long sight | Tower from brushes; stairs as in the interior plan's phase 4 |
| Logging camp | 3 | Log piles, a sawmill shed, a truck | Cover lines in a forest clearing | ✓ `props_forest/*`, trucks; logs as cylinder brushes |
| Combine power node | 3 | A generator compound with fences | Objective to destroy | ✓ `pg_props/pg_buildings/combine/pg_combine_power_generator`, chemical-plant fences |

### Beach and coast

| POI | Tier | What it is | RTS role | Key assets |
|---|---|---|---|---|
| Dock / jetty | 2 | Wooden piers on poles, boats tied up, crates, a crane | Narrow walkways (chokepoints) over water | ✓ `props_docks/canal_dock01a`–`03a`, `dock01_pole*`, `props_wasteland/dockplank01a/b`, `boat_fishing01a/02a`, `buoy01`, `cranes/crane_docks` |
| Beach front | 3 | Beach huts, umbrellas, a lifeguard tower, a breakwater | Scattered soft cover, one tall lookout | ✓ `pg_props/pg_deko/pg_beach_umbrella`; huts from the interior generator; lifeguard tower from brushes |
| Lighthouse point | 3 | A lighthouse on rocks with a keeper's house (Lost Coast) | High ground and a landmark | Tower as stacked cylinder brushes (like the corner towers), house from the interior generator |
| Coastal bunker | 2 | A Combine bunker with sandbags and trenches on the dunes | Hard point overlooking the beach | ✓ `pg_props/pg_buildings/combine/pg_combine_bunker`; trenches from brushes |
| Shipwreck | 3 | A beached boat hull on its side, scattered cargo | Cover plus **scrap** | ✓ `lostcoast/props_wasteland/boat_wooden01a_static`, `props_canal/boat002b_static`, containers |

### Rocky

| POI | Tier | What it is | RTS role | Key assets |
|---|---|---|---|---|
| Quarry | 2 | Stepped pit walls, conveyor, carts on rails, a crane | Terraced high ground, a ramp chokepoint | ✓ `props_mining/flatbed_cart01/02`, `pg_rail_*`; terraces from brushes or terrain |
| Mine entrance | 3 | A timber-framed tunnel mouth into a cliff, rails, carts | Chokepoint; a spawn point for enemy waves | ✓ `props/supports/crossbeam*`, rails, carts |
| Overlook / sniper nest | 3 | A rock ledge with sandbags, reached by one ramp | High ground with one way up | Sandbags from brushes, rocks from `cliffs/` |
| Rocky pass | 3 | A road through a narrow gap between boulders, a rockslide half-blocking it | Natural chokepoint | ✓ `cliffs/*`, `props_foliage/rock*` |
| Radio relay | 3 | A rebel radio tower on a peak with a shack | Objective | ✓ `pg_rebel_radio_tower`, `structures/resistance/shack` |

**Asset caveat**: most of these are physics props. Only models with `$staticprop` and no physics
`prop_data` survive vbsp as `prop_static`. The editor already checks this (`src/edit/preflight.ts`).
Prefer `*_static` variants; use `prop_dynamic` (`solid 6`) for the rest, or `prop_physics` where it
should be pushable or explosive (propane tanks, barrels), as an option.

## 3. Verified constraints and existing code

- **Unit sizes** (from `engine-src/src/game/shared/recast/recast_mesh.cpp`): human radius 18.5, medium 26,
  large 58, verylarge 90; max climb 18; max slope 45°. Every POI must leave **a through-route at least
  128 wide** (large units) between its entrances. Gaps in fences and walls are at least 128 wide, and
  props stay off those routes. The navmesh includes world brushes, `func_detail`, `TOOLS/TOOLSNPCCLIP`,
  static props and dynamic props.
- **Scale**: a human unit is 72 units tall (about 40 units per metre). Real sizes are too big for an RTS
  map: a full football pitch would be 4200 × 2700. Use RTS-scaled sizes: football pitch 1536 × 1024,
  basketball court 640 × 384, parking bay measured from the car models (about 128 × 256).
- **Lambda Wars gameplay entities** in the game's FGD: `trigger_capture_area` (the Capture point kit in
  `src/lw/kits.ts` places it), `scrap_marker` (`src/gen/sketch.ts` places one with
  `autoconstruct 1, constructed 2`), `fow_blocker` (brush entity that blocks fog-of-war sight: hedges,
  dense trees, high walls), `func_nav_blocker`, `recast_offmesh_connection` (manual navmesh links, for
  example jumping down a ledge), `func_brush_garrisonable` (garrisonable building; work out its keys before
  using it), `wars_flora` (grass and plants).
- **The pattern to copy**: roads (`src/gen/roads.ts`) store their spec in a `she_road` key on their
  `func_detail` (`encodeRoad` / `decodeRoad` / `roadOf` / `setRoadSolids`) and rebuild in place
  (`src/gen/roadAction.ts`, `src/edit/roadTool.ts`). Kits (`src/lw/kits.ts`) declare typed parameters
  (`KitParam`) that the UI renders.
- **Helpers that exist**: `solidNode` / `boxSolid` (`src/edit/brushes.ts`), `facadePrism`,
  `offsetPolygon` (`src/gen/facade.ts`), `shapeSolids` for cylinders, cones, domes (`src/edit/shapes.ts`),
  `Rng` (`src/gen/rng.ts`), decals and overlays (`src/edit/decals.ts`), terrain paint and sculpt
  (`src/edit/terrain.ts`, `src/edit/groundTool.ts`), `entity()` (`src/gen/layout.ts`), the street pass
  (`src/gen/streets.ts`).
- There is **no water tool** yet. Docks, canals and the coast need a water brush (a `nature/water_*`
  material on a world brush's top face, with `water_lod_control` if needed). It's a small addition in
  POI phase 6.
- Commits per phase, **without co-author lines** (the user's rule for this repo). Compile without the
  browser: `node --experimental-transform-types scripts/compile-map.mjs`.

## 4. Phases

### POI phase 0: framework and tool

- `src/gen/poi/types.ts`: `PoiSpec { type, seed, rect (x0, y0, x1, y1), rotation (0/90/180/270),
  z, landscape: 'city' | 'forest' | 'beach' | 'rocky', params: Record<string, ParamValue> }` and
  `PoiType { id, label, landscapes, minSize, maxSize, params: KitParam[], build(ctx): PoiOutput }`.
  `PoiOutput { world, detail, entities, decals, overlays, terrainEdits?, routes }`.
- `src/gen/poi/registry.ts`: the list of POI types, so each later phase only adds a file.
- `src/gen/poi/kit.ts`: a shared toolkit every POI builds on:
  - **Ground pad**: paving slab or path brushes, or, on displacement terrain, flatten and paint the
    terrain under the footprint (reuse `terrain.ts`) with a blended margin.
  - **Edges**: fence (models along a line, with gaps), low wall, hedge (brush + optional `fow_blocker`),
    kerb, railing. Each one takes a list of gaps.
  - **Placement**: scatter with minimum spacing, rows and grids, along an edge facing in or out,
    snap to the 16 grid, random yaw or 90° steps; every placement checks it is off the reserved routes.
  - **Routes**: through-routes between the entrances, at least 128 wide, reserved first.
  - **Model table**: `src/gen/poi/models.ts` with each model's measured footprint (from the MDL bounds
    the editor's loader reads) and whether it is safe as `prop_static`.
  - **Ground height**: a sampler that ray-casts down onto the world (the picking BVH) so props stand on
    terrain.
  - **Gameplay hooks**: optional capture point at a POI's focus spot, scrap markers, unit-group spawn
    spots, explosive props. Each POI declares which it supports.
- **Storage**: the POI's brushes live in one `func_detail` with a `she_poi` key holding the encoded spec;
  its point entities get `she_poi_id` so a rebuild removes exactly the old ones. Round-trip tests like
  roads have.
- **UI**: a POI tool (next shortcut free after the existing tools) and a `src/ui/poiPanel.ts` panel:
  type picker grouped by landscape, parameters rendered from `KitParam`, seed with 🎲, rotation,
  *Generate*, *Regenerate*, *Re-roll*. Drag a rectangle or use the selected block brush; the
  rectangle snaps to 64 and is clamped to the type's min and max size. Selecting an existing POI loads
  its spec into the panel. One undo step per action.
- Tests: spec round-trip; a dummy POI rebuilds in place without leaving stray entities; routes stay
  clear of placed props; outputs are deterministic per seed.

### POI phase 1: square, parking lot, playground

- **Square**: paving pattern (border band, centre field), a central feature (statue plinth, fountain
  basin from brushes, or a Breencast pole in the Combine variant), benches facing the centre, lamp posts
  on the edges, trees in brush planters. Parameters: centre feature, trees on or off, Combine
  occupation (banners, barricades at the corners), capture point at the centre.
- **Parking lot**: asphalt pad, bay lines as overlays, rows of bays with an aisle (≥ 160 wide), cars
  in 40–80% of the bays with random small rotations, some wrecks, a ticket booth, lamp posts,
  kerbs. Parameters: rows, occupancy, wrecks, booth.
- **Playground**: rubber or sand surface, low fence with gate gaps, 3–6 pieces of equipment spaced
  out, a brush sandpit, benches. Parameters: equipment count, fence, abandoned look (debris, decals).
- Demo screenshots of each in the editor, from the RTS camera angle.

### POI phase 2: park and market

- **Park**: winding gravel paths between the entrances (spline paths built as road-like strips or
  overlays), lawns, tree clusters, hedges along paths (`fow_blocker` option), benches and bins along
  paths, an optional pond (brush basin, water later in phase 6, until then a dry basin), fountain or
  bandstand. Parameters: tree density, hedges, centre feature.
- **Market**: stalls on a grid with lanes (≥ 128) between rows. Each stall is brushes: a counter, four
  posts and a sloped awning in a striped or canvas material, with crates, produce and carts in and
  around it. Variant: covered market hall (columns and an open roof frame). Parameters: rows, stall
  density, abandoned look.

### POI phase 3: sport fields

- **Football pitch** (1536 × 1024 default): grass pad, line markings as overlays (or thin `func_detail`
  strips with a white material), two goals from thin box brushes with a see-through net material (look up
  a fence or net texture), stepped bleachers from brushes along one or both sides, floodlight masts at
  the corners, low fence around with gaps.
- **Basketball court**: asphalt, lines, two hoops from brushes (pole, board, ring as a thin cylinder),
  a tall fence.
- **Running track**: an oval of red-brown material around the pitch (option).
- Bleachers are climbable high ground: steps ≤ 16 high, with an npc-clip ramp over them (see the
  interior plan's stairs) so units can stand on top.

### POI phase 4: Half-Life 2 city set

Combine checkpoint, rebel barricade, junkyard, rail yard, construction site, ration distribution,
tank farm. Each one is mostly prop placement on the phase 0 toolkit with a few brush pieces
(sandbag walls: rows of small rounded boxes; scaffolding: thin boxes; platforms: slabs with a stepped
edge). The junkyard places `scrap_marker`s. The checkpoint and barricade span a street: their
rectangle's long side runs across the road, with the gap in the middle. **Gas station** comes after
the interior generator exists (its kiosk is an interior house); if that isn't ready, build the kiosk as
a solid box and note it.

### POI phase 5: forest and rural set

Rebel camp, thumper site, crash site, graveyard, lookout tower, logging camp, power node. **Farmstead
and the graveyard's chapel** use the interior generator's house builder (see the roadmap for the
shared API). Thumper and graveyard sites can place zombie or antlion unit groups through the existing
kits.

### POI phase 6: coast and rocky set, and water

- A **water** helper: a world brush with a water material on top at a chosen level, sealed below the
  ground. Test that it compiles (water needs `%compilewater`-style materials and the brush inside the map
  shell) and how units treat it (the navmesh should exclude deep water).
- Dock / jetty (planks on poles over water, boats, buoys), coastal bunker, beach front, shipwreck,
  lighthouse (stacked cylinder tower, reusing the corner-tower code in `src/gen/towers.ts`).
- Quarry, mine entrance, overlook, rocky pass, radio relay. Terraces and ramps from brushes or sculpted
  terrain; boulders from `cliffs/` and `props_foliage/rock*` models.
- Park ponds and the canal crossing get real water now.

### POI phase 7: map integration, showcase and in-game check

- **Sketch** (`src/gen/sketch.ts`): a POI layer; paint a rectangle and pick a type. **Generate map**
  (`src/gen/layout.ts`): place a few POIs that fit the theme in open areas, away from bases, with a
  capture point on one of them.
- `scripts/poi-demo.mjs` builds `maps/poi_showcase.vmf` with every POI type in a grid, plus a
  playable test map with three or four POIs between two bases.
- Compile with `compile-map.mjs`: no vbsp errors, no deleted static props, navmesh built. In game
  (`sv_cheats 1`, `recast_draw_navmesh 1`, `recast_debug_mesh human` then `large`): routes through
  every POI exist for large units; bleachers and towers are reachable where intended.
- README section "Points of interest" with a screenshot per POI type
  (`docs/screenshots/poi-pN-*.png`).

## 5. Definition of done

Every phase: typecheck and `npm test` pass, demo screenshots, a README section, one commit per phase
(no co-author line). Phase 7: the showcase map compiles cleanly and large units can path through every
POI.
