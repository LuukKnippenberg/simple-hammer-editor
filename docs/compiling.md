# Compiling and testing in game

**▶ Compile & test** in the top bar compiles the open map against the active Lambda Wars install and launches the
game on it. The dev server does the work (`server/compile.ts`), so it needs the install and the Alien Swarm SDK
tools (see [Setup in the README](../README.md#setup)).

## Map checklist and pre-flight checks

The chip in the top bar ("Annihilation 5/7 ready") counts what the map's game mode needs. Its border is green when
nothing is left to fix, amber otherwise. Click it for **Ready to play?**: the mode and player count, a progress bar
and one row per check (✓ ready, ! or ✕ missing, – not checked yet) with a detail and, where the editor can do it, a
**Fix**. A fix is one undo step. The chip updates as you edit (a moment after each change) and never blocks saving.

The mode comes from the map (`detectMode` in `src/edit/preflight.ts`): the name prefix first (`hlw_` Annihilation,
`or_` Overrun, `sp_` mission), then an `overrun_manager` or wave spawn, mission data (a flowchart,
`wars_player_setup` or `wars_mission_objective`), player starts; otherwise *Empty*. **Change mode** shows another
mode's list without changing the map; opening or creating a map goes back to the mode it reads as.

| Mode | Checks |
|---|---|
| Annihilation | Player starts (numbered, at least 2; says whether they are symmetric), Resources (requisition points and scrap), Sky shell, Sun light, Name (`hlw_`), Map boundary, Units can reach every base |
| Overrun | Player starts (together in the centre), Wave spawns, Overrun manager (wave type; **Fix** adds one), Sky shell, Sun light, Map boundary |
| Singleplayer mission | Player camera (`info_player_wars`; **Fix** adds one), Mission flow (a way to win and to lose, no flowchart errors), Every objective area reachable, Name (`sp_`), Sky shell, Sun light, Map boundary |
| Empty | Sky shell, Sun light, Map boundary, and **Pick a mode**, which switches to another mode's list (counted, never ready: an Empty map isn't ready to play until it has a mode) |

"Units can reach every base" and "Every objective area reachable" are the path check, which isn't built yet. They
show "Not checked yet", count toward the total but never as ready, and don't keep the chip amber: a new
Annihilation map reads "6/7 ready" in green.

**Compile & test** shows the same list for the same mode, then what only Compile checks:

- the map has geometry;
- a camera spawn (`info_player_start` or `info_player_wars`);
- every `prop_static` uses a static model: props vbsp would delete (no `$staticprop`, or a model moved without
  being recompiled so its vertex data can't be found) get **Convert to prop_dynamic**.

The compile dialog's buttons say what each fix does, and **Fix all** runs every fix. Fixes that place things around
the map's content (sky shell, sun, spawn, boundary) aren't offered until the map has some.

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
