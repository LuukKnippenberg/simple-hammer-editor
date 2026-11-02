# Roads and powerlines

Both are drawn as a line of points: pick **Road** (key 7) or **Powerline** (key 9), or choose them in the Generate
menu, then click points. They snap to the grid (road points also snap onto existing roads to join them). Enter or a
double click builds, Backspace removes the last point, Escape steps back.

## Roads

Code: `src/gen/roads.ts`, `src/gen/streetMaterials.ts`.

| Style | Surface | Kerbs and pavements | Default width |
|---|---|---|---|
| Asphalt road | the game's asphalt with a dashed centre line | 8-unit kerbs, paving slabs | 256 + 2 × 96 |
| Cobbled street | cobble | yes | 192 + 2 × 64 |
| Tram street | cobble with two tracks of steel rails | yes | 320 + 2 × 96 |
| Dirt track | dirt, almost flush with the ground | none | 160 |

- **Corners** are rounded with a set radius, so every piece stays a small convex brush; slopes follow the points'
  heights. Long straights are cut into 512-unit pieces. Roads are `func_detail` and store their points and settings
  in `she_road`.
- **Crossings**: all roads are rebuilt together. The earlier road's surface wins where carriageways overlap, and
  kerbs and pavements give way to other roads, which opens T-junctions and crossings. Rails stay on top.
- **Rounded kerbs**: where two straight streets with kerbs cross or meet, the corner squares are cut out of kerbs
  and pavements and filled with a fillet of carriageway, a curved kerb and a quarter disc of pavement.
- **Editing**: selecting a road (or any of its brushes) shows the Road panel: style, width, pavement, corner radius
  and the street materials. Changes rebuild all roads. **Blend into ground** paints a worn dirt verge along both
  outer edges (or the whole width under a dirt track) on displacement terrain.

### Street materials

Every part of a street can be chosen, per road in the Road panel or for the whole map in the Sketch's *Street look*:

| Part | Choices |
|---|---|
| Carriageway | asphalt (with the centre line), worn asphalt, setts, cobbles, concrete |
| Pavement | concrete, square slabs, large slabs, small tiles, bricks, cobbles |
| Kerb | concrete, stone, granite |
| Gutter | none, or a strip of setts, cobbles or concrete along each kerb |
| Round kerbs | a radius for the kerbs at street corners |

Ready-made sets: *City 17*, *Old town* (setts, square slabs, stone kerbs, cobbled gutters, round corners),
*Boulevard* (worn asphalt, large slabs, granite, setts gutters) and *Cobbled lane*.

A pavement's texture runs along the road and starts at the kerb, with whole tiles across its width, so slabs line
up and their borders run along both edges; a rounded corner's quarter disc carries on from its street. The setts
gutter shows only the setts strip of its texture.

### Roads in generated maps

Road cells in the Sketch and Generate map become roads through the same code: asphalt with kerbs and pavements in
the city, dirt tracks in the countryside, longest roads first so they run through junctions. Pavements stop 6 units
short of the building line, because pavements overlapping the buildings' base course push large maps past vbsp's
t-junction limit; drawing a pavement into a base course by hand can still do that. Bollards and parked cars are
only placed where the ground is pavement (`roadGround` knows the corner pieces).

## Powerlines

Code: `src/gen/powerlines.ts`. Poles stand at even spacing per leg and at every bend (turned to bisect it), on the
ground under each point. A sagging rope runs per wire from pole to pole (`move_rope` → `keyframe_rope` chains) and
is drawn in the viewport.

| Poles | Model | Wires |
|---|---|---|
| Wooden, two wires | `props_forest/utilitypole01b` | 2 |
| Wooden, three wires | `props_forest/utilitypole01d` (prop_dynamic) | 3 |
| Wide crossarm | `props_forest/utilitypole03a` (prop_dynamic) | 4 |
| City pole, side arm | `props_c17/utilitypole02b` | 2 |

- The pole models have no attachment points; the wire positions were measured from their geometry.
- **House feeds** (on by default): from each pole a wire runs to the nearest wall within 480 units, found by
  raycasting the map, and ends on the outer insulator of a wall bracket (`wallMount`) turned out from that wall.
- **Spacing** and **sag** are in the tool options. Selecting any pole or rope shows the Powerline panel (pole type,
  spacing, sag, feeds, delete); changes rebuild the whole line. The first pole stores the route.
- `utilitypole01a`, `01d` and `03a` were moved in the game's files without being recompiled, so vbsp can't load
  their vertex data as static props. The model loader reads their compiled-in name, and the compile dialog's static
  prop check converts them to `prop_dynamic`.
