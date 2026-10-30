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

### Building phase 5: bays, balconies and the street level

Walls on the block's outline face the street; only they get these features (`src/gen/facadeFeatures.ts`).
Courtyard walls and party walls stay plain. Features sit on whole window bays and never overlap.

- **Oriels** (Medium detail and up, 4+ floors, walls of 384+): one or two per wall, two bays wide,
  rectangular, angled or half-round, from the first floor to under the cornice (or a floor lower), with
  windows fitted per face, a stepped corbel underneath and a cap band.
- **Balconies** (Medium and up, 3+ floors): a long one on the first floor, or single-window balconies
  stacked up the facade: a slab on two brackets with a **wrought-iron railing** (the game's
  see-through `metal/metalrail001a`) on three sides.
- **Shopfront awnings** (Low and up): the game's striped awning props over some ground-floor bays, facing
  the street. **Basement vents**: vent decals at the foot of the wall every third bay.
- **Entrance steps** in front of a cut-corner entrance.
- Six blocks at High detail (51 buildings, about 3,200 brushes, 112 decals, 47 props) compile through
  vbsp, vvis and vrad in 19 seconds.

![A narrow street between blocks: steps at a cut-corner entrance, balconies](docs/screenshots/buildings-p5-street-north.png)
![Balconies stacked up a facade, an awning on the ground floor](docs/screenshots/buildings-p5-street-east.png)
![An oriel running up the upper floors](docs/screenshots/buildings-p5-oriel.png)
![An awning over a shop window, a balcony above](docs/screenshots/buildings-p5-awning.png)
![The district from above](docs/screenshots/buildings-p5-corner.png)

### Building phase 6: architectures, colours and the generator panel

**Architectures** (`src/gen/styles.ts`) bundle the choices into kinds of city building:

| Architecture | Facades | Roofs | Corners, towers | Street features | Floors |
|---|---|---|---|---|---|
| Pre-war tenements | ochre, yellow, cream, framed stone, blue, rose, sand … | mansard, curved, hip, some gables | mixed, more towers | oriels, balconies | 3–6 |
| Soviet blocks | grey concrete, stone, pale | flat with **rooftop stair houses** | square, no towers | balconies | 5–9 |
| Brick houses | brick, brown, rose | gables, hips, a few mansards | cut, few towers | oriels | 2–4 |
| Sheds and workshops | brick, brown, stone | gables, flat, hips | square | none | 1–2 |
| Mixed | everything | everything | mixed | all | 3–6 |

- **Eight new colour sets** from the game's facade textures, City 17's plaster colours: ochre with blue
  windows, yellow with framed windows, framed stone, cream, blue, rose and sand courtyard plaster, and
  grey concrete for the blocks, each with its own ground floor, door, plain and trim textures.
- **Weathering**: stain and dirt decals on street walls, under the cornice and below window sills
  (0 to 1, default 0.5).
- **Building panel**: Architecture (sets the usual floor range), Facade and Corners can follow the
  architecture, Weathering, and a **Seed** with a 🎲 button: the same seed and settings give the same
  buildings, so a result can be recreated. **Sketch** and **Generate map** get an Architecture picker too.
- Five blocks, one per architecture, at High detail (35 buildings, about 1,900 brushes, 93 decals) compile
  through vbsp, vvis and vrad in 11 seconds.

![One block per architecture, same seed: tenements, Soviet blocks, brick houses, sheds, mixed](docs/screenshots/buildings-p6-architectures.png)
![Pre-war tenements: ochre with blue windows, a round corner tower, copper roofs](docs/screenshots/buildings-p6-tenement.png)
![Soviet blocks: concrete slabs, stacked balconies, stair houses on the roofs](docs/screenshots/buildings-p6-soviet.png)
![Brick houses with gables and hips](docs/screenshots/buildings-p6-brick.png)
![Sheds and workshops around a yard](docs/screenshots/buildings-p6-sheds.png)
![The Building panel](docs/screenshots/buildings-p6-panel.png)

### Building phase 7: street dressing, and a test district

**Wall clutter** on street walls (`src/gen/streets.ts`): drainpipes down from the cornice at the wall
ends, satellite dishes, gas meters by the ground floor, cable insulators, and TV antennas on some ridges.

**The street pass** runs over all blocks generated together (Building panel with several blocks
selected, Generate map, Sketch):

- **Overhead cables**: each building's street walls offer anchors; anchors facing each other across a
  street (128–900 apart) are joined by a `move_rope` → `keyframe_rope` pair with sag. The editor now
  draws ropes (`src/render/ropeRenderer.ts`), with the sag from their Slack. Each anchor is a wall
  bracket (`utilitypolemount01a`) turned so its arm sticks out from the wall, and the cable ends on the
  bracket's outer insulator (`wallMount` in `src/gen/powerlines.ts`, measured from the model: the plate
  is at model y −42, the outer insulator top at y 7, z 22).
- **Lamp posts** along the pavements, arms out over the street; none in alleys (gaps under 192).
- **Bare trees** in courtyards and yards (clear of the sheds) and alternating with lamps on wide streets.
  City-theme sketches now use bare trees for their Trees feature too.

**Test district** (`maps/c17_district.vmf`, built by `scripts/build-district.mjs` from
`src/examples/district.ts`): a 40×40-cell sketch of pre-war tenement blocks (8×8 cells, 256-unit streets)
around a paved square, set up as a two-player skirmish (starts in opposite corners, three capture points,
four scrap points).

| | Sofia (before these phases) | City 17 district |
|---|---|---|
| Brushes | 1,107 | 3,946 (317 world, the rest func_detail; 794 of them roads) |
| Props / decals / cables | 566 / 52 / 0 | 606 / 219 / 24 |
| Compile with navmesh (fast) | about 30 s | 44.2 s, sealed |
| Editor (lighting preview, 900k triangles) | 240 FPS | 240 FPS (frame-rate cap) |

`scripts/compile-map.mjs` compiles a map from `maps/` like the compile dialog (map settings, vbsp, vvis,
vrad, navmesh) without the browser, optionally into another install:
`node --experimental-transform-types scripts/compile-map.mjs c17_district --install "<game root>"`.

