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

### Phase 6: UI/UX improvements

- **Top view** (T): orthographic, north up, right drag pans and the wheel zooms to the cursor. All tools work in it.
- **Box selection**: drag on empty space with the Select tool (Shift adds), in the 3D and top view.
- **Hover feedback**: the object under the cursor gets an outline, and the status bar names it (class,
  targetname, material, owning brush entity).
- **Copy and paste at the cursor** (Ctrl+C / Ctrl+V), also between maps.
- **Hide / unhide** (H / U) for editing only; hidden objects are still saved and compiled.
- **Outliner** in the Map tab: entities grouped by class, searchable, click to select and frame.
- **Autosave** every minute while there are unsaved changes, to `.autosave/` ("Autosaves" in the map picker).
- Shortcut overlay (?), view and status details in the status bar.

![Top view with hover](docs/screenshots/phase6-top-view-hover.png)
![Box selection in progress](docs/screenshots/phase6-box-select-dragging.png)
![Box selection result](docs/screenshots/phase6-box-selected.png)
![The selection hidden in the 3D view](docs/screenshots/phase6-hidden-selection.png)
![Paste at the cursor](docs/screenshots/phase6-copy-paste-at-cursor.png)
![Outliner](docs/screenshots/phase6-outliner.png)
![Shortcut overlay](docs/screenshots/phase6-shortcuts.png)

### Phase 7: scripting (entity I/O)

Map scripting in Source is done with entity inputs and outputs. The editor now edits them directly:

- **Outputs editor** in the Selection tab: output, target, input, parameter, delay and "once" per row.
  Outputs and inputs are drop-downs filled from the game's FGD (including inherited ones such as `Kill`),
  and target names autocomplete from the map. A **Fired by** list shows what triggers the selected entity.
- **Validation**: missing targets, unknown outputs and inputs are flagged on the row and listed in the new
  **Logic** tab.
- **Logic graph**: every connection in the map as a left-to-right graph; click a node to select and frame it.
- **Connection lines** in the viewport for the selected entity (orange: outputs, blue: incoming).
- **Tie to entity** (Ctrl+T for `trigger_once`): turns selected brushes into a trigger, `func_detail`,
  `func_brush`, fog-of-war or navmesh blocker; **Move brushes to world** reverses it.
- Connections are read and written in Hammer's ESC-separated format (commas in old maps are read too);
  rewriting every connection in `sp_radio_tower` reproduces the file byte for byte.

![Logic graph of sp_radio_tower](docs/screenshots/phase7-logic-graph.png)
![An objective's outputs and incoming connections](docs/screenshots/phase7-objective-io.png)
![A mistyped target flagged](docs/screenshots/phase7-broken-target.png)
![A trigger wired to a message box and an objective](docs/screenshots/phase7-trigger-outputs.png)
![Logic graph of the scripted arena](docs/screenshots/phase7-arena-graph.png)

### Phase 8: Lambda Wars entities and mission scripting

A **Mission** tab with Lambda Wars kits, placed with the kit tool (5). Each kit creates the entities a
feature needs and wires their outputs, as one undo step:

| Kit | Creates |
|---|---|
| Capture point | `control_point` (flag) + `trigger_capture_area` with the chosen radius, owner and capture time |
| Multiplayer start | `info_start_wars` (HQ spawn, team hint) + its `info_player_wars` camera |
| Mission player start | camera spawn, `wars_player_setup` (faction, colour, applied at start) and a starting squad |
| Unit group | N units of a type (zombies, Combine, Metropolice, rebels, ...) for an owner, with a shared name |
| Attack wave | `unit_maker` → `wars_give_order` → `info_target` goal; starts disabled so a trigger can enable it |
| Mission message | `wars_messagebox`, shown at map start through a shared `logic_auto` or wired to a trigger |
| Objective | `wars_mission_objective`; "completing wins" wires it to the map's `wars_win_condition` |

- **Apply standard relations** makes the player hate every other unit owner (`wars_player_relation` +
  `ApplyRelation` at map start), as the shipped missions do.
- Mission title and description are stored on worldspawn; compiling a map named `sp_*` writes the
  `maps/<name>.res` entry the game's mission list reads.
- **Gameplay overlay**: capture-area rings coloured by owner, base rings around player starts, and the route
  from each wave to its goal.
- Camera spawns account for the game forcing the spawn camera to pitch 65°, yaw 135°
  (`GetPlayerSpawnSpot`), so the camera looks at the start position.
- Launching an `sp_` map uses the mission gamerules (a listen-server config runs `wars_setgamerules mission`).

![Kits placed in the arena](docs/screenshots/phase8-kits-placed.png)
![Wave route and capture ring](docs/screenshots/phase8-wave-and-capture-ring.png)
![Mission summary](docs/screenshots/phase8-mission-summary.png)
![Mission compiled](docs/screenshots/phase8-compiled.png)

### Phase 9: lighting preview

**Lighting** (top bar, or L) switches the viewport from flat editor lighting to an approximation of the
compiled result:

- The sun from `light_environment` (pitch, yaw, colour, brightness) with real-time shadows from brushes and
  props, and its `_ambient` as the sky fill.
- `light`, `light_spot` and Lambda Wars' `light_deferred` entities as point and spot lights. A fixed pool
  (24 point, 8 spot) is assigned to the lights nearest the camera, so moving never triggers shader rebuilds.
- Sun height, direction, colour and ambient sliders in the Map tab edit `light_environment` live
  (one undo step per drag). Point, spot and dynamic lights are in the Entities palette.
- City16 with sun shadows runs at about 180 FPS.

![Editor lighting](docs/screenshots/phase9-editor-lighting.png)
![Lighting preview of the same view](docs/screenshots/phase9-preview-lighting.png)
![Low evening sun from the sliders](docs/screenshots/phase9-low-sun.png)
![Night with placed point and spot lights](docs/screenshots/phase9-night-lights.png)
![Lighting controls](docs/screenshots/phase9-lighting-panel.png)

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
