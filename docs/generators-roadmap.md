# Roadmap: interior buildings and points of interest

Two plans, one order:

- [interior-buildings-plan.md](interior-buildings-plan.md): open-top houses units can walk into
  (interior phases I1–I6).
- [poi-generator-plan.md](poi-generator-plan.md): playgrounds, markets, squares, parks, sport fields,
  parking lots and about 35 more points of interest (POI phases P0–P7).

## Dependencies

```
I1 planner ─► I2 shell ─► I3 furniture ─► I4 stairs ─┐
                  │                                   ├─► I5 integration ─► I6 test map
                  └──── interiorHouse() API ──┐       │
P0 framework ─► P1 square/parking/playground ─► P2 park/market ─► P3 sport fields
                                              └─► P4 city set (gas station needs I2)
                                                  P5 rural set (farmstead, chapel need I2)
                                                  P6 coast/rocky + water
                                                                      └─► P7 map integration
```

- The **POI framework and the first three POI phases don't depend on interiors at all**. They can be
  built at the same time as I1–I4.
- POIs that contain an enterable building (gas station kiosk, farmhouse, chapel, beach huts,
  lighthouse keeper's house) need I2. Until then they use a solid box and say so.
- **I5 and P7 both edit the shared generator entry points** (`src/ui/inspector.ts`, `src/gen/sketch.ts`,
  `src/gen/layout.ts`). Do them one after the other, not in parallel.

## The shared contract: `interiorHouse()`

Interior phase 2 exports one function the POI generator calls, so the POI track can code against it
before it exists (stub it with a solid box):

```ts
// src/gen/interiorHouse.ts
export interface InteriorHouseOptions {
  seed: number;
  storeys?: 1 | 2;          // default 1
  style?: InteriorStyleName; // from INTERIOR_STYLES, default by landscape
  cutHeight?: number;        // default 112
  furnish?: 'none' | 'sparse' | 'full';
  lights?: boolean;
  wideDoors?: boolean;
  /** Footprint edges that must get an entrance (e.g. the side facing the POI's centre). */
  entranceEdges?: number[];
}
export function interiorHouse(doc: VmfDocument, footprint: Vector2[], z0: number, opts: InteriorHouseOptions):
  { world: KVNode[]; detail: KVNode[]; entities: FeatureEntity[] };
```

## Running both tracks at once

This works with two Claude sessions, each in its own git worktree of this repo (its own folder and
branch):

| Session | Branch | Phases | Owns these files |
|---|---|---|---|
| Interiors | interior buildings | I1 → I6 | `src/gen/interiorPlan.ts`, `interiorShell.ts`, `interiorDressing.ts`, `interiorHouse.ts` (replaces the stub), `INTERIOR_STYLES` in `styles.ts` |
| POIs | points of interest | P0 → P7 | `src/gen/poi/*`, `src/edit/poiTool.ts`, `src/ui/poiPanel.ts` |

The POI branch calls `interiorHouse()` but never edits `src/gen/interiorHouse.ts`, so its houses are
solid boxes on that branch and become real houses once both branches are merged. I5 and P7 both touch
`inspector.ts`, `sketch.ts` and `layout.ts`; expect to resolve small conflicts there when merging.

**Prepare `main` first:**

1. Commit the three plan files. A worktree starts from the last commit, so uncommitted files aren't in it.
2. Make the dev server port configurable. `vite.config.ts` pins 5190 with `strictPort: true`, so a
   second worktree's server fails. For example: `port: Number(process.env.SHE_PORT ?? 5190)`, and a
   second `.claude/launch.json` entry on 5191.
3. Add the `interiorHouse()` signature above as a stub that builds a solid box, so the POI track can
   call it from day one.

**While both run:**

- Each worktree needs its own `npm install`; `editor.config.json` is gitignored and falls back to
  auto-detecting the install.
- Both sessions compile into the same Lambda Wars install. Use different map names
  (`interiors_test`, `poi_showcase`), and only one session at a time should launch the game or build a
  navmesh (`srcds`).
- Registering the new tool and panel in `src/ui/sidebar.ts` / `toolbar.ts` is a one-line change on
  each side; expect a small merge conflict there and nowhere else.