![The district](docs/screenshots/district-02-overview.png)
![The RTS view over the square](docs/screenshots/district-03-rts-view.png)
![A street: cables between the facades, insulators, a lamp post, balconies](docs/screenshots/district-04-street.png)
![The square with bare trees](docs/screenshots/district-05-square.png)
![A crossing: lamps, cables, awnings, rounded corners](docs/screenshots/district-06-crossing.png)
![Rooftops: mansards, dormers, chimneys, a tower](docs/screenshots/district-07-rooftops.png)

## Roads, powerlines, audio and mission flow

### Roads

The **Road tool** (7) draws roads as a line of points: click points (they snap to the grid, and onto
existing roads to join them), Enter or double-click builds, Backspace removes the last point, Escape
cancels. The preview shows the rounded centre line and the edges of the carriageway and pavements.

| Style | Surface | Kerbs and pavements | Default width |
|---|---|---|---|
| Asphalt road | the game's asphalt with a dashed centre line, one tile across so the line sits on the centre | 8-unit kerbs, paving slabs | 256 + 2 × 96 |
| Cobbled street | cobble | yes | 192 + 2 × 64 |
| Tram street | cobble with two tracks of steel rails | yes | 320 + 2 × 96 |
| Dirt track | dirt, almost flush with the ground | none | 160 |

- **Corners** are rounded with a set radius, so every piece stays a small convex brush; slopes follow the
  points' heights. Roads are func_detail and store their points and settings on the entity (`she_road`).
- **Crossings**: all roads are rebuilt together. The earlier road's surface wins where carriageways
  overlap; kerbs and pavements give way to other roads (convex polygon subtraction), which opens T-junctions
  and crossings. Rails stay on top.
- **Editing**: selecting a road (or any of its brushes) shows a Road panel for style, width, pavement and
  corner radius; changes rebuild all roads.
- **Sketch**: road cells become roads through the same code: asphalt with kerbs and pavements in the city
  (dirt tracks in the countryside), longest roads first so they run through junctions, pieces that end
  against another road extended to its centre. The test district's streets are now built this way.
- Long straights are cut into 512-unit pieces, and sketch pavements stop 6 units short of the building
  line. Pavements overlapping the buildings' base course pushed the district past vbsp's limit of 65,536
  t-junction indices ("Too many t-junctions to fix up"). Drawing a pavement into a building's base course
  with the Road tool can still do that on very large maps.

