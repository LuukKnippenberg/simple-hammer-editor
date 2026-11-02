# Compiling and testing in game

**▶ Compile & test** in the top bar compiles the open map against the active Lambda Wars install and launches the
game on it. The dev server does the work (`server/compile.ts`), so it needs the install and the Alien Swarm SDK
tools (see [Setup in the README](../README.md#setup)).

## Pre-flight checks

Before compiling, the dialog checks the map and offers one-click fixes:

- the map has geometry;
- it is sealed by a sky shell of world brushes, so it doesn't leak;
- a sun (`light_environment`) and a camera spawn (`info_player_start`);
- a map boundary (`func_map_boundary`: camera limits and fog-of-war height data);
- every `prop_static` uses a static model: props vbsp would delete (no `$staticprop`, or a model moved without
  being recompiled so its vertex data can't be found) get **Convert to prop_dynamic**.

Maps made by **New**, **Sketch** or **Generate map** pass every check without fixes. The mission flowchart's errors
are listed in the compile log.

## What the compile does

1. A copy of the map gets the compile-only changes: missing map settings added with their defaults, generator
   handles and settings keys stripped, the mission flowchart built into entities. The server writes it to a work
   folder (`.compile/`).
2. `vbsp`, then `vvis` (skipped with a warning when the map leaks), then `vrad -hdr` (Lambda Wars maps use HDR
   lighting only). **Quality**: *Fast* runs `vvis -fast` and `vrad -fast`, *Final* full `vvis` and `vrad -final`.
3. Editor materials (MultiBlend terrain blends) are packed into the BSP with `bspzip`.
4. The BSP is installed into the game's `lambdawars/maps/`. Maps named `sp_*` also get the `maps/<name>.res`
   entry the game's mission list reads.
5. **Navmesh** (on by default): a hidden `srcds.exe` loads the map and runs `recast_build` from a temporary server
   config, which also writes the fog-of-war heightmap. The config sets
   `recast_build_remove_unreachable_polys 0`: otherwise the build prunes every polygon it can't reach from an
   `info_start_wars`, which in this engine build removes them all. The editor stops the server once all five
   meshes are saved.

The tool output streams into the dialog.

## Launching

**▶ Launch game** starts `lambdawars.exe -game lambdawars -windowed -noborder -w 1600 -h 900 -dev +map <name>`.
`sp_` maps launch with the mission gamerules (a listen-server config runs `wars_setgamerules mission`) and
`+maxplayers 1`: `point_viewcontrol` cutscenes only find the player on a one-slot server, as missions run.

## From the command line

`scripts/compile-map.mjs` compiles a map from `maps/` the same way, without the browser, optionally into another
install:

```bash
node --experimental-transform-types scripts/compile-map.mjs c17_district --install "<game root>"
```

## Engine limits to know

| Limit | What hits it | What the editor does |
|---|---|---|
| 65,536 t-junctions in vbsp ("Too many t-junctions") | facade decoration, window holes, roofs on wall tops, walls flush with neighbours | building quality per block (High, Medium, Filler) and auto detail; station and interior relief in brush entities; pavements stop short of the building line |
| 65,536 unique vertexes | moving all decoration into brush entities | keeps most decoration as `func_detail` |
| 1,024 characters per key in vbsp | generator settings keys | stripped from the compiled copy |
| 64K detail props | grass detail sprites on very large terrain | large showcase maps use terrain without detail sprites |
| Engine hunk memory on load | full lightmap detail on the surroundings band | lightmap scale 64 beyond the playable area |
| Recast climb 18 and max slope 45° | steps and ramps | steps rise 16; stairs and bleachers get an NPC clip ramp |

`scripts/tjunc-budget.mjs` measures where the t-junction budget goes. It builds variants of a map (without
buildings, roads, POIs or interiors, every block at one quality, decoration level 0 to 3), runs vbsp and vbspinfo
on each in parallel and prints the t-junction count, its share of the limit, and brush, vertex and face counts:

```bash
node --experimental-transform-types scripts/tjunc-budget.mjs sp_tutorial_combine --variants base,filler,no-pois
```

## Checking a map in game

- `scripts/poi-navcheck.mjs <map>` loads the compiled map in a hidden dedicated server and asks the game's own
  `NavMeshGetPathDistance` for a path along every POI route, with a human-size and a large probe. A path longer
  than 1.3 times the straight line counts as a detour. Results go to `docs/poi-navcheck-<map>.json`.
- Test maps can log their own progress: a `trigger_multiple` or a mission stage that echoes a marker, read back
  from `console.log` with `-condebug`.
- `scripts/capture-window.ps1 -Out shot.png` captures the game window.

## Known issue

On the development machine the game's in-game web UI (CEF) fails to start its helper process
(`lambdawars_browser.exe`), also when launched by hand, so the HUD stays on "Loading CefViewPort" and the game ends
the session after about a minute. Maps load and play until then; message boxes and objectives can't be seen.
