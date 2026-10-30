# simple-hammer-editor

A simple, browser-based map editor for **Lambda Wars** (Source Engine, Alien Swarm branch), built on
three.js. It reads and writes Hammer `.vmf` files, so maps stay compatible with Hammer for fine-tuning,
and hands compiling to the regular Source SDK tools.

## Running

```bash
npm install
npm run dev        # http://localhost:5190
```

The dev server also serves game assets (materials, models) and runs the map compilers, so it needs a
local Lambda Wars install. Paths are auto-detected; override them in `editor.config.json`
(see `editor.config.example.json`).

| Setting | Default | Used for |
|---|---|---|
| `gameDirs` | `lambdawars-game` dev clone, then the Steam `Lambda Wars` install | Loose files and VPKs for textures and models |
| `sdkBinDir` | `Alien Swarm/bin` in any Steam library | `vbsp.exe`, `vvis.exe`, `vrad.exe` |
| `runGameDir` | first game dir with `lambdawars.exe` | Where compiled maps go and the game is launched from |

Maps are listed from this repo's `maps/` folder and from the game's `mapsrc/` folder.

### Controls

| Input | Action |
|---|---|
| Right mouse drag | Look around |
| W A S D, E / Space, Q | Fly (hold Shift for faster) |
| Middle mouse drag | Pan |
| Alt + left drag | Orbit around the point under the cursor |
| Mouse wheel | Zoom towards the cursor |
| 1 / 2 / 3 / 4 | Select, Block, Paint, Entity tool |
| M / R | Gizmo: move / resize |
| Shift + click | Add to selection |
| Ctrl + D, Delete | Duplicate, delete |
| Ctrl + Z, Ctrl + Y | Undo, redo |
| [ and ] | Grid size |
| , and . | Rotate entities (Shift: 90°) |
| F | Focus the selection |
| Ctrl + S | Save |

## Phases

Development is split into phases; each phase ends with screenshots in `docs/screenshots/`.

### Phase 0: VMF loading and brush geometry

- KeyValues parser shared by VMF and VMT files.
- Brush faces built by clipping each side's plane against the others; displacements built from `dispinfo`.
- World geometry merged into one mesh per material (about 140 draw calls for a full map), with a BVH for picking.
- Editor camera, map picker, tool/sky brush toggles, wireframe, and an FPS/draw-call overlay.

![Phase 0 overview](docs/screenshots/phase0-overview.png)
![Phase 0 close-up](docs/screenshots/phase0-closeup.png)
![Phase 0 tool brushes and wireframe](docs/screenshots/phase0-tool-brushes.png)

### Phase 1: textures, displacements, entities and props

- VMT parsing (including `patch` materials and `%compile*` tool flags) and a VTF decoder for every common
  format. DXT textures go to the GPU compressed; mip chains are kept.
- `WorldVertexTransition` displacements blend their two textures by the painted vertex alpha.
- MDL/VVD/VTX loader for props (LOD 0, skins, multiple `$cdmaterials`), drawn as instanced meshes:
  346 props from 94 models in under 100 extra draw calls.
- Point entities are colour-coded markers (green spawns, orange control points, yellow lights, ...).
- Sun direction and colour come from `light_environment`, the background from `env_fog_controller`.

![Phase 1 overview](docs/screenshots/phase1-overview.png)
![Phase 1 centre control point](docs/screenshots/phase1-center-control-point.png)
![Phase 1 RTS camera over a base](docs/screenshots/phase1-rts-camera-base.png)
![Phase 1 street level](docs/screenshots/phase1-street-level.png)
![Phase 1 displacement blend](docs/screenshots/phase1-displacement-blend.png)

### Phase 2: writing VMF files

- KeyValues nodes keep pairs and child blocks in one ordered list, so a parse → write round-trip is
  byte-identical. Verified by the test suite against the sample map and all 54 VMFs in the game's `mapsrc/`.
- Edits go through typed wrappers (`MapSide`, `MapSolid`, `MapEntity`) that write back into the tree, so
  anything the editor does not understand (visgroups, editor colours, connections, cameras) survives.
- Save (Ctrl+S), Save as and Download. Saves go to this repo's `maps/` folder and bump `mapversion` like
  Hammer does; the game's own `mapsrc/` is never overwritten.
- Document panel with a "Verify round-trip" check. Changed brushes rebuild incrementally (about 3 ms).

![Phase 2 round-trip verified](docs/screenshots/phase2-roundtrip-verified.png)
![Phase 2 edited, unsaved](docs/screenshots/phase2-edited-unsaved.png)
![Phase 2 saved and reloaded](docs/screenshots/phase2-saved-and-reloaded.png)

### Phase 3: editing tools

- **Select**: click picks a brush or entity (Shift adds); a move/resize gizmo snaps to the grid, with
  texture lock while moving. Brushes inside brush entities can be picked one by one.
- **Block**: drag a rectangle on any surface to create a brush with the current material and height.
- **Paint**: click a face to apply the current material (Shift: whole brush, Ctrl: pick a material).
- **Entity**: click to place the class chosen in the Entities tab. A control point automatically gets its
  `trigger_capture_area`. Entity classes, keys, choices and editor models come from the game's FGD.
- Inspector with FGD-typed entity fields and brush size inputs; material browser with thumbnails decoded
  from the VTFs; undo/redo; duplicate; delete.
