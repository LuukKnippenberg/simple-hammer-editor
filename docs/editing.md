# Editing maps

How the editor reads and writes maps, and what each tool and panel does. Keyboard and mouse controls are in the
[README](../README.md#keyboard-and-mouse); press **?** in the editor for the same list.

## Start screen

The editor opens on the start screen unless the address names a map (`?map=repo:x.vmf`, which reopens the map
straight away). **Open…** in the top bar brings it back; its **Back to** button (or Esc) returns to the open map.

- **+ New map** opens the New map dialog; **Open…** reads a `.vmf` from disk.
- **Examples** (Sofia, Garden District) open as a copy named `<map>_copy.vmf`: saving writes the copy to `maps/`,
  the example stays as it is.
- **Recent** lists `maps/` and the game's `mapsrc/`, newest first, with a height thumbnail, the mode (from the name
  prefix, an `overrun_manager`, a mission flowchart, and the player starts) and when the file was last changed.
- **Setup** checks the game install, the map compiler (vbsp, vvis and vrad in `sdkBinDir`) and the navmesh builder
  (`srcds.exe` in the install) each time the screen opens. A missing piece shows what it is for and where to get it;
  **Locate folder…** stores the compiler's folder as `sdkBinDir` in `editor.config.json`, and **Change game…**
  switches installs like the Game picker. Without a compiler maps can still be made, edited and saved; only
  Compile & test stops, with the same message.
- To see the missing-compiler card without touching the SDK, point `sdkBinDir` in `editor.config.json` at a folder
  without the tools and press **Check again**.

## Recover

