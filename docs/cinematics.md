# Cinematics and atmosphere

Tools for scripted scenes: the **Cinema** panel and the **Cinema tool** (C). Everything is built from stock
entities the game already has, the way the shipped missions (`sp_valley`, `sp_radio_tower`) do their cutscenes, so
no game code is needed. Each piece is triggered by one input, which a mission stage action or any output can fire.
Code: `src/lw/cinematics.ts`, `cinematicsAction.ts`, `particles.ts`, `src/edit/cinemaTool.ts`,
`src/ui/cinemaPanel.ts`, `src/render/cinemaPreview.ts`, `cinematicsRenderer.ts`.

| Piece | Built from | Trigger |
|---|---|---|
| 🎬 Camera shot | `point_viewcontrol` looking at an `info_target`, moving to a `path_corner` | `<shot> → Enable` |
| 🛤 Unit route | `path_track` nodes, a `<path>_go` relay with `Order` / `QueueOrder` | `<path>_go → Trigger` |
| ✈ Flyby | `func_tracktrain` on the path carrying a dropship or gunship model | `<path>_flyby → StartForward` |
| 🎥 Follow the flyby (untested) | `wars_player_follow_entity` + relay | `<path>_flyby_go → Trigger` |
| ✦ Particles | `info_particle_system` | `Start`, `Stop`, `DestroyImmediately`, `Kill` |
| 📺 Screen to static | two `func_brush` panels | `<screen>_static → Enable` / `Disable` |
| 🌫 Atmosphere | a relay driving `env_fog_controller` and a `color_correction` | `<preset> → Trigger` |

## Camera shots

- Frame the shot in the viewport and click **+ Shot from current view**: the camera goes where the editor camera
  is and looks at the middle of the screen. **End = view** turns it into a move to a second position; **Look at
  screen centre** and **Length** change it.
- **▶ Preview** plays it in the viewport between letterbox bars, moving the way the engine moves a
  `point_viewcontrol` (speed ramp and smoothing from `CTriggerCamera::Move`). The shot freezes the player and hands
  the view back after its length. An orange frustum and line show each shot.
- `point_viewcontrol` takes the player from the input's activator, or else from `UTIL_GetLocalPlayer()`, which
  returns nothing on a server with more than one slot. Stage actions, `logic_auto`, timers and relays fire without
  a player, so their shots only work with `maxplayers 1`; the editor launches `sp_` maps that way.

## Paths, routes and flybys

- In *Path* mode the Cinema tool adds nodes at a height above the clicked surface; a selected end node keeps
  extending its path, Esc starts a new one. Selecting a node offers its height (or the whole path's), removing it,
  and closing or opening a loop.
- **Units along a path**: `<path>_go` gives the named unit `Order` to the first node and `QueueOrder` to the rest.
  **Can't be hurt** adds `MakeImmortal`, **AI-controlled** adds `MakeUncontrollable`. Units walk or fly at their own
  height, so ground routes need nodes on the navmesh.
- **Flybys**: a `func_tracktrain` follows the nodes at their exact heights carrying a dropship, dropship with
  container, gunship or helicopter model. It is a model, not a unit; spawn real reinforcements where it lands. The
  follow camera fires its inputs but the RTS camera doesn't track the model, so use a camera shot aimed at the route.

## Particles and screens

- The particle picker lists every effect in the PCF files `particles_manifest.txt` loads (`src/assets/pcf.ts` reads
  the names from the binary DMX), with favourites: smoke column, skyline smoke, burning car, fires, embers, sparks.
  The viewport draws each as a puff sized and coloured by a guess from its name; there is no PCF renderer.
- *Screen* mode puts a picture panel on the clicked wall and, a unit in front of it, a static panel
  (`effects/screen_monitor_blank`) that starts disabled. Animated texture swaps aren't possible: none of the game's
  materials has a `ToggleTexture` or `MaterialModify` proxy.

## Atmosphere

Presets the mission blends between, each a `logic_relay` that sets the fog's lerp targets (colour, start, end) and
lerp time, starts the transition and fades its own `color_correction` in while the others fade out. The defaults
follow a day-to-night arc: grey daylight, dusk with fires (orange fog, `cc_thunder`) and Citadel glow (blue fog,
`ep2_outland_01_blue`). **👁 Preview** shows the fog and a tint approximating the colour table in the viewport.

The sun and ambient light can't change at runtime: lightmaps are baked, and `light_environment` becomes a
`light_deferred_global` without inputs at map start. A lighting arc is fog, colour correction, particles and sound.

Test map: `maps/sp_cine_test.vmf` (a camera move, a dropship flyby, smoke and a burning car, a screen and two
atmosphere presets, all fired from `logic_auto`).