![Drawing a dirt track: the preview with its edges](docs/screenshots/roads-drawing.png)
![An asphalt road with a rounded bend, a tram street, a cobbled side street and a dirt track](docs/screenshots/roads-overview.png)
![A T-junction: the cobbled street opens the asphalt road's kerb and pavement](docs/screenshots/roads-junction.png)
![The tram street crossing the asphalt road; rails stay on top](docs/screenshots/roads-crossing.png)
![The rounded bend](docs/screenshots/roads-bend.png)
![The Road panel](docs/screenshots/roads-panel.png)

### Ground painting

The **Ground tool** (8) paints and sculpts displacement terrain (`src/edit/terrain.ts`):

- **Paint / Erase**: displacements blend two textures by a per-vertex alpha; Paint brings in the second
  texture of the chosen **ground set**, Erase the first. Eight sets from the game's blend materials:
  grass → dirt, grass → mud, gravel → dirt, rubble → dirt, cobble → dirt, dirt → concrete debris,
  rock → sand, snow → trodden snow. Painting with another set switches the touched patches to it.
- **Raise, Lower, Smooth, Flatten** (to the height where the stroke started).
- Radius and strength sliders; a ring follows the cursor; one undo step per stroke. Dabs are spaced a
  quarter radius apart, so strokes stay even at any mouse speed.
- Vertices are found by world position, so the shared edges of neighbouring patches always change alike:
  no cracks, and smoothing works across patch edges.
- **Turn into terrain**: select a flat floor brush and the tool options replace it with displacement
  patches (512 units, 9×9 vertices) in the chosen set.
- **Blend into ground** (Road panel): paints a worn dirt verge along both outer edges of a road, or the
  whole width under a dirt track.
- A 64-patch test terrain with a hill, painted paths and two blended roads compiles through vbsp, vvis
  and vrad without errors.

![Painted dirt paths and a raised, smoothed hill](docs/screenshots/ground-painted.png)
![Roads on the terrain, blended into the ground](docs/screenshots/ground-overview.png)
![A worn verge along the road](docs/screenshots/ground-road-verge.png)
![The dirt track across the grass](docs/screenshots/ground-dirt-track.png)
![The Ground tool's options and brush ring on the hill](docs/screenshots/ground-hill-tool.png)

### Powerlines

The **Powerline tool** (9): click points along the route, Enter or double-click builds. Poles stand at
even spacing per leg and at every bend (turned to bisect it), on the ground under each point; a sagging
rope runs per wire from pole to pole (`move_rope` → `keyframe_rope` chains), drawn in the viewport.

| Poles | Model | Wires |
|---|---|---|
| Wooden, two wires | `props_forest/utilitypole01b` | 2 |
| Wooden, three wires | `props_forest/utilitypole01d` (prop_dynamic) | 3 |
| Wide crossarm | `props_forest/utilitypole03a` (prop_dynamic) | 4 |
| City pole, side arm | `props_c17/utilitypole02b` | 2 |

- The pole models have no attachment points; the wire positions were measured from their geometry.
- **House feeds** (on by default): from each pole, a wire across to the nearest wall within 480 units
  (found by raycasting the map), ending on the outer insulator of a wall bracket turned out from the
  wall it hit.
- **Spacing** and **sag** in the tool options; selecting any pole or rope shows a Powerline panel (pole
  type, spacing, sag, feeds, delete), and changes rebuild the whole line. The first pole stores the route.
- **Moved models**: `utilitypole01a/01d/03a` were moved from `props_c17` without being recompiled; their
  compiled-in name points to a `.vvd` that doesn't exist, and vbsp stops ("Unable to load vertex data").
  The model loader now reads that name, and the compile dialog's static prop check also catches such
  models (and converts them to prop_dynamic, which the game loads by path).
- Two powerlines with house feeds over painted terrain compile through vbsp, vvis and vrad, with all 34
  rope keyframes in the BSP.

![A powerline along a village street and one across the fields](docs/screenshots/powerlines-overview.png)
![Down the street: wires on the crossarms, feeds to the houses](docs/screenshots/powerlines-street.png)
![House feeds to wall insulators](docs/screenshots/powerlines-feeds.png)
![Wide-crossarm poles over the hill](docs/screenshots/powerlines-hill.png)
![A wall bracket sticking out from its wall, the street cable on its outer insulator](docs/screenshots/wall-mount-street-cable.png)
![House feeds ending on wall brackets along a district street](docs/screenshots/wall-mount-feed.png)
![The Powerline panel](docs/screenshots/powerlines-panel.png)

### Ambient sound

- **Soundscapes** (`src/audio/soundscapes.ts`): the editor reads `scripts/soundscapes_manifest.txt` and
  every script it lists (30 soundscapes in Lambda Wars, plus the base game's): looping beds, random
  one-shots with time, volume and pitch ranges, and nested soundscapes.
- **Map default**: an **Ambient sound** card in the Settings tab (an `env_soundscape` with radius -1),
  with the soundscapes grouped by script and a ▶ button to listen for 15 seconds.
- **Zones**: the **Sound tool** (0) places `env_soundscape` zones with a soundscape and radius; the
  viewport draws them as cylinders, the one heard now brighter. Selecting a zone shows its soundscape,
  preview and radius in the inspector.
- **Audio preview** (🔊 **Audio** in the top bar; browsers only allow sound after a click): the editor
  plays the soundscape of the zone at the ground point in the middle of the screen (the RTS camera hangs
  high above it), or of the camera itself when it's low, cross-fading between soundscapes. Loops play
  continuously, random sounds at random times panned to a random side, as the game does. The viewport
  readout shows the soundscape and how many sounds are playing.
- Zones act as columns (distance on the ground plan), so a zone dropped on a roof still covers the street
  below. In game the last zone heard keeps playing until another takes over; the preview falls back to
  the map default instead, which shows each zone's extent more clearly.
- Fixed: with the lighting preview on, the top view was all fog.
- Checked with the test district: default `wars.city16`, `wars.canals.street` in a west street zone,
  `wars.ruins` on the square; the readout switched correctly as the camera moved, the game's PCM WAVs
  decoded, and all four `env_soundscape`s are in the compiled BSP.

![The Ambient sound card](docs/screenshots/sound-settings-card.png)
![Zones placed from the top view](docs/screenshots/sound-zones-top.png)
![Looking into the canal street zone: wars.canals.street plays](docs/screenshots/sound-zone-canal-street.png)
![On the square: wars.ruins](docs/screenshots/sound-zone-square.png)
![A zone selected](docs/screenshots/sound-zone-panel.png)

### Local sounds

- **Sound browser**: the game's 3,900 sounds, searchable by words ("fire loop", "drip"), each with ▶;
  the picked sound shows whether it **loops** (has loop points: the game repeats it) or plays **once**.
- The **Sound tool**'s *Local sound* mode places an `ambient_generic` with the picked file, radius and
  volume, or a **preset**: a sound with the effects that belong to it.

| Preset | Adds | Sound |
|---|---|---|
| 💡 Broken lamp | a light with the fluorescent-flicker style (baked by vrad), sparks (`env_spark`) | electric buzz |
| 🔥 Fire | `env_fire` (infinite, full size), a flickering orange light | small fire loop |
| 💨 Steam leak | an `env_steam` jet | steam loop |
| 📻 Radio | a radio prop | music (plays once) |
| 💧 Dripping water | – | water leak loop |
| ⚙ Generator | a generator prop | generator hum |

- Presets that bring a prop place it when clicked on the ground; clicked on a fitting prop they add only
  their effects to it. **Suggestions**: selecting a lamp post, oil drum, fireplace, radio or generator
  offers the fitting presets in the inspector; the effects go to the right spot on the model (the lamp
  post's head hangs from its arm).
- **3D preview** (with 🔊 Audio on): local sounds play positioned around the listener (the same ground
  point as the soundscape, facing the camera's direction), fading out over their radius; looping sounds
  run while in range, one-shots play on coming into range, sparks crackle at random intervals. Their
  ranges are drawn as circles (a sphere for the selected one); the readout counts local sounds.
- Selecting an `ambient_generic` shows its radius, volume and the sound browser in the inspector.
- Checked with the test district: two fire barrels and a generator on the square (3 local sounds playing
  above them), a broken lamp on a street lamp post (1), dripping water in a street. The map compiles
  through vbsp, vvis and vrad (styled lights included), with the sparks, fires and sounds in the BSP.

![Selecting a lamp post: the inspector suggests a broken lamp](docs/screenshots/local-lamp-suggestion.png)
![The broken lamp's buzz range at the lamp head](docs/screenshots/local-broken-lamp.png)
![The sound browser searching "fire loop"](docs/screenshots/local-sound-browser.png)
![Fire barrels and a generator: 3 local sounds playing](docs/screenshots/local-fires.png)

### Mission flow: the flowchart editor

**Mission tab → Mission flow** opens a flowchart of the mission (`src/lw/mission.ts`,
`src/ui/missionFlow.ts`), saved next to the map as `maps/<name>.mission.json` (loaded and saved with it).

- **Stages** are cards: a title, the **messages** shown when the stage starts, the **objectives** shown
  while it runs, **actions** fired as it starts (an entity input with a delay: enable a wave, open a gate;
  the input field offers the target's inputs from the FGD), and **transitions**. The first transition
  whose condition is met wins; it leads to another stage, to 🏆 Victory or to 💀 Defeat, and marks the
  stage's objectives completed or failed.
- **Conditions**: 📍 reach a location (an area drawn in the viewport), 💥 destroy units or an object (by
  name), ☠ destroy a faction, 👥 have an amount of troops (population at least / at most N), ⏱ survive for
  a time, 🛡 lose a unit or object (lead it to Defeat for "keep it alive"), ⚑ capture a point, and 💰 gain
  resources (listed, but the game has no entity that reports resources: see below).
- **Editing**: drag cards to arrange them, drag the background to pan, the wheel zooms, ⤢ Fit shows it
  all. Drag a transition's dot onto a card to send it there. The side panel edits the selected stage;
  name fields offer the map's targetnames (unit groups, capture points).
- Sofia's mission is a flowchart: the old town → the tram line → the assault on the Largo → Victory when
  the flag is captured, Defeat when you are wiped out.

![The Mission tab before a flowchart exists](docs/screenshots/mission-tab-empty.png)
![Connecting a transition by dragging its dot onto Defeat](docs/screenshots/mission-flow-connecting.png)
![Sofia's mission as a flowchart](docs/screenshots/mission-flow.png)
![Editing a stage: messages, objectives, a capture transition](docs/screenshots/mission-flow-stage.png)

### Mission flow: building it into the map

**Build into map** (in the flowchart) turns the flowchart into entities as one undo step
(`src/lw/missionBuild.ts`, `src/lw/missionAction.ts`). **Compile & test** (and
`scripts/compile-map.mjs`) does the same on the compiled copy, so the map always gets the flowchart as it
stands. Built entities carry `she_mission 1` and are named `mf_<stage>_...`; building again replaces them
and the outputs they added to map entities, so they are never edited by hand.

- `mf_start` (logic_auto) triggers the start stage's `mf_<stage>_enter` relay. Entering a stage shows its
  messages one after another (each `wars_messagebox` displays the next on Continue), makes its objectives
  visible and in progress, and enables its transitions.
- Each transition is a disabled relay `mf_<stage>_tN` fed by its condition. When it fires it disables the
  stage's other transitions, switches their condition sources off, completes or fails the objectives and
  triggers the next stage, or `PlayerVictory` / `PlayerLost` on a `wars_win_condition` after 3 s.
- How each condition is built:

  | Condition | Entities |
  |---|---|
  | 📍 reach | a disabled `trigger_multiple` brush over the drawn area (ground −32 to +320), filtered to the owner with `filter_owner` |
  | 💥 destroy | its death output (`OnUnitKilled`, `OnBreak` for props, `OnAllSpawnedDead` for a unit_maker); several entities with one name count up a `math_counter` |
  | 🛡 lose | the death output of the unit or object goes straight to the transition |
  | ☠ / 👥 faction, troops | `wars_population_listener` + `logic_compare` (population is food used, not unit count) |
  | ⏱ survive | `wars_mission_timer`, started with the stage, paused when it ends |
  | ⚑ capture | the control point's `OnCaptured_Player<n>` |
  | 💰 resources | not built: a warning. The game has no entity that reports a player's resources; it needs a small Python entity in the game repo |

- **Draw in viewport** (or **Redraw**) on a reach transition hides the flowchart and lets you drag a box in the
  top view. Esc cancels.

![Drawing the tram line's area over the Largo](docs/screenshots/mission-draw-area.png)
![Built: the reach triggers in the viewport (tool brushes on)](docs/screenshots/mission-built-triggers.png)
![The built logic in the logic graph](docs/screenshots/mission-built-logic.png)

### Mission flow: checking and playing it through

**✓ Check** (also run when the flowchart opens and after a build) lists problems in the side panel and
outlines the stage cards they belong to; click one to select its stage (`src/lw/missionCheck.ts`).
Compiling logs the errors too.

- Errors: no start stage, nothing leading to Victory, a stage with no transitions (the mission would get
  stuck), a transition to a deleted stage, a reach with no area, destroy / lose / capture targets that
  aren't in the map, a capture by a non-player, an action on an entity that isn't in the map.
- Warnings: stages nothing leads to, stages that can't reach Victory, nothing leading to Defeat, a start
  stage without an objective, a destroy target that can't die (a logic entity), an action input the
  target's class doesn't have, the resources condition, and messages or objectives placed by hand (and the
  logic driving them), which would show next to the flowchart's.

**▶ Play through** steps through the mission the way the built map plays it (`src/lw/missionSim.ts`):
the current stage lights up, its messages show one by one with Continue, the HUD objectives tick off,
and the side panel lists the conditions the stage waits for. Click the one that happens to move on; the
path taken is drawn in orange and a log records the messages, objectives, actions and timers on the way.
It follows the flowchart only; it does not run the game.

![The check: an action on a missing entity and a misspelt capture point](docs/screenshots/mission-check-issues.png)
![Stage actions: the Combine waves of the Largo assault](docs/screenshots/mission-flow-actions.png)
![Playing it through: the assault on the Largo](docs/screenshots/mission-sim-assault.png)
![Playing it through: victory and the log](docs/screenshots/mission-sim-victory.png)

## Points of interest

The **POI tool** (P) fills a rectangle with a finished area: a square, a parking lot, a Combine checkpoint,
a dock. Plan: [docs/poi-generator-plan.md](docs/poi-generator-plan.md). Every POI is built for an RTS: it
offers cover, chokepoints, high ground or a place to capture, and always leaves routes open for the big units.

### POI phase 0: framework and tool

- **Drawing**: pick a type in the **POI** tab, then drag a rectangle on the ground (a click places one at the
  type's default size). The rectangle snaps to 64 and is clamped to the type's sizes; the preview arrow shows
  which way the layout faces. *Fill selected block* turns selected block brushes into POIs instead.
- **Editing afterwards**, like roads: a POI's brushes are one `func_detail` carrying its spec in `she_poi`
  (type, seed, rectangle, rotation, ground height, landscape, parameters); its entities carry `she_poi_id`,
  and world brushes (water, later) are listed by id. Selecting any part shows the POI's settings in the
  Selection and POI tabs; every change rebuilds it in place as one undo step. *Regenerate* rebuilds from the
  stored spec (it follows the POI when it was moved with the gizmo), *Re-roll* picks a new seed, *Delete*
  removes everything it made.
- **The toolkit** (`src/gen/poi/kit.ts`) every type builds on, in the POI's own frame (rotations of 90° turn
  the whole layout):
  - pads (paving, asphalt, grass, sand) cut into pieces of at most 1024, reaching below the lowest terrain;
  - edges with gaps: fences and hedges from models, walls, kerbs and railings from brushes, a
    `fow_blocker` along hedges and high walls on request; `perimeter()` opens a gap wherever a route leaves;
  - placement: single props, rows, scatter with spacing; every prop stands on the pad or terrain under it
    (from its measured bounds) and is refused on a reserved route or on top of something placed;
  - **routes**: through-routes at least 128 wide (large units have a radius of 58) are reserved first;
  - overlays and painted lines on the pads, lights, lamp posts;
  - gameplay hooks each type opts into: a capture point at its focus (control point + capture area), scrap
    piles, enemy unit groups. They show up as parameters automatically.
- **Model table** (`src/gen/poi/models.ts`): bounds of about 240 models measured with the editor's MDL loader,
  and whether each is a valid `prop_static`; the rest become `prop_dynamic`.
- **Terrain**: on displacement terrain the POI levels the ground under it (blending back over 192 units) and
  paints the terrain's second texture there; props sample the ground with a ray that skips the POI's own brushes.
- The first type is a plain **paved lot** (paving, asphalt or gravel, kerbs, lamp posts).
- Tests (`tests/poi.test.ts`): the spec round-trip; a rebuild leaves the same parts and nothing stray, undo
  restores the old ones; for every registered type at four rotations, brushes are valid, every prop model is
  in the table and off the routes, and the same seed gives the same output.

![Dragging a rectangle with the POI tool](docs/screenshots/poi-p0-drag.png)
![The paved lot on levelled terrain](docs/screenshots/poi-p0-lot.png)
![Selected: its settings, rebuilt with asphalt, a capture point and two scrap piles](docs/screenshots/poi-p0-panel.png)

### POI phase 1: square, parking lot, playground

- **Square** (1024 to 3072, default 1408): a cobbled border band round a tiled field, a centre feature in an
  open ring (a statue on a stepped plinth, a fountain basin with a column and bowl, or a Combine Breencast
  screen on a pole), benches at the ring's corners facing it, trees in concrete planters on a grid that keeps
  off the routes, and lamp posts round the edge with their arms over the square. Four routes lead from the
  middle of each side to the ring. *Combine occupation* adds barricades in the corners and Combine flags. The
  capture point (on by default) takes the centre in place of the feature.
- **Parking lot** (768×704 to 3072×2048): asphalt, rows of 128 × 256 bays facing 192-wide aisles (back-to-back
  rows share one), bay lines painted as overlays, an end lane joining the aisles to both long sides; aisles and
  lane are the routes. Cars park in a share of the bays nose to the aisle with a few degrees of turn; wrecks
  (the rusted variants, some on their roof) take any bay at an angle. A ticket booth by the entrance, lamp posts
  at the row ends, kerbs with gaps where the routes leave. Fewer rows are built when the lot is not deep enough.
- **Playground** (768×640 to 2048×2048): sand, rubber or gravel, a low timber fence with gates on all four
  sides, three to six pieces of equipment shuffled onto a loose grid with room around each (swings, slide,
  carousel, climbing frames, see-saw with its board, noughts-and-crosses post), a sandpit with a timber frame,
  benches facing in, two trees. *Abandoned* drops some equipment and adds rubbish, tyres, an old couch and
  mattress, stains and leaves. It can hold a zombie or headcrab group.
- Toolkit additions: fences fill each run with whole pieces (long ones first, the rest spread as small gaps),
  so no piece reaches into a gate; trees only claim their trunk for the route check; ring rims for basins;
  lines as one bar of the street-marking texture; props tipped on their side or roof stand on the right point.

![Square with a statue](docs/screenshots/poi-p1-square-statue.png)
![Square with a dry fountain (water comes in phase 6)](docs/screenshots/poi-p1-square-fountain.png)
![Combine-occupied square with a Breencast screen](docs/screenshots/poi-p1-square-combine.png)
![Parking lot with a capture point](docs/screenshots/poi-p1-parking.png)
![Parking lot with two rows, more cars and wrecks](docs/screenshots/poi-p1-parking-wrecks.png)
![Playground](docs/screenshots/poi-p1-playground.png)
![Playground close up: swings, climbing frames, see-saw, sandpit, benches, gates](docs/screenshots/poi-p1-playground-close.png)
![Abandoned playground on rubber](docs/screenshots/poi-p1-playground-abandoned.png)
![All of phase 1](docs/screenshots/poi-p1-overview.png)

### POI phase 2: park and market

- **Park** (1280 to 4096, default 1792): grass, a gravel loop round a centre feature and four winding spokes
  (one bend each, pushed sideways at random) out to the middle of each side; the paths are the routes, kept
  clear by squares along them. Centre: a raised ornamental pond with a stone rim (dry until phase 6), a
  fountain, a bandstand (a 16-high octagonal stage units can step onto, posts, a pointed metal roof) or plain
  lawn. Hedges round the edge with gaps at the paths and a `fow_blocker` along them (*Hedges block sight*),
  clusters of trees and bushes on the lawns (*Tree density*), benches and bins along the spokes and round the
  loop, lamp posts. It can hold a zombie group.
- **Market** (896×768 to 3072×3072): cobbles, pitches on a grid of back-to-back rows between 160-wide lanes
  (the routes, both ways). Each stall is brushes: a timber counter, four posts and a roof sloping to the
  front in corrugated metal, painted metal or shingles, or a board roof with striped awnings (the HL2 awning
  models) along the front; melons, crates and plastic crates on the counter, pallets, barrels and crates
  behind. Empty pitches get a cart. *Covered hall* adds columns round the stall block and an open frame of
  beams on top; *Abandoned* leaves roofs missing, fewer goods and rubbish in the lanes. The capture point
  takes one pitch in the middle.
- Toolkit: `path()` lays a strip of convex brushes along a polyline with discs at the bends and reserves it.

![Park with a pond, hedges and tree clusters](docs/screenshots/poi-p2-park-pond.png)
![Park with a bandstand](docs/screenshots/poi-p2-park-bandstand.png)
![In the park](docs/screenshots/poi-p2-park-path.png)
![Market](docs/screenshots/poi-p2-market.png)
![A market lane: awnings, counters, melons and crates](docs/screenshots/poi-p2-market-lane.png)
![Covered market hall](docs/screenshots/poi-p2-market-hall.png)
![Abandoned market with a capture point](docs/screenshots/poi-p2-market-abandoned.png)

### POI phase 3: sport fields

- **Football pitch** (1280×896 to 3072×2560, default 1920×1600): a 1536 × 1024 pitch at the default size (it
  shrinks to fit), grass, painted touch and goal lines, halfway line, centre circle, penalty and goal areas
  with their arcs. Two goals from thin white boxes with a see-through chain-link net (back, sides and a roof
  sloping from the bar). Stepped **bleachers** on one or both long sides: steps 16 high (under the 18 units
  can climb), wood seats and concrete treads, a railing at the back, and a `TOOLS/TOOLSNPCCLIP` ramp over the
  steps (a world brush) that starts one step in front and reaches the top at the top step's edge, so the
  navmesh gets a smooth 1:3 slope that stays above every step's nose. Floodlight masts in the corners (lights
  on request), a low railing round the field with gaps at the routes, team benches. *Running track*: a
  red-brown oval of straights and half-round ends round the pitch. Routes run along the middle and across
  beside the goals.
- **Basketball court** (768×512 to 1536×1024): asphalt, a 640 × 384 court with lines, keys, circles and
  three-point arcs, two hoops (pole, arm, backboard, ring), a tall chain-link fence with gates, benches.
  *Abandoned* adds rubbish and stains.
- Painted lines use one bar of the street-marking texture between its cracked ends; the blue dots in the
  editor are the overlays' origin markers.

![Football pitch with bleachers on both sides and floodlights](docs/screenshots/poi-p3-football.png)
![Football pitch with a running track](docs/screenshots/poi-p3-football-track.png)
![The bleachers](docs/screenshots/poi-p3-bleachers.png)
![A goal and the pitch markings](docs/screenshots/poi-p3-goal.png)
![Basketball court](docs/screenshots/poi-p3-basketball.png)
![The court: hoops, lines and the fence with its gates](docs/screenshots/poi-p3-hoop.png)
![Abandoned basketball court](docs/screenshots/poi-p3-basketball-abandoned.png)

### POI phase 4: Half-Life 2 city set

Mostly prop placement on the toolkit, with a few brush pieces. The checkpoint and the barricade span a
street: drag them so their long side runs across the road (rotate by 90° for a road along x); the gap in
the middle is the route. Their ground is left as it is by default, so they sit on the road.

- **Combine checkpoint** (896×512 to 2560×1024): a line of tall and medium Combine barricades with a 192-wide
  vehicle gap, the citizen scanner gate beside it and a short booth on the other side, floodlights behind the
  line, a funnel of short barricades on the approach, Combine crates, an APC and a Breencast screen on the
  Combine side. The capture point sits just behind the gap; Combine soldiers or Metro Police on request.
- **Rebel barricade** (768×384 to 2560×1024): wrecked cars (some on their roof), furniture piles (couch,
  bed, bath, laundry cart with a mattress or crate on top), the Lambda Wars barricade props, three-layer
  sandbag walls (a new toolkit helper: rows of bags laid staggered and turned a little) and crates and drums,
  laid end to end along the width with one gap; junk piled against both faces; ammo and supply crates behind,
  explosive barrels as `prop_physics` (option).
- **Ration distribution** (768 to 2048): queue lanes between Combine railings (lanes 144 apart: a 128-wide
  route each and room for the rail), a counter with dispenser monitors across their heads, the booth behind
  it, crates of rations, a Breencast screen, barricades on the flanks and ration papers on the ground.

![Combine checkpoint across a street](docs/screenshots/poi-p4-checkpoint.png)
![The checkpoint up close: gate, booth, barricades](docs/screenshots/poi-p4-checkpoint-close.png)
![Checkpoint on concrete with a capture point and Metro Police](docs/screenshots/poi-p4-checkpoint-units.png)
![Rebel barricade](docs/screenshots/poi-p4-barricade.png)
![The barricade up close](docs/screenshots/poi-p4-barricade-close.png)
![Rebel barricade on rubble with rebels and a capture point](docs/screenshots/poi-p4-barricade-rubble.png)
![Ration distribution](docs/screenshots/poi-p4-rations.png)

- **Junkyard** (1024×896 to 3072): gravel inside a chain-link or barbed-wire fence, rows of wrecks along two
  sides (half with another wreck on top, some upside down), containers and a roll-off dumpster along the
  others, tyre stacks, gravel heaps, dumpsters, a van and a truck cab, beams, drums and pipes. **Scrap**: three
  `scrap_marker` piles by default, one per quadrant first so workers have room round them.
- **Construction site** (1152×1024 to 3072): a fenced dirt yard round a half-built concrete frame: a
  foundation 16 high that units step onto, a grid of columns, a whole slab over the first floor and a
  smaller one higher up (1 to 3 floors), a ragged brick wall going up along the back, scaffolding (poles,
  plank decks, rails) along the front, a crane frame, sand and gravel heaps, a container, a bulldozer, concrete
  pipes, pallets, beams and cinder blocks.
- **Tank farm** (1152 to 3072): concrete, up to six big brush tanks with low roofs, each in a 16-high bund,
  pipe runs on supports along the outer side of each row, a pump house, smaller tank models, drums and
  explosive barrels (`prop_physics`), a barbed fence.

![Junkyard with scrap piles and a capture point](docs/screenshots/poi-p4-junkyard.png)
![In the junkyard](docs/screenshots/poi-p4-junkyard-close.png)
![Construction site](docs/screenshots/poi-p4-construction.png)
![The half-built frame and its scaffolding](docs/screenshots/poi-p4-construction-close.png)
![Tank farm](docs/screenshots/poi-p4-tankfarm.png)

- **Rail yard** (1536×896 to 4096×2560): ballast, two to six tracks of rail models along the width with buffer
  stops at both ends, 16-high platforms between pairs of tracks (with a canopy of posts and a pitched metal
  roof on request), lines of parked train cars that block sight, wrecks lying on their side next to the
  track, and level crossings kept free of cars (one in the middle, two on yards from 3072 long). Rails are
  "walkable" props and may cross routes.
- **Gas station** (1024×896 to 2048×1536): asphalt, a canopy on two columns over two pump islands, the kiosk
  at the back built by `interiorHouse()` with its door facing the pumps (on this branch the interior
  generator is still its stub, a closed box; the house becomes enterable when the interiors branch is
  merged), propane tanks against it (`prop_physics`, explosive), a price sign on a pole, cars at the pumps,
  tyres and a dumpster. Routes along the forecourt and up the side.
- Toolkit: `house()` hands a local rectangle to `interiorHouse()` (doors on chosen sides) and files its world
  brushes, detail brushes and entities with the POI.

![Rail yard with platform canopies and train cars](docs/screenshots/poi-p4-railyard.png)
![Among the tracks](docs/screenshots/poi-p4-railyard-close.png)
![A longer yard: three tracks, two crossings, wrecks](docs/screenshots/poi-p4-railyard-wrecks.png)
![Gas station](docs/screenshots/poi-p4-gasstation.png)
![The canopy and pumps](docs/screenshots/poi-p4-gasstation-close.png)

### POI phase 5: forest and rural set

These mostly stand on the terrain itself (levelled under the POI) rather than on a pad.

- **Rebel camp** (1024×896 to 2560): tents in a ring with their doors to a campfire (stones, charred logs,
  a flickering light, logs to sit on), a resistance shack, the rebel radio tower, a wooden watch post (legs,
  a deck at 128, rails, a tin roof, a ladder), a rebel flag, supply, ammo and item crates, a table, sandbags
  either side of the way in, a few pines. Rebel squads on request.
- **Thumper site** (896 to 2560): a Combine thumper on a disc of sand, short barricades and a light round it,
  boulders and rocks, and antlion burrows (sand mounds with a dark hole) further out, each with an
  `info_target` named `poi_<id>_burrow_N` to spawn waves from. Capture point by default; antlions, an antlion
  guard, Combine or zombies on request (the toolkit now knows `unit_antlion` and `unit_antlionguard`).
- **Crash site** (1024×896 to 2560): a scorched crater with a raised rim, a dropship container half buried in
  it at an angle, gunship wreckage thrown along the crash path, headcrab canisters stuck in the ground, dead
  and fallen trees, crates and drums, fires. Two scrap piles by default.
- Toolkit: `extrude()` for convex sections lying down and `log()` for logs and pipes; more fence kinds
  (farm planks, wooden rails).

![Rebel camp](docs/screenshots/poi-p5-rebelcamp.png)
![Round the campfire](docs/screenshots/poi-p5-rebelcamp-close.png)
![Thumper site with antlions](docs/screenshots/poi-p5-thumper.png)
![The thumper and its barricades](docs/screenshots/poi-p5-thumper-close.png)
![Crash site](docs/screenshots/poi-p5-crashsite.png)
![The crater and the dropship container](docs/screenshots/poi-p5-crashsite-close.png)

- **Farmstead** (1408×1152 to 3072): a farmhouse built by `interiorHouse()` (one or two storeys, doors to the
  yard and the road; a closed box on this branch until the interiors branch is merged), an open-fronted barn
  of plank walls with a pitched roof and gables that units can walk into, hay bales inside, a stone well with
  a little roof, a dirt yard, two furrowed fields along the front, a plank fence round it all with gaps at the
  routes, a trough, a generator, tractor tyres and trees.
- **Graveyard and chapel** (1152×1024 to 3072): grass, dirt paths through the middle and across, rows of
  headstones and crosses (each with its grave in front; *Ravenholm look* opens some of them), a statue, a low
  brick wall with gates, a chapel at the back (its nave from `interiorHouse()`, a stone bell tower with a
  spire), dead trees, coffin pieces and the Ravenholm sign on posts by the gate. A zombie spawn site.
- **Lookout tower** (768 to 1536): a wooden (legs, cross bracing) or concrete tower with a deck, parapet and
  roof at 128 to 384 (default 256), reached by plank steps 16 high on the deck's open side with an NPC-clip
  ramp over them (1.25 units of run per unit of height, under the navmesh's 45°; a POI too small for the
  height asked for gets a lower deck), rocks and pines round it.

![Farmstead](docs/screenshots/poi-p5-farmstead.png)
![The yard: barn, well, house and fences](docs/screenshots/poi-p5-farmstead-close.png)
![Graveyard with a chapel and zombies](docs/screenshots/poi-p5-graveyard.png)
![Among the graves](docs/screenshots/poi-p5-graveyard-close.png)
![Wooden lookout tower](docs/screenshots/poi-p5-lookout.png)
![Its stair and deck](docs/screenshots/poi-p5-lookout-close.png)
![Concrete lookout tower](docs/screenshots/poi-p5-lookout-concrete.png)

- **Logging camp** (1152×1024 to 3072): a dirt clearing with pines round the edge, piles of brush logs
  stacked in pyramids along rows (lines of cover; slots in rows filled until there are enough), an open
  sawmill shed over a saw bench with a log on it and sawdust round it, a truck or trailer, stumps, fallen
  trees, crates and drums.
- **Combine power node** (896 to 2048): a concrete compound inside Combine fence panels with one gate, the
  Lambda Wars power generator on a metal plinth with two Combine generators beside it, smaller generators in
  the back corners joined by cables, Combine lights (lit on request), a Breencast screen by the gate, crates
  and short barricades. Combine soldiers or elites on request.

![Logging camp](docs/screenshots/poi-p5-logging.png)
![The sawmill shed](docs/screenshots/poi-p5-logging-close.png)
![Combine power node](docs/screenshots/poi-p5-powernode.png)
![Inside the compound](docs/screenshots/poi-p5-powernode-close.png)

### POI phase 6: water, the coast and the rocky set

**Water.** `water()` makes a world brush (water can't be func_detail) whose top face is a `%compilewater`
material; the first POI with water adds a `water_lod_control`. How units treat it was checked in the engine
source: the Recast map mesh (`engine-src/src/game/server/recast/recast_mapmesh.cpp`) takes the world's
collision (func_detail included) and props, and only filters out triangles with water below and air above,
the water *surface*. The ground under water stays walkable. So:

- **Ponds and fountains** keep their water inside a rim too high to climb (28 over the floor, the limit is
  18): the floor is an island the navmesh can't reach. The park's pond and the square's and park's fountains
  now hold water (*Water* option, on by default).
- **Sea** (`sea()`): displacement terrain under the sea part is lowered 128 (a short, steep shore), water sits
  16 below the ground, and a `func_nav_blocker` fills the water volume. In Lambda Wars that entity adds a
  Recast box obstacle (`python/core/ents/navblocker.py`), so units don't path into the sea, while piers and
  decks above the water stay walkable. On brush ground the ground under the sea has to be cut away by hand
  (the POI can only lower displacements).
- The coast POIs keep the sea at their back (local +y, the *Sea* percentage of their depth): rotate them so
  their back faces the water.
- A test map with the dock, the beach front and the park pond compiled without errors or leaks (two water
  bodies, two nav blockers).

**Coast:**

- **Dock** (1024 to 3072): a concrete quay with a wall down to the seabed, one to four piers on poles out over
  the water (each a 160-wide walkway route: chokepoints) with bollards, boats moored beside them (the HL2 row
  boats), buoys, containers, crates and drums on the quay, an optional dock crane.
- **Beach front** (1280×1024 to 4096×3072): sand down to the sea, a row of beach huts (from
  `interiorHouse()`, doors to the sea), umbrellas with chairs and blankets, a lifeguard tower (deck at 128,
  rails, a roof, a ladder), driftwood, and a breakwater of big coast rocks out into the water.
- **Shipwreck** (1408×1280 to 3072): the big fishing boat beached on its side along the shore, half in the
  water (a large wall of cover), spilled containers, crates, drums and pallets, rocks and driftwood; two
  scrap piles.
- **Lighthouse point** (1280 to 2560): a stone platform at the shore, a 512-high tapering lighthouse built
  like the buildings' corner towers (body, cornice, drum, dome and lantern) with a gallery round the top and a
  strong light, rocks round the point and into the water, the keeper's house (`interiorHouse()`) and a path.
- **Coastal bunker** (1280×1024 to 3072×2560): sand dunes, the Combine bunker overlooking the beach, trenches
  dug either side (the terrain lowered 40) lined with sandbags, barricades, a mortar, crates.

![Dock](docs/screenshots/poi-p6-dock.png)
![The piers and boats](docs/screenshots/poi-p6-dock-close.png)
![Beach front](docs/screenshots/poi-p6-beach.png)
![Shipwreck](docs/screenshots/poi-p6-shipwreck.png)
![Lighthouse point](docs/screenshots/poi-p6-lighthouse.png)
![Coastal bunker](docs/screenshots/poi-p6-bunker.png)
![The park's pond now holds water](docs/screenshots/poi-p6-pond.png)

**Rocky set and the canal:**

- **Quarry** (1536 to 3072): a gravel floor open to the front with one to three terraces of rock round the
  other three sides, each step 64 high (too high to climb), one 1:3 ramp per terrace alternating sides (the
  chokepoints), a conveyor from the top down to the floor, a crane frame, mining carts on rails, a bulldozer.
- **Mine entrance** (1024×896 to 2560×2048): a cliff face of rock brushes across the back with a tunnel mouth
  cut into it (dark at the back), timber frames along the tunnel, rails running out with carts, industrial
  lamps either side, boulders along the cliff foot, crates, drums and a generator. An `info_target`
  `poi_<id>_tunnel` inside to spawn waves from.
- **Overlook** (1024 to 2048): a rock ledge 64 to 192 high with a single dirt ramp up, sandbags along its
  front edge, ammo, boulders round its foot.
- **Rocky pass** (1024 to 3072): a dirt road through a gap between two stepped rock masses (with boulders on
  top and along the faces, `fow_blocker`s over them on request), a rockslide half across the road leaving at
  least 128 (the route).
- **Radio relay** (1024 to 2048): a rocky knoll with one ramp, the rebel radio tower, a shack, a generator and
  sandbags on top.
- **Canal crossing** (1024 to 4096×2560, *Route Kanal*): a canal across the POI, the terrain lowered 192
  under it, concrete walls down to a muddy floor, water and a nav blocker in it, one to three concrete bridges
  with railings (the routes), ladders on the wall.

![Quarry](docs/screenshots/poi-p6-quarry.png)
![Mine entrance](docs/screenshots/poi-p6-mine.png)
![The tunnel mouth, with zombies](docs/screenshots/poi-p6-mine-close.png)
![Overlook](docs/screenshots/poi-p6-overlook.png)
![Rocky pass](docs/screenshots/poi-p6-pass.png)
![Radio relay](docs/screenshots/poi-p6-relay.png)
![Canal crossing](docs/screenshots/poi-p6-canal.png)
![The canal and its bridges](docs/screenshots/poi-p6-canal-close.png)

## Example: "Sofia: Battle for the Largo" (singleplayer)

A singleplayer mission based on reference photos of central Sofia, built entirely with the editor's
tools by `scripts/build-sofia.mjs` (map logic and landmarks in `src/examples/sofia.ts`). It is saved as
`maps/sp_sofia.vmf` with its sketch `maps/sp_sofia.sketch.json` and its mission flowchart
`maps/sp_sofia.mission.json`, so it opens and edits like any map.

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

**Mission** (the flowchart `sofiaMission()`, built into 26 entities and 70 outputs when compiling):

1. *The old town*: the intro message tells the player to push north; objective *"Fight through the old
   town to the tram line"*. Player relations apply at map start (a kit, not part of the flowchart).
2. Reaching the tram line completes it and starts *The tram line*: the next message, objective *"Push
   north into the Largo"*, and 4 rebel reinforcements come up the tram line (an action, after 6 s).
3. Entering the Largo starts *Assault on the Largo*: the alarm messages, objective *"Take the Largo"*,
   and the Party House wave (after 4 s) and the cathedral wave (after 25 s), both ordered to the flag.
4. Capturing the flag wins. Losing all your units in any stage loses.

The map was first built with hand-wired messages, objectives and `trigger_once` brushes; those were
replaced by the flowchart (the check flagged them as hand-placed logic until they were removed).

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
![The mission flowchart, checked with no issues](docs/screenshots/mission-check-ok.png)
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
