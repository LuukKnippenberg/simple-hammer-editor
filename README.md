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
| `install` | the Steam `Lambda Wars` install (the first one with VPKs) | The install maps are compiled against, copied to and launched from. Its assets and entity definitions come first. |
| `installs` | `lambdawars-game` and `Lambda Wars` in any Steam library | Extra installs to choose from: paths, or `{ "name", "dir" }` |
| `gameDirs` | the active install, then the other installs | Where textures and models are looked up (the other installs fill in what the active one lacks) |
| `sdkBinDir` | `Alien Swarm/bin` in any Steam library | `vbsp.exe`, `vvis.exe`, `vrad.exe` |

Pick the install with the **Game** dropdown at the right of the top bar, for example the Steam install
or a dev clone of the game repo. The editor saves the choice to `editor.config.json` and reloads,
keeping unsaved work as an autosave.

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
- Sun height, direction, colour and ambient sliders edit `light_environment` live (one undo step per
  drag; now in the Settings tab, see below). Point, spot and dynamic lights are in the Entities palette.
- City16 with sun shadows runs at about 180 FPS.

![Editor lighting](docs/screenshots/phase9-editor-lighting.png)
![Lighting preview of the same view](docs/screenshots/phase9-preview-lighting.png)
![Low evening sun from the sliders](docs/screenshots/phase9-low-sun.png)
![Night with placed point and spot lights](docs/screenshots/phase9-night-lights.png)
![Lighting controls](docs/screenshots/phase9-lighting-panel.png)

### Phase 10: 2D map drawing with height layers

**Sketch** (top bar) opens a 2D painter for drawing a map from above on a grid of 128-unit cells, with
separate layers:

