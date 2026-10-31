# Map polish: surroundings, blending, street materials, free shapes

Four points from playing "Garden District", each a phase, done in this order. Every phase ends with editor and
in-game screenshots and its own commit; the last step rebuilds Garden District with all of it.

## What was wrong

1. **A floating island.** Past the playable area there is a 512-unit apron of flat ground and then nothing, so
   at the map edge the RTS camera sees the world end. City16 is closed by Combine wall clusters, other maps by
   hills or by the city simply going on.
2. **Generated parts look dropped in.** The park is a grass rectangle laid on the square's paving with a hard
   straight edge and a dry, dark, empty pond; the parking lot is an asphalt rectangle with one short row of cars,
   a lone shed and a lone concrete barrier. Nothing ties them to what is around them.
3. **One look for every street.** Carriageway, pavement and kerb materials are fixed per road style. The pavement
   in the reference (square slabs, a stone gutter strip, rounded kerbs at the corners, a planter with a railing)
   can't be made.
4. **Everything is square.** The sketch paints cells, so streets, squares and blocks are axis-aligned rectangles;
   no diagonal or curved street, no round square, no block that follows a bend.

## Phase 1: surroundings beyond the playable area

`src/gen/surroundings.ts`, used by the sketch (a Surroundings row per map, and per side) and by Generate map:

| Style | What is built in the band outside the boundary |
|---|---|
| City | The city goes on: the streets that reach the map edge run on out, with pavements, parked cars and lamps; the blocks between them get plain filler buildings (walls with window textures, flat or pitched roofs) that grow taller towards the band's outer edge, so the skyline closes the view |
| Hills | The terrain rises away from the edge (a smooth ramp with noise, grass to rock with height) with pine and leafy trees scattered over it |
| Combine wall | A Combine wall of the City16 wall clusters a little outside the edge, a strip of ground in front of it, the filler skyline behind it |
| None | The old flat apron |

- The band is 2048 wide by default (the RTS camera at the edge sees about that far); the sky shell moves out with
  it. Units can't leave: the boundary keeps an NPC clip wall at the playable edge.
- vbsp's limits: everything in the band is a brush entity or a prop (free for the t-junction buffer), simple
  boxes with few vertexes. Measured with `scripts/tjunc-budget.mjs`.
- Tests: the band stays outside the playable area, streets continue where they reach the edge, nothing overlaps.

## Phase 2: blending generated parts into their surroundings

- **Edges between surfaces** (sketch generator): where a lawn meets paving, a low stone edging; where paving
  meets a road, the kerb; dirt, leaf and stain overlays along every such edge so the change of material reads as
  worn rather than cut.
- **POIs take the ground they stand on**: a POI on paved or road cells keeps that surface (parking bays are
  painted on the square's paving instead of an asphalt pad), with its own surface only where it needs one, and
  then bordered like the edges above.
- **Park**: the pond becomes a fountain with water, a basin rim and a statue; paths meet the paths and pavements
  outside; hedges along the border with gaps at the paths.
- **Parking**: full rows (70 to 90% of the bays taken, cars of mixed colours both ways in), kerb islands with a
  tree or a lamp at the row ends, a pay booth with a barrier arm at the entrance. No lone sheds or barriers.
- Tests: no pad stands higher than its surroundings where it inherits, rows are full, the fountain holds water.

## Phase 3: street and pavement materials

- **Material sets** (`src/gen/streetMaterials.ts`): carriageway (asphalt, worn asphalt, setts, cobbles), pavement
  (square slabs as in the reference, concrete, small tiles, cobbles), kerb stone, gutter strip; each set has a name
  and a preview swatch.
- **Where to choose**: per map in the sketch (Streets section: carriageway, pavement, kerb, gutter), per road in
  the road panel, and as POI and square surfaces.
- **The reference pavement**: slabs with a stone gutter strip between kerb and carriageway, kerbs rounded at the
  street corners (the crossing's corner pieces follow an arc), planters with a low railing as an optional street
  feature.
- Tests: every set's materials exist in the game's material list; corners are arcs; a road keeps its set when it
  is rebuilt.

## Phase 4: free shapes

- **A Shapes layer in the sketch**: lines and outlines drawn over the cell grid, on top of the painted cells.
  - *Street*: a polyline with a width; built by the road generator, so diagonal and curved streets get kerbs,
    pavements and rounded bends. The cells under it count as street.
  - *Area*: a polygon or an ellipse with a surface (paved, grass, water): round squares, curved lawns, ponds.
  - Both snap to the 128 grid at their points, not their edges.
- **Blocks follow the shapes**: a block's lots are cut by the streets and areas that cross it, so buildings get
  diagonal or curved fronts (the facade code already lays windows along any edge, as on cut and rounded corners).
- **Smoother painted edges**: where painted surfaces step diagonally cell by cell, the generator cuts the corner
  (a diagonal edge instead of a staircase).
- Tests: a diagonal street splits a block into two blocks whose lots stay inside it; an ellipse area makes a
  convex outline; facades on a slanted edge get windows.

## Last: Garden District again

Rebuilt with city surroundings (a Combine wall on the north side), the slab pavement and setts, a round fountain
square in front of the palace, a curved street past the park and a diagonal street to the garden, the blended park
and parking. Budget, final compile, in-game screenshots.
