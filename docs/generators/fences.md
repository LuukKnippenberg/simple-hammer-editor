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
- A **gate** adds taller gate posts beside the opening (brush fences, wooden models) or an open chain-link gate leaf
  (`props_c17/gate_door02a`, not solid) on chain-link models. The opening itself stays clear.

## Two ways to build

**Models** (prop_static, `solid 6`): the longest piece that fits, then shorter ones, end to end along each run between
doorways (the leftover is shared between the joints). The models, all with a `.phy` collision model:

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

**Brushes** (func_detail): posts at about the post spacing, with a panel (the material fitted to the panel's height,
textured along the fence) or rails between them. Styles: chain-link on pipes (`METAL/METALFENCE004A`), wooden boards
(`WOOD/WOODFENCE001`), wooden rails (`WOOD/WOODBEAM002A`) and metal bars (`METAL/METALFENCE003A`); posts
`METAL/METALPIPE001A` or `WOOD/WOODBEAM001A`. The panel material can be changed (all alpha-tested fence materials in
the list are 512 × 512 and exist in the game). Height and post spacing are options.

## Units and the navmesh

Recast reads world brushes and static props with VPhysics collision (`recast_mapmesh.cpp`), so both modes block units.
**NPC clip** (on by default) also runs a strip of `TOOLS/TOOLSNPCCLIP` along the fence (world brushes, like the stairs'
clip), not across doorways, so units can't slip under rails or through the joints between models.

## Stored

The spec lives on the fence's func_detail (`she_fence`; brush pieces are its brushes, a model fence's has none),
`she_fence_id` ties the props and the handle to it and `she_fence_world` lists the clip. The handle is a small box at A:
select it (or click anything the fence made) for the fence's panel; the gizmo moves the whole fence, Ctrl+D duplicates
it, Delete removes it. Every change rebuilds exactly what it made, as one undo step. Compiles strip the handle, the
settings keys and a func_detail left without brushes.

In the top view a fence is a few units thin, so placed fences also get a tan line along their runs with a bracket at
each side of a doorway (drawn only in the top view).

Tests: `tests/fences.test.ts`, `scripts/fence-points-test.mjs`.
