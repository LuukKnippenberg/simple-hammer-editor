# Building generator

Solid city buildings after the architecture of Half-Life 2's City 17: shaped corners, real roofs, layered facades,
corner towers, balconies and street dressing. Used by the **Building** and **Building block** generators (Generate
menu, keys 1 and 2), by **Sketch** and **Generate map**, and by the example map scripts. Enterable houses come from
the same generator: see [interior-buildings.md](interior-buildings.md).

Code: `src/gen/buildings.ts` (entry point and `QUALITY`), `buildingPlan.ts`, `facade.ts`, `facadeFeatures.ts`,
`roofs.ts`, `towers.ts`, `streets.ts`, `styles.ts`, `yards.ts`, `buildingStore.ts`.

## How a block is built

- **Planner** (`buildingPlan.ts`): a block of 896 units or more becomes a ring of buildings round a courtyard
  (corner buildings and lots along each side); smaller blocks become a row of lots, deep lots sometimes L-shaped
  round a back yard. Heights vary; corner buildings tend to be a floor taller. Sheds stand in courtyards and yards,
  and most courtyards are closed on one side by a wall with a gateway.
- **Corners**: buildings on a block corner get a square, 45° cut or rounded corner (radius 128 to 256, built from
  64-unit segments). Cut and rounded faces get entrance doors.
- **Facades** (`facade.ts`): textures come from the game's `building_template` materials, where one texture tile
  is one floor. Each wall's texture starts at its corner and is stretched slightly to show a whole number of window
  bays, so angled and curved faces never cut a window in half. Building shells are world brushes; all decoration is
  `func_detail`.
- **Random sequences**: layout, materials, decoration, roofs and interiors each draw from their own sequence, so
  changing the detail level or roof kind never changes the layout. The same seed and settings give the same
  buildings.

## Decoration detail

| Level | Adds |
|---|---|
| None | cornice band and parapet |
| Low | stone base course along the street, stepped cornice |
| Medium (default) | a ledge over the ground floor, thin ledges between floors, quoins on the corners, flat columns every 2 to 3 window bays (on bay boundaries, so between windows) |
| High | brackets under the cornice at every bay |

## Roofs

Roofs are built from planes (`roofs.ts`): over a convex footprint a hipped roof is the intersection of one rising
plane per wall, so each roof tier is a single convex brush, also over cut and rounded corners.

| Roof | Shape | Covering |
|---|---|---|
| Hipped | one tier, 37° | terracotta tiles, slate or metal |
| Mansard | a steep attic storey (76°) with dormers at every second bay, then a low cap | slate, copper or metal |
| Gabled | two slopes, gable walls in the facade's plain material (rectangular buildings) | tiles, slate or metal |
| Curved | three tiers (72°, 52°, 19°): the bell-shaped copper roofs | copper or slate |
| Flat | parapet roof with rooftop props (Soviet blocks: rooftop stair houses) | concrete |

Dormers have a window from the building's own facade. Chimneys (one to three) stand on the roof; sheds get a low
metal roof half of the time.

## Corner towers

Corner buildings of three or more floors get a tower on their street corner: most rounded corners, a third of the
cut ones and a fifth of the square ones (`towers.ts`). On a rounded corner the tower continues the curved facade
upwards; on cut and square corners an 8- to 12-sided tower stands tangent to both walls. It rises one or two floors
above the eaves, with windows from the facade, a cornice ring and a drum. Caps are profiles revolved into stacked
convex frustums: **bell** (most common), **dome**, **onion** and **spire**, in copper, slate or grey metal; bells and
domes get a small lantern.

## Street features

Only walls on the block's outline face the street and get these (`facadeFeatures.ts`); courtyard and party walls
stay plain. Features sit on whole window bays and never overlap.

- **Oriels** (Medium and up, 4+ floors, walls of 384+): rectangular, angled or half-round, two bays wide.
- **Balconies** (Medium and up, 3+ floors): one long balcony on the first floor, or single-window balconies
  stacked up the facade, with wrought-iron railings (`metal/metalrail001a`).
- **Shopfront awnings** (Low and up), basement vent decals, entrance steps at cut-corner entrances.
- **Wall clutter** (`streets.ts`): drainpipes, satellite dishes, gas meters, cable insulators, TV antennas.
- **Weathering** (0 to 1): stain and dirt decals on street walls, under the cornice and below window sills.

## Architectures

`styles.ts` bundles the choices into kinds of building:

| Architecture | Facades | Roofs | Corners, towers | Street features | Floors |
|---|---|---|---|---|---|
| Pre-war tenements | ochre, yellow, cream, framed stone, blue, rose, sand | mansard, curved, hip, some gables | mixed, more towers | oriels, balconies | 3–6 |
| Soviet blocks | grey concrete, stone, pale | flat with rooftop stair houses | square, no towers | balconies | 5–9 |
| Brick houses | brick, brown, rose | gables, hips, a few mansards | cut, few towers | oriels | 2–4 |
| Sheds and workshops | brick, brown, stone | gables, flat, hips | square | none | 1–2 |
| Village houses | cream, sand, rose and brick plaster | gables, hips | | | 1–2, mostly enterable |
| Slum shacks | corrugated metal and wood | | | | 1, all enterable |
| Mixed | everything | everything | mixed | all | 3–6 |

## The street pass

Blocks generated together (several selected block brushes, a Sketch or Generate map) share a street pass:

- **Overhead cables** between anchors facing each other across a street (128 to 900 apart): `move_rope` →
  `keyframe_rope` pairs with sag, each ending on the outer insulator of a wall bracket (`utilitypolemount01a`).
- **Lamp posts** along the pavements with their arms over the street, none in alleys (gaps under 192).
- **Bare trees** in courtyards and yards, and alternating with lamps on wide streets.
- Nothing is placed in front of a door, and lamps and trees stand on pavements, never on a carriageway.

## Quality and the t-junction budget

vbsp has room for 65,536 t-junctions, and facade decoration is nearly all of a city's share. Each block has a
**Quality**:

| Quality | Builds |
|---|---|
| High | everything |
| Medium | base course and cornice, no enterable houses |
| Filler | plain walls with windows and a cornice; no towers, oriels or balconies |

In the Sketch, the **Detail** layer paints High, Medium or Filler on cells (a block takes the most detailed quality
on any of its cells). **Building detail: auto** makes unpainted blocks within 3 cells of a marker or POI High,
within 8 Medium and the rest Filler. See [compiling.md](../compiling.md#engine-limits-to-know) for measuring a map.

## Stored blocks and handles

Every generated block keeps its footprint and all its options in `she_buildings` on its `func_detail` (by name, so
options added later are kept) and gets a faint blue handle: a plinth 16 units wider than the footprint. Selecting
the handle, or any wall, roof or prop of the block, selects the block; the Selection panel then shows the
generator's options with **Regenerate**, **Re-roll** and **Delete** (and **Select whole block** when handles are
hidden).

- Move (W) and resize (R) rebuild the block when the drag ends; a resize keeps at least 128 × 128. Comma and period
  turn the footprint a quarter turn. Ctrl+D copies the block 256 units along +x.
- Blocks generated together form a **group**; their cables, lamps and trees belong to the group and are rebuilt
  from all its blocks whenever one changes, so no cable is left hanging from a wall that moved.
- The backdrop ring outside a generated city map isn't stored.
