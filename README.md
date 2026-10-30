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
  draws ropes (`src/render/ropeRenderer.ts`), with the sag from their Slack.
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
  (found by raycasting the map), ending on a wall insulator.
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
  while it runs, and **transitions**. The first transition whose condition is met wins; it leads to
  another stage, to 🏆 Victory or to 💀 Defeat, and marks the stage's objectives completed or failed.
- **Conditions**: 📍 reach a location (an area drawn in the viewport), 💥 destroy units or an object (by
  name), ☠ destroy a faction, 👥 have an amount of troops (population at least / at most N), ⏱ survive for
  a time, 🛡 lose a unit or object (lead it to Defeat for "keep it alive"), ⚑ capture a point, and 💰 gain
  resources (listed, but the game has no entity that reports resources: see below).
- **Editing**: drag cards to arrange them, drag the background to pan, the wheel zooms, ⤢ Fit shows it
  all. Drag a transition's dot onto a card to send it there. The side panel edits the selected stage;
  name fields offer the map's targetnames (unit groups, capture points).
- Sofia's mission (built by hand in the Sofia phase) as a flowchart: the old town → the tram line →
  the assault on the Largo → Victory when the flag is captured, Defeat when you are wiped out.

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