| Layer | Paints |
|---|---|
| Height | Levels 0–4 (level height configurable, default 128). Level changes become cliffs; **Ramp** cells turn a step into a walkable slope. |
| Surface | Grass, dirt, road, cobble, rubble: blended into the terrain through displacement alpha. |
| Features | Buildings (on their cell's level, floors and facade configurable), trees, walls, debris, cars. |
| Markers | Mission start, multiplayer start, capture point, scrap, zombie and Combine groups, Combine wave, rebels: placed with the phase 8 kits. |

Brush, rectangle and fill tools, brush sizes, mirror/rotational symmetry, undo, and city/rural themes.
**Generate 3D map** builds power-4 displacement terrain (32-unit vertices: cliffs stay sharp, ramps are
solved as smooth surfaces between the levels around them), the features, markers, lighting, sky shell and
map boundary. The sketch is saved next to the map as `maps/<name>.sketch.json` and reopened with it, so
a map can be redrawn and regenerated. The example below compiles sealed with a navmesh in 11 seconds.

![Height layer: plateau, hill and ramps](docs/screenshots/phase10-sketch-height.png)
![Complete sketch with roads, buildings, trees and markers](docs/screenshots/phase10-sketch-complete.png)
![Generated map](docs/screenshots/phase10-generated-overview.png)
![Road up the ramp through the cliff](docs/screenshots/phase10-generated-cliff-ramp.png)
![Generated map with the lighting preview](docs/screenshots/phase10-generated-lit.png)

### Phase 11: decals

- **Rendering**: `infodecal` entities are projected onto the nearest surface (short rays from the origin,
  like the engine), sized by texture size × `$decalscale` and oriented like Source does (upright on walls,
  world-X on floors). `info_overlay` entities are drawn from their basis and corner UVs and **clipped to
  the brush faces in their `sides` list**, as vbsp does. Decals are batched per material; City16's 119
  decals and 21 overlays add 11 draw calls.
- **Decal tool** (6) with a **Decals** mode in the Materials tab (decals and overlays folders, alpha-aware
  thumbnails). Two placement types:
  - *Decal*: an `infodecal` at the clicked point; the size comes from the material.
  - *Overlay*: an `info_overlay` with a chosen size and rotation; the clicked face and the coplanar faces it
    covers are written to `sides`.
- Moving an overlay moves its basis with it; a **Decals** toggle hides them all.
- The decal map compiles with both overlays in the BSP's overlay lump.

![City16 without decals](docs/screenshots/phase11-city16-decals-off.png)
![City16 with its decals and overlays](docs/screenshots/phase11-city16-decals-on.png)
![Posters, crater, blood, trash and graffiti placed in the arena](docs/screenshots/phase11-arena-decals.png)
![An overlay clipped to the block it covers](docs/screenshots/phase11-overlay-closeup.png)

### Additions found while building the Sofia map

- **Block shapes**: the Block tool draws boxes, cylinders, cones/spires and domes (stacked convex
  frustums) with a configurable number of sides.
- **Static prop check**: the MDL loader reads `$staticprop` and physics `prop_data`; the compile dialog
  flags `prop_static` entities that vbsp would delete and converts them to `prop_dynamic` in one click.
- **RTS camera ground**: the map boundary floor now sits at ground level and sketch maps add playerclip
  blocks over raised levels. The game's spawn camera traces down to playerclip, so this keeps the camera
  at the right height (shipped maps do the same).
- Decals can be placed along a world-space ray (`placeDecalRay`) for scripted map building.

### Map settings

The **Settings** tab gathers the map-wide setting entities into cards with sliders, colour pickers and
file pickers:

| Card | Entity | Added when compiling |
|---|---|---|
| Sky | worldspawn `skyname` | always set |
| Sun & ambient light | `light_environment` | yes |
| Dynamic shadows | `shadow_control` | yes |
| Fog | `env_fog_controller` (master) | yes |
| Exposure & bloom | `env_tonemap_controller` + `logic_auto` | yes |
| Colour correction | `color_correction` (global, lookup table picker) | |
| Post-processing | `postprocess_controller` (master) | |
| Dynamic sun (deferred) | `light_deferred_global` | |
| Wind, Detail props, Water quality, Music | `env_wind`, `env_detail_controller`, `water_lod_control`, `wars_music_controller` | |

- Settings are stored as the standard entities, so Hammer and existing maps work as before; City16's
  own fog, tonemap and colour correction show up in the cards. Their markers are not drawn in the viewport.
- A card marked **Default** isn't in the map yet: compiling adds it with defaults taken from the shipped
  maps (to the compiled copy only). Changing a value stores it in the map; the switch turns a setting
  off, and a default one then stays out of the compile (`she_settings_off` on worldspawn).
- Exposure and bloom have no entity keys: like the shipped maps, a `logic_auto` sends
  `SetAutoExposureMin/Max`, `SetBloomScale` and `SetTonemapRate` to the controller on map spawn. The card
  reads and edits that wiring, including maps that use `OnNewGame`.
- The lighting preview (L) also shows the fog.

![Map settings on the Sofia map, with fog in the lighting preview](docs/screenshots/settings-sofia.png)
![A new map: four settings marked Default, added when compiling](docs/screenshots/settings-new-map.png)

## Building generator: City 17 architecture

The phase 5 generator made one box per lot. These phases rebuild it after the architecture of Half-Life 2's
City 17 (shaped corners, real roofs, layered facades); each one is usable from the Building panel,
Generate map, Sketch and the Sofia script.

### Building phase 1: footprints and corners

- **Block planner** (`src/gen/buildingPlan.ts`): blocks of 896+ units become a ring of buildings around a
  courtyard (corner buildings, lots along each side); smaller blocks become a row of lots, deep lots
  sometimes L-shaped around a back yard. Buildings vary in height, corner buildings tend to be a floor taller.
- **Corners**: buildings on a block corner get a square, 45° cut or rounded corner (radius 128–256, built
  from 64-unit segments). Cut and rounded faces get entrance doors on the ground floor.
- **Whole windows on every face** (`src/gen/facade.ts`): each wall's texture starts at its corner and is
  stretched slightly so it shows a whole number of window bays, so angled and curved faces never cut a
  window in half.
- **Annexes and walls**: one- and two-storey sheds in courtyards and yards, and a wall with a gateway on
  one side of most courtyards.
- Building panel options: corners (mixed, cut, rounded, square), courtyards, annexes.
- A 32-building test set (alleys, sky bridges, gates) compiles through vbsp, vvis and vrad without errors.

Before: [the phase 5 boxes](docs/screenshots/phase5-buildings-generated.png).

![Five blocks: two courtyard rings, L-shaped lots, shaped corners](docs/screenshots/buildings-p1-overview.png)
![A courtyard with a shed, closed by a wall with a gateway](docs/screenshots/buildings-p1-courtyard.png)
![A rounded corner: one window per segment, an arcade of doors](docs/screenshots/buildings-p1-round-corner.png)
![A cut corner with its entrance](docs/screenshots/buildings-p1-cut-corner.png)

### Building phase 2: facade relief

Decoration is built as `func_detail` (it doesn't cut visibility), on a **Detail** setting in the Building
panel; the building shells stay world brushes. Decoration draws from its own random sequence, so changing
the level never changes the layout or textures.

| Level | Adds | Detail brushes per building |
|---|---|---|
| None | cornice band and parapet | ~7 |
| Low | stone base course along the street, stepped cornice (fascia + overhanging band) | ~10 |
| Medium (default) | a heavy ledge over the ground floor, thin ledges between floors (every floor or every other), quoins on the corners, flat columns every 2–3 window bays | ~22 |
| High | brackets under the cornice at every bay | ~50 |

- Columns stand on the bay boundaries of the fitted facade texture, so they fall between windows.
- Generate map uses Low for the backdrop buildings outside the playable area.
- Six blocks at High (32 buildings, about 1,500 brushes) compile through vbsp, vvis and vrad in 8 seconds.

![The same corner at None](docs/screenshots/buildings-p2-corner-level0.png)
![… at Medium: base course, ledges, quoins, stepped cornice](docs/screenshots/buildings-p2-corner-level2.png)
![… at High: brackets under the cornice](docs/screenshots/buildings-p2-corner-level3.png)
![Street level at Medium](docs/screenshots/buildings-p2-facade-level2.png)
![Street level at High](docs/screenshots/buildings-p2-facade-level3.png)
![The demo blocks at Medium with the lighting preview](docs/screenshots/buildings-p2-overview.png)

### Building phase 3: roofs

`src/gen/roofs.ts` builds roofs from planes: over a convex footprint a hipped roof is the intersection of
one rising plane per wall, so each roof tier is a **single convex brush**, also over cut and rounded
corners (a rounded corner gets a conical roof). Planes that end up without a face are dropped, so the
compiler never sees a redundant side.

| Roof | Shape | Covering |
|---|---|---|
| Hipped | one tier, 37° | terracotta tiles, slate or metal |
| Mansard | a steep attic storey (76°) with **dormers** at every second bay, then a low cap | slate, copper or metal |
| Gabled | two slopes, gable walls in the facade's plain material (rectangular buildings) | tiles, slate or metal |
| Curved | three tiers (72°, 52°, 19°): the bell-shaped copper roofs | copper or slate |
| Flat | the parapet roof with rooftop props | concrete |

- Dormers have a window from the building's own facade texture and a small gabled cap; chimneys (brick
  with a cap) stand on the roof at random spots, from 1 to 3 per building.
- Sheds get a low metal roof half of the time. Roofs, dormers and chimneys are func_detail.
- Roof choice draws from its own random sequence, so roofs don't change the layout or facades.
- Building panel: **Roofs** (mixed, or one kind for all). Six blocks with every kind at High detail
  (34 buildings, about 1,700 brushes) compile through vbsp, vvis and vrad in 10 seconds.

![Mixed roofs: copper and slate mansards, terracotta hips, gables, chimneys](docs/screenshots/buildings-p3-mixed.png)
![Closer: copper mansard with dormers over a cut corner](docs/screenshots/buildings-p3-mixed-close.png)
![A conical roof over a rounded corner](docs/screenshots/buildings-p3-mixed-east.png)
![All mansard](docs/screenshots/buildings-p3-mansard.png)
![All curved](docs/screenshots/buildings-p3-curved.png)
![All gabled](docs/screenshots/buildings-p3-gable.png)
![All hipped](docs/screenshots/buildings-p3-hip.png)

### Building phase 4: corner towers and domes

Corner buildings of 3+ floors get a tower on their street corner: most rounded corners, a third of the
cut ones and a fifth of the square ones (`src/gen/towers.ts`).

- **Placement**: on a rounded corner the tower continues the curved facade upwards (radius up to 160,
  touching the curve at its apex); on cut and square corners an eight- to twelve-sided tower stands
  tangent to both walls. It rises one or two floors above the eaves, and always clears the roof.
- **Body**: windows from the building's own facade (fitted per side, about one bay per side), a cornice
  ring and a drum.
- **Caps**: a profile revolved into stacked frustums, each one a convex brush, so even the onion's
  bulge is valid. Baroque **bell** (most common, as on City 17's corner towers), **dome**, **onion** and
  **spire**; bells and domes get a small windowed lantern with its own dome; all end in a finial.
  Copper, slate or grey metal.
- Building panel: **Towers** on or off. Six blocks with rounded corners at High detail (53 buildings,
  about 2,500 brushes) compile through vbsp, vvis and vrad in 19 seconds.
- Rooftop signs were left out: the game has only five single-letter sign models, too few to spell
  anything.

![A district with towers over the rooftops](docs/screenshots/buildings-p4-overview.png)
![Bell, onion and dome towers](docs/screenshots/buildings-p4-tower1.png)
![Copper dome with lantern, onion and spire](docs/screenshots/buildings-p4-tower2.png)
![A rounded corner rising into a tower with a copper spire](docs/screenshots/buildings-p4-tower4.png)

## Example: "Sofia: Battle for the Largo" (singleplayer)

A singleplayer mission based on reference photos of central Sofia, built entirely with the editor's
tools by `scripts/build-sofia.mjs` (map logic and landmarks in `src/examples/sofia.ts`). It is saved as
`maps/sp_sofia.vmf` with its sketch `maps/sp_sofia.sketch.json`, so it opens and edits like any map.

**Layout** (64×64 cells, 8192 units square), drawn with the map sketch:

- **Old town** (south, ground level): 16 dense blocks of 2–4 storey buildings with cobbled alleys and
  rubble courtyards, littered with debris, dumpsters, crates and drums. 12 groups of zombies (classic,
  fast, poison and zombines, 59 in total) wait in the courtyards and alley junctions.
- **Tram line** (one level up, reached by stairs/ramps): a wide street with two tram tracks, trams,
  parked cars and street lamps (reference images 3 and 4).
- **The Largo** (north): a paved square with ochre inlays, tree planters, benches and a glass dome over
  the ruins, flanked by long pale government blocks and closed off by the Party House with its colonnade
  and spire (image 2). The ochre corner tower with its dark dome stands on the square's corner (image 1),
  and the gold-domed Alexander Nevsky Cathedral rises on a terrace to the east (image 5).
- **Combine garrison** on the Largo: soldiers, shotgunners, elites and Metropolice (27) behind barricades,
  bunkers and a fence, plus two reinforcement waves.

**Mission script** (wired with the kits and the outputs editor; 15 connections, see the logic graph):

1. At map start: player relations apply and the intro message tells the player to push north. Objective
   *"Fight through the old town to the tram line"* is shown.
2. Reaching the tram line (`trigger_once` filtered to the player's units) completes it, shows the next
   message, reveals *"Take the Largo"* and brings 4 rebel reinforcements up the tram line.
3. Entering the Largo shows the alarm message and enables the Party House wave; the cathedral wave
   follows 25 seconds later. Both waves are ordered to the flag.
4. Capturing the flag (`OnCaptured_Player0`) completes the objective, which ends the mission in victory.

The map compiles sealed (vbsp, vvis, vrad -hdr) with a navmesh in about 30 seconds, and a dedicated server
loads it with the mission gamerules without script errors. Because it starts with `sp_` and has a
`maps/sp_sofia.res`, it is listed under Missions in the game.

![Sketch: height levels](docs/screenshots/sofia-01-sketch-height.png)
![Sketch: layout and markers](docs/screenshots/sofia-02-sketch-layout.png)
![Top view](docs/screenshots/sofia-03-top-view.png)
![Overview](docs/screenshots/sofia-04-overview.png)
![Old town alleys with zombies](docs/screenshots/sofia-05-old-town-alleys.png)
![Rooftops over a courtyard](docs/screenshots/sofia-06-courtyard.png)
![The tram line](docs/screenshots/sofia-07-tram-line.png)
![The Largo and the Party House](docs/screenshots/sofia-08-largo.png)
![Party House](docs/screenshots/sofia-09-party-house.png)
![Alexander Nevsky Cathedral](docs/screenshots/sofia-10-cathedral.png)
![The corner tower on the tram line](docs/screenshots/sofia-11-corner-tower.png)
![Lighting preview](docs/screenshots/sofia-12-lit-overview.png)
![The Largo with the lighting preview](docs/screenshots/sofia-13-lit-largo.png)
![Mission logic graph](docs/screenshots/sofia-14-logic-graph.png)
![Mission summary](docs/screenshots/sofia-15-mission-summary.png)
![Compile checks](docs/screenshots/sofia-16-compile-checks.png)
![Compiled with the navmesh](docs/screenshots/sofia-17-compiled.png)

## Development

```bash
npm test           # unit tests (vitest)
npm run typecheck
npm run screenshot -- scripts/shots/phase0.json   # needs the dev server running
node scripts/phase3-demo.mjs                      # scripted editing session with screenshots
node scripts/phase4-demo.mjs [map] [prefix]        # compile checks + compile through the dialog
node scripts/phase5-demo.mjs                      # map and building generators
node scripts/build-sofia.mjs                      # builds and compiles maps/sp_sofia.vmf
powershell -File scripts/capture-window.ps1 -Out shot.png   # in-game screenshot of the game window
```
