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

## Development

```bash
npm test           # unit tests (vitest)
npm run typecheck
npm run screenshot -- scripts/shots/phase0.json   # needs the dev server running
node scripts/phase3-demo.mjs                      # scripted editing session with screenshots
```
