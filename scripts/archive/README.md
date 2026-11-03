# Archived demo scripts

These scripts are kept for reference and are not maintained. Some fail against the current UI.

None of them checks results: they drive the editor and save screenshots to `docs/screenshots/`. Run one from the
repo root against a dev server, for example `node scripts/archive/roads-demo.mjs`.

Two of them write outside the screenshots folder:

- `mission-flow-demo.mjs` saves `maps/sp_sofia.mission.json`, overwriting the committed mission.
- `phase4-demo.mjs` compiles a map into the game install.

The checked scripts are the `scripts/*-test.mjs` files; the example maps are built by `scripts/build-*.mjs` and the
other `scripts/*-demo.mjs` files.