- Fixed brush picking after BVH construction (triangle order changes inside the BVH).

The screenshots below were taken by `scripts/phase3-demo.mjs`, which builds a small arena from an empty
map with real mouse and keyboard input (it is saved as `maps/phase3_arena.vmf`).

![Drawing a wall with the block tool](docs/screenshots/phase3-block-tool-drawing.png)
![Blocks created](docs/screenshots/phase3-blocks-created.png)
![Moving with the gizmo](docs/screenshots/phase3-move-gizmo.png)
![Resizing with the gizmo](docs/screenshots/phase3-resize-gizmo.png)
![Painting with the material browser](docs/screenshots/phase3-paint-materials.png)
![Entities and the FGD-driven inspector](docs/screenshots/phase3-entities-inspector.png)
![Live editing in the large sample map](docs/screenshots/phase3-select-in-city16.png)

### Phase 4: compile and test in game

- **Compile & test** dialog with pre-flight checks and one-click fixes: a sealing sky shell of world
  brushes, a `light_environment`, a spawn point, player starts, and a `func_map_boundary` (camera limits
  and fog-of-war height data).
- The dev server runs the Alien Swarm SDK tools against the full game install: `vbsp`, `vvis` (skipped,
  with a warning, when the map leaks) and `vrad -hdr` (Lambda Wars maps use HDR lighting only), then
  installs the BSP into `lambdawars/maps/`. The tool output streams into the dialog.
- The Recast navmesh is built headless: a hidden `srcds.exe` loads the map and runs `recast_build` from
  a temporary server config; the editor stops it once all five meshes are saved. The fog-of-war heightmap
  is written by the server on the same load.
- **Launch game** starts Lambda Wars windowed on the compiled map.

The Phase 3 arena compiles in about 8 seconds including the navmesh, and loads in game (last screenshot).

![Checks before fixing](docs/screenshots/phase4-checks-before.png)
![Checks after Fix all](docs/screenshots/phase4-checks-fixed.png)
![Compiled, with the navmesh log](docs/screenshots/phase4-compiled.png)
![Sky shell and map boundary added by the fixes](docs/screenshots/phase4-shell-and-boundary.png)
![The compiled arena running in Lambda Wars](docs/screenshots/phase4-ingame.png)

Known issue on the development machine: the game's in-game web UI (CEF) failed to start its helper
process (`lambdawars_browser.exe`) on every launch, also when launched by hand, so the HUD stays on
"Loading CefViewPort". The map itself loads and renders.

### Phase 5: generators

**Map generator** (top bar → *Generate map*): paint a coarse layout on a grid of 256-unit cells (ground,
road, high ground, buildings, trees, player base, control point, scrap) with rotational or mirror symmetry,
or roll a random two-player layout, then generate a complete map:

- Displacement terrain over the whole map: high-ground cells become smoothed plateaus, roads and bases are
  blended into the ground texture through vertex alpha (grass/dirt for rural, concrete for city).
- Buildings on building cells (see below), trees in forest cells, bushes and rocks or cars, lamps and
  barriers along the roads.
- Player starts with their RTS camera spawns, control points with capture areas, scrap markers, sun, fog.
- A scenery apron outside the playable area (forest or city blocks), the sealing sky shell and the
  `func_map_boundary`, so a generated map passes every compile check without fixes.

**Building generator** (select one or more block brushes → *Generate buildings* in the Selection tab):
splits the footprint into lots on the 128-unit facade grid and builds each one with a facade style from the
game's `building_template` materials (one texture tile is exactly one floor), a ground floor with doors,
a cornice, a parapet and optional rooftop props. With alleys enabled, neighbouring buildings get 64-unit
alleys and sky bridges. One undo step reverts the whole operation.

The generated city map (`maps/phase5_city.vmf`) compiles in about 20 seconds including the navmesh and
loads in Lambda Wars (last screenshot; the HUD is stuck on the CEF issue described in phase 4).

![Layout painter](docs/screenshots/phase5-layout-painter.png)
![Generated rural map](docs/screenshots/phase5-rural-overview.png)
![Rural map near a player base](docs/screenshots/phase5-rural-base-closeup.png)
![City layout](docs/screenshots/phase5-city-layout.png)
![Generated city map](docs/screenshots/phase5-city-overview.png)
![Generated city buildings](docs/screenshots/phase5-city-buildings.png)
![A hand-drawn block, selected](docs/screenshots/phase5-block-selected.png)
![Buildings generated from the block](docs/screenshots/phase5-buildings-generated.png)
![Building close-up](docs/screenshots/phase5-buildings-closeup.png)
![Generated city compiled, all checks green](docs/screenshots/phase5-city-compiled.png)
![Generated city running in Lambda Wars](docs/screenshots/phase5-city-ingame.png)

## Development

```bash
npm test           # unit tests (vitest)
npm run typecheck
npm run screenshot -- scripts/shots/phase0.json   # needs the dev server running
node scripts/phase3-demo.mjs                      # scripted editing session with screenshots
node scripts/phase4-demo.mjs [map] [prefix]        # compile checks + compile through the dialog
node scripts/phase5-demo.mjs                      # map and building generators
powershell -File scripts/capture-window.ps1 -Out shot.png   # in-game screenshot of the game window
```