Unsaved work is autosaved every minute to `.autosave/<map>.autosave.vmf`. When an autosave is newer than its map's
saved file (`maps/` first, else the game's `mapsrc/`), or the map was never saved, the start screen shows a banner
(*Compare*, *Discard*, *Recover*), and opening that map shows the **Unsaved work found** card: when the file was
saved, when the autosave was made, and what it adds, changes and deletes (brushes and entities, by id).

- **Recover** opens the autosave under the map's name, unsaved; Ctrl+S writes it to `maps/`.
- **Open saved version** keeps the file and stops asking about this autosave.
- **Keep both** saves the autosave as `maps/<map>_recovered.vmf` (`_recovered_2` if taken) and opens it.
- **Discard** (banner) stops asking until a newer autosave is made. The autosave file stays, listed under
  *Autosaves* in the map picker.

Nothing here writes to the game's `mapsrc/`. Turned-down offers are kept in this browser (`src/ui/prefs.ts`).

## Maps and files

- The editor reads and writes Hammer `.vmf` files. A parse and write round-trip is byte-identical (the test suite
  checks the sample maps and every VMF in the game's `mapsrc/`), and anything the editor does not understand
  (visgroups, editor colours, cameras, connections) is kept. **Verify round-trip** in the Map panel checks the
  open map.
- **Save** (Ctrl+S) and **Save as** write to this repo's `maps/` folder and bump `mapversion` as Hammer does. The
  game's own `mapsrc/` is never overwritten. **Download** saves the `.vmf` through the browser.
- The map picker lists `maps/` (*Editor maps*), the game's `mapsrc/` and *Autosaves*. Unsaved work is autosaved
  every minute to `.autosave/`.
- **New** opens the New map wizard: four numbered steps on the left, a preview from above and the list of what gets
  placed on the right.

  1. **Mode:** *Annihilation* (an `hlw_` map with player bases, 2, 4, 6 or 8 players), *Overrun* (an `or_` map with
     wave spawn points and an `overrun_manager`, 1 to 4 players and the wave type), *Singleplayer mission* (an
     `sp_` map with the player camera, faction setup, a starting squad and a small mission flow) or *Empty*
     (ground, sky shell, sun, fog and map boundary, with no mode yet).
     Switching mode keeps the player count valid: the closest count the mode offers, and the one you picked when
     you switch back.
  2. **Size and look:** Small (4096 units), Medium (6144) or Large (8192), and the ground blend.
  3. **Start from:** *Template layout* places the mode's bases, resources and boundary as in the preview.
     *Sketch it* creates the same map, then opens the sketch on it with the starts, requisition points, scrap,
     Overrun's wave spawns and its `overrun_manager` (with the chosen wave type) as markers; generating the sketch
     replaces the map, keeps those pieces and keeps its name. *Empty ground* places only the ground, sky shell,
     sun, fog and map boundary. *Empty* places the same with every start choice.
  4. **Name:** the mode's prefix is a fixed chip in front of the name field (a typed or pasted prefix goes back into
     the chip), with the target path and three live checks: the prefix, lowercase without spaces, and no map in
     `maps/` with that name yet. **Create map** waits until all three pass.

  Every template adds the ground, sky shell, sun, fog and map boundary. A double click on a mode card creates the
  map straight away.
- The **map checklist** chip in the top bar ("Annihilation · ready ✓", or "· 2 to fix") tracks what the map's game
  mode still needs; click it for the list and its fixes. See [Map checklist](compiling.md#map-checklist-and-pre-flight-checks).
- After 20 minutes of unsaved changes the status bar shows an amber *unsaved for N min · Save* pill; clicking it
  saves. It never interrupts, and autosave runs either way.
- Generated maps keep their sketch (`maps/<name>.sketch.json`) and mission flowchart (`maps/<name>.mission.json`)
  next to the VMF; they load and save with it.

## Undo and history

- **Undo** (Ctrl+Z) and **Redo** (Ctrl+Y or Ctrl+Shift+Z) are also the ↶ and ↷ buttons at the foot of the tool
  rail, greyed out when there is nothing to undo or redo. The history keeps the last 200 steps and is cleared when
  a map is opened.
- **Map › History** lists every step with its icon, label and time, oldest first, starting from *Opened <map>*.
  The current step is highlighted. Click a step to jump back to it: the steps after it turn grey and can be redone
  (click one, or Redo) until the next edit drops them. A generator run, from placing it to the last tweak, is one
  step. Jumping restores the map exactly; the selection may be cleared.

## The viewport

- **3D view** and **top view** (T, orthographic, north up). Every tool works in both.
- The object under the cursor gets an outline and the status bar names it (class, targetname, material, owning
  brush entity).
- The view bar toggles tool brushes, generator handles, sky brushes, props, entity markers, decals, wireframe and
  the ground grid. **H** hides the selection and **U** unhides everything; hidden objects are still saved and
  compiled.
- **Lighting** (L) approximates the compiled result: the sun from `light_environment` with real-time shadows, its
  ambient as sky fill, `light`, `light_spot` and `light_deferred` entities as point and spot lights (a fixed pool is
  given to the lights nearest the camera), and the fog.
- Brush faces render with the game's materials (VMT and VTF, including `patch` materials), displacements blend
  their textures (`WorldVertexTransition` and four-way `MultiBlend`), props are drawn from their MDL files,
  `infodecal` and `info_overlay` entities are projected like the engine does it, and ropes hang with their slack.

## Tools

The tool rail on the left; see the README for the keys.

| Tool | What it does |
|---|---|
| Select | Click picks a brush or entity, Shift adds, a drag on empty space box-selects. The gizmo moves (W), rotates in steps (E, Shift for free rotation) and resizes (R), snapping to the grid with texture lock. Brushes inside brush entities can be picked one by one. |
| Block | Drag a rectangle on any surface to make a brush with the current material and height. Shapes: box, cylinder, cone or spire, dome, with a set number of sides. |
| Paint | Click a face to apply the current material. Shift paints the whole brush, Ctrl picks the material under the cursor. |
| Entity | Click to place the class chosen in the Entities panel. Classes, keys, choices and editor models come from the game's FGD. A control point gets its `trigger_capture_area`. |
| Lambda Wars kit | Click to place the kit chosen in the Mission panel (see [mission.md](mission.md)). |
| Decal | *Decal* places an `infodecal` sized from its material. *Overlay* places an `info_overlay` with a size and rotation, clipped to the clicked face and the coplanar faces it covers. |
| Ground | Paint and sculpt displacement terrain (below). |
| Sound | Soundscape zones and local sounds (see [audio.md](audio.md)). |
| Cinema | Paths, particles and screens (see [cinematics.md](cinematics.md)). |

### Selection modes, snap move and extrude

- **Shift+1 to 4** switch the Select tool between objects, faces, edges and vertices. Parts move with the gizmo,
  and brushes are rebuilt round their corners.
- **Snap move**: hold **V** and drag a corner, edge or face of the selection onto a corner, edge or face of
  something else. Shift keeps to one axis, Ctrl keeps the height, Esc cancels. The *Moving* section of the
  Selection panel picks what it snaps to.
- **Extrude**: in face mode, **X** pulls the selected faces out. Move the mouse, then click or press Enter; Esc
  cancels, Alt extends the brush instead of adding one.

### Ground

The Ground tool works on displacement terrain (`src/edit/terrain.ts`):

- **Paint** brings in the second texture of the chosen ground set, **Erase** the first. The sets come from the
  game's blend materials (grass to dirt, grass to mud, gravel to dirt, rubble to dirt, cobble to dirt, dirt to
  concrete debris, rock to sand, snow to trodden snow); painting with another set switches the touched patches.
- **Raise**, **Lower**, **Smooth** and **Flatten** (to the height where the stroke started), with radius and
  strength. One undo step per stroke. Vertices are found by world position, so the shared edges of neighbouring
  patches always move together.
- With a flat floor brush selected, the tool options turn it into displacement patches in the chosen set.
- `MultiBlend` terrain mixes up to four textures by per-vertex weights. The tool paints a layer, noise-fills all
  layers so large areas stop tiling, and can make new blend materials (`content/materials/she/blend/`, packed into
  the BSP when compiling). Compile with final lighting: fast vrad leaves dark seams along patch edges.

## Panels

The panel column on the right has a rail of panels. Panels follow the tool in use unless the pin is on; Alt+1 to 9
open them in rail order and Alt+P toggles the pin.

| Panel | Contents |
|---|---|
| Selection | The inspector: FGD-typed entity fields, brush sizes, the outputs editor and *Fired by* list, and the settings of whatever generator made the selection (buildings, POI, road, powerline, stairs, interior building). |
| Materials | Material browser with thumbnails from the VTFs; a *Decals* mode for the Decal tool. |
| Entities | The entity class palette for the Entity tool. |
| POI | Point-of-interest types and their settings (see [generators/points-of-interest.md](generators/points-of-interest.md)). |
| Mission | Lambda Wars kits, mission title and description, relations, and the mission flowchart (see [mission.md](mission.md)). |
| Cinema | Camera shots and atmosphere presets (see [cinematics.md](cinematics.md)). |
| Logic | Every entity connection as a graph, and the list of broken ones. |
| Map | Document info, round-trip check, lighting preview controls and the outliner (entities by class, searchable). |
| Settings | Map-wide settings (below). |

### Entity I/O

- The **outputs editor** has a row per output: output, target, input, parameter, delay and *once*. Outputs and
  inputs are drop-downs from the FGD (including inherited inputs such as `Kill`), and target names autocomplete
  from the map.
- Missing targets and unknown outputs or inputs are flagged on the row and listed in the Logic panel.
- The selected entity's connections are drawn in the viewport (orange: outputs, blue: incoming).
- **Tie to entity** (Ctrl+T for `trigger_once`) turns selected brushes into a trigger, `func_detail`,
  `func_brush`, fog-of-war or navmesh blocker. **Move brushes to world** reverses it.
- Connections are read and written in Hammer's ESC-separated format; old comma-separated maps are read too.

### Map settings

The Settings panel gathers the map-wide setting entities into cards. They are stored as the standard entities, so
Hammer and existing maps work as before.

| Card | Entity | Added when compiling |
|---|---|---|
| Sky | worldspawn `skyname` | always set |
| Sun & ambient light | `light_environment` | yes |
| Dynamic shadows | `shadow_control` | yes |
| Fog | `env_fog_controller` (master) | yes |
| Exposure & bloom | `env_tonemap_controller` + `logic_auto` | yes |
| Colour correction | `color_correction` (lookup table picker) | |
| Post-processing | `postprocess_controller` (master) | |
| Dynamic sun (deferred) | `light_deferred_global` | |
| Ambient sound | `env_soundscape` with radius -1 | |
| Wind, detail props, water quality, music | `env_wind`, `env_detail_controller`, `water_lod_control`, `wars_music_controller` | |

- A card marked **Default** is not in the map yet: compiling adds it to the compiled copy with defaults taken from
  the shipped maps. Changing a value stores it in the map. The switch turns a setting off, and a default one then
  stays out of the compile (`she_settings_off` on worldspawn).
- Exposure and bloom have no entity keys: as in the shipped maps, a `logic_auto` sends `SetAutoExposureMin/Max`,
  `SetBloomScale` and `SetTonemapRate` to the controller on spawn. The card reads and edits that wiring.

## Generators

The **Generate** button on the rail (G) opens a menu of generators. Pick one with its number (Enter repeats the
last), place it (drag a footprint or click points), tune its settings while it rebuilds in place, and press Enter
when done. Esc steps back from Tune to Place to the menu. With a block brush selected, the footprint generators
fill that brush instead. The whole generate is one undo step.

| Key in menu | Generator | Placed by | Reference |
|---|---|---|---|
| 1 | Building | drag | [generators/buildings.md](generators/buildings.md) |
| 2 | Building block | drag | [generators/buildings.md](generators/buildings.md) |
| 3 | Simple interior building | drag | [generators/interior-buildings.md](generators/interior-buildings.md) |
| 4 | Custom interior building | the room designer | [generators/rooms.md](generators/rooms.md) |
| 5 (or 7 anywhere) | Road | click points | [generators/roads-powerlines.md](generators/roads-powerlines.md) |
| 6 (or 9 anywhere) | Powerline | click points | [generators/roads-powerlines.md](generators/roads-powerlines.md) |
| 7 (or P anywhere) | Point of interest | drag | [generators/points-of-interest.md](generators/points-of-interest.md) |
| 8 | Stairs | click A, B and the height | below |

Shift while dragging a footprint makes it square.

**Stairs**: click A (the foot), then B; B's height follows the mouse, the wheel or typed digits, and a click or
Enter confirms. Every further click adds a flight from the last point, Shift+click branches from a landing (a T
junction), Backspace takes a point back, Enter or a double click finishes. The options set the plan (blocky or any
angle), steps or a ramp, step count, rise and tread, width, structure (solid, sloped under, open, floating, on
posts), side beams, rails and materials. Rises stay at most 16 units (units climb 18) and a `TOOLS/TOOLSNPCCLIP`
ramp lies on the step nosings so the navmesh sees one slope. Large units need flights at least 192 wide.

Whole maps are generated with **Sketch** and **Generate map** in the top bar: see
[generators/maps.md](generators/maps.md).

### Handles

Points of interest, blocks of buildings, stairs and interior buildings get an editor-only **handle**: a faint box
over what they made. A click on the handle, or on anything the generator made, selects the whole thing, and the
Selection panel shows its settings with **Regenerate**, **Re-roll** (new seed) and **Delete**. Moving (W) or
resizing (R) the handle rebuilds it to fit when the drag ends, in the same undo step. Comma and period turn a POI or
block a quarter turn, Ctrl+D copies a POI, block or stairs, and Delete removes any of them with everything it made. Hide the handles (**Handles**
in the view bar) to pick single props and brushes inside.

## Editor data in the VMF

Generators store their settings in keys on the entities they make, so they can be rebuilt later; Hammer ignores
them. Compiling removes the handles and the settings keys (`EDITOR_KEYS` in `src/gen/handle.ts`; vbsp stops on keys
over 1,024 characters) but keeps the id keys, which map logic may use to find members.

| Key | On | Holds |
|---|---|---|
| `she_buildings`, `she_building_world`, `she_building_id`, `she_building_group` | block func_detail, its world brushes, entities, street dressing | footprint and every building option, by name |
| `she_poi`, `she_poi_id` | POI func_detail, its entities | type, seed, rectangle, rotation, ground height, parameters |
| `she_road` | road func_detail | points, style, widths, street materials |
| `she_rooms`, `she_rooms_world` | interior building func_detail, its world brushes | the room plan |
| `she_stairs`, `she_stairs_world` | stairs func_detail, clip ramp ids | points, heights and options |
| `she_mission` | entities built from the flowchart | marks them for replacement on the next build |
| `she_settings_off` | worldspawn | map settings switched off |
