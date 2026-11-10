# Fences

Generate › Fence (key 9 in the menu) draws a fence along points, like roads and powerlines: click A, B, C… on the
ground, Enter or a double click builds it. Every point has a pin: drag it, click a **+** to insert a point, Alt+click a
pin to remove it, Shift+click a pin to branch (a T in the fence). Points stand on the ground; between them the posts,
models and panels follow the ground the way powerline poles do (within 256 units of the straight line).

Code: `src/gen/fences.ts` (spec, layout, building), `src/gen/fenceStore.ts` and `fenceAction.ts` (stored fences),
`src/edit/fencePath.ts`, `fenceTool.ts`, `fenceDoors.ts`, `fencePlan.ts`, `src/ui/fenceOptions.ts`.

## Doorways

A doorway is an opening at a distance along its stretch (from the stretch's first point) with its own width, so it
stays where it is when points move; when a stretch gets shorter it is clamped to fit (the drag note turns amber) but
the stored distance is kept. Inserting a point hands each doorway to the half it is on; removing a point joins its two
stretches' doorways.

- **+ Doorway** next to a stretch in the Doorways list (Generate panel, or the Selection panel of a placed fence) adds
  one in its middle; the list edits where it is, how wide and whether it has a gate.
- In the viewport every doorway has a chip: drag it along the fence to slide the doorway, Alt+click it to remove it.
- A **gate** adds taller gate posts beside the opening (brush fences, wooden models), pillars (walls) or an open
  chain-link gate leaf (`props_c17/gate_door02a`, not solid) on chain-link models. The opening itself stays clear.
- Model fences open whole pieces: a doorway is a whole number of the shortest piece wide (128) and starts a whole
  number of pieces along its stretch, so the pieces either side end exactly at it. The list stores what is built.

## Two ways to build

**Models** (prop_static, `solid 6`): each piece at its own nominal length, end to end from the start of each run
between doorways, the longest that fits first. Neighbours share only their end post (the few units their bounds stand
past the nominal length); pieces are never squeezed, stretched or overlapped more than that.

- **Points snap to whole pieces.** While placing or dragging a point of a model fence it lands a whole number of the
  shortest piece (128 for every style) from the point before it (for A, the point after it), along the line to the
  cursor, so the stretch fits exactly.
- **A stretch that still doesn't fit** (a point typed in the list, a + insert, the stretch after a moved point) is
  **left open at its end** rather than overlapping: the drag note turns amber ("40 u left open at its end"), the
  Doorways list shows "40 u open" on the stretch, and the preview draws a low cross over the open part. The NPC clip
  stops where the pieces stop, so the opening is really open.
- **Corners:** at 90° or more the two stretches share the corner's end post. At a sharper corner the next stretch
  starts past the first one's pieces (half the model's width ÷ tan(half the angle), plus the end post).

The models, all with a `.phy` collision model:

| Choice | Models | Height |
|---|---|---|
| Chain-link (City 17) | `props_c17/fence03a` (256), `fence01a` (128) | 108 |
| Chain-link, tall (wasteland) | `props_wasteland/exterior_fence_notbarbed002d`, `002c` | 132 |
| Chain-link, barbed wire | `props_wasteland/exterior_fence002d`, `002c` | 152 |
| Chain-link panels (interior) | `props_wasteland/interior_fence002d`, `002c` | 128 |
| Wooden planks | `brush/fence_wood_256`, `fence_wood_128` | 131 |
| Wooden boards, tall | `props_forest/fence_border_256`, `fence_border_128` | 160 |
| Wooden rails (trail) | `props_forest/fence_trail_256`, `fence_trail_128` | 64 |

They were picked from the editor's model index (`/api/models`), checked to have both `.mdl` and `.phy` in the mounted
game content (`/api/file`), and their bounds measured with `scripts/model-bounds.mjs`.

**Brushes** (func_detail). Height, post spacing and material are options; every material is in the game's content and
already used by other generators.

| Style | What | Materials |
|---|---|---|
| Chain-link on pipes | posts, panel fitted to the height, top rail | `METAL/METALFENCE004A`, `METAL/METALPIPE001A` |
| Wooden boards | posts, panel | `WOOD/WOODFENCE001`, `WOOD/WOODBEAM001A` |
| Wooden rails | posts, two rails | `WOOD/WOODBEAM002A`, `WOOD/WOODBEAM001A` |
| Metal bars | posts, panel, top rail | `METAL/METALFENCE003A`, `METAL/METALPIPE001A` |
| Short wall, concrete | 48 high, 16 thick, coping | `CONCRETE/CONCRETEWALL001A`, coping `CONCRETE/CONCRETEFLOOR027A` |
| Short wall, brick | 48 high, 16 thick, coping | `BRICK/BRICKWALL001A`, coping `CONCRETE/CONCRETEFLOOR027A` |
| Wall, full height | 192 high, 16 thick, coping | `CONCRETE/CONCRETEWALL001A` |
| Low wall with railing | 32 high wall, coping, 44 pipe railing | `CONCRETE/CONCRETEWALL001A`, `METAL/METALPIPE001A` |
| Picket fence | posts, two rails, pickets every 10 | `WOOD/WOODWALL009A`, `WOOD/WOODBEAM001A` |
| Metal guardrail | posts every 96, a beam 18–30 up | `METAL/METALWALL001A`, `METAL/METALPIPE001A` |

**Walls** are solid brushes segmented at the points (and where the ground bends), mitred where two stretches meet
(no gap, no overlap), square at doorways; a branch stops at the face of the wall it leaves. The coping is a toggle.
A doorway with a gate gets pillars that take the ends of the wall beside it, so the opening keeps its width. Wall
faces are textured along the wall, top-aligned.

## Units and the navmesh

Recast reads world brushes and static props with VPhysics collision (`recast_mapmesh.cpp`), so both modes block units.
**NPC clip** (on by default) also runs a strip of `TOOLS/TOOLSNPCCLIP` along the fence (world brushes, like the stairs'
clip), not across doorways, so units can't slip under rails or through the joints between models. **Walls get none**:
a solid func_detail wall at least 32 high blocks units by itself (Recast's step height is 18), so the option is hidden
for them.

## Stored

The spec lives on the fence's func_detail (`she_fence`; brush pieces are its brushes, a model fence's has none),
`she_fence_id` ties the props and the handle to it and `she_fence_world` lists the clip. The handle is a small box at A:
select it (or click anything the fence made) for the fence's panel; the gizmo moves the whole fence, Ctrl+D duplicates
it, Delete removes it. Every change rebuilds exactly what it made, as one undo step. Compiles strip the handle, the
settings keys and a func_detail left without brushes.

In the top view a fence is a few units thin, so placed fences also get a tan line along their runs with a bracket at
each side of a doorway (drawn only in the top view).

Tests: `tests/fences.test.ts`, `scripts/fence-points-test.mjs`.
