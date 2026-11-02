# Development

## Commands

```bash
npm test             # unit tests (vitest)
npm run typecheck    # tsc --noEmit, strict
npm run build        # typecheck + production bundle in dist/
npm run dev          # dev server on http://localhost:5190
```

The tests run without the game install: the dev-server tests (`tests/server.test.ts`) use a temporary root, and the
round-trip tests read the VMFs in `maps/` and, when the install is found, the game's `mapsrc/`.

## Running several checkouts

Git worktrees (under `.claude/worktrees/`) can each run their own dev server: `SHE_PORT` picks the port (the
default 5190 is strict, so a second server on it fails instead of moving):

```bash
SHE_PORT=5203 npm run dev
```

Scripts that drive the browser read `EDITOR_URL` (default `http://localhost:5190/`), so point them at the matching
port. Copy `editor.config.json` into the worktree if the main checkout has one; it is not tracked.

## Source layout

| Folder | Contents |
|---|---|
| `src/vmf/` | KeyValues parser and writer (shared with VMT), typed wrappers (`MapSide`, `MapSolid`, `MapEntity`) that write back into the tree |
| `src/geom/` | brush geometry: faces from clipped planes, displacements |
| `src/assets/` | VMT, VTF, MDL/VVD/VTX and PCF readers, FGD access, thumbnails |
| `src/render/` | world, entity, decal and rope renderers, camera controls, top view, lighting preview, overlays |
| `src/edit/` | tools, selection, history (undo), brush editing, terrain, decals, generators' tool flows |
| `src/gen/` | generators: buildings, interiors, rooms, roads, powerlines, POIs, stairs, sketch and layout |
| `src/lw/` | Lambda Wars specifics: kits, unit catalogue, mission flowchart, map settings, map templates, cinematics |
| `src/audio/` | soundscape parsing and the audio preview |
| `src/ui/` | panels, dialogs, toolbar, sidebar |
| `src/examples/` | the example maps' layouts and set pieces |
| `server/` | the Vite plugin: config and install detection, asset serving from VPKs and loose files, FGD, models, map save, compile and launch |
| `content/` | editor materials packed into compiled maps |
| `tests/` | vitest suites |

The dev-server routes (`server/plugin.ts`) are under `/api/`: `maps`, `map`, `map/save`, `autosave`, `sketch`,
`mission`, `mapres`, `file`, `list`, `models`, `fgd`, `blend`, `config`, `install`, `compile` (streams the tool
output) and `launch`.

## Scripted runs and screenshots

`scripts/browser.mjs` launches the system Chrome or Edge headless with the GPU on (through `playwright-core`, no
browser download) and wraps a page with editor helpers: `open(map)`, `view(pos, target)`, `click`, `drag`, `key`,
`shot(name)` (saved to `docs/screenshots/`) and `eval`. The page exposes `window.__editor` for this: the editor,
panels, lighting, the sketch and mission dialogs, `setView`, `project` (world point to page coordinates) and
`busy()`. Vite serves the source as modules, so a script can also `import('/src/...')` inside the page and call the
same functions the UI does.

`npm run screenshot -- <shots.json>` captures a list of views (map, camera, optional JS before and after) without a
script of its own.

`docs/screenshots/` is ignored by git, because the scripts regenerate it. Images the docs link are added with
`git add -f`.

## Generated source files

| File | Regenerate with |
|---|---|
| `src/lw/unitCatalog.ts` | `python scripts/gen-unit-catalog.py [<game root>]` |
| `src/lw/gameAbilities.ts` | `node scripts/extract-abilities.mjs [<game>/lambdawars]` |
| model bounds for the generators' tables | `EDITOR_URL=… node scripts/model-bounds.mjs <model> …` |

## Building and checking maps

- The example and test maps have build scripts (`scripts/build-*.mjs`, `scripts/*-demo.mjs`, see
  [example-maps.md](example-maps.md)). Scripts that import TypeScript from `src/` run with
  `node --experimental-transform-types`.
- `scripts/compile-map.mjs`, `scripts/tjunc-budget.mjs` and `scripts/poi-navcheck.mjs` compile, budget and
  route-check maps without the browser: see [compiling.md](compiling.md).
- In game: `scripts/capture-window.ps1 -Out shot.png` captures the game window, and `scripts/she_unitprobe.py`
  (copied to the game's `cfg/`) prints unit heights for `sp_unit_kits_test`.
