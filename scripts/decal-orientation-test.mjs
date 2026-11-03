// Decals and overlays come out right side up: decal_posters005a placed with the Decal tool as an infodecal and as an
// info_overlay on each face of a pillar (+X, −X, +Y, −Y) and on the floor. Checks the preview (the texture's top row,
// v = 0, is up on walls and its left, u = 0, is on the viewer's left; on the floor its top is north) and the overlay
// keys (V = U × N, down on walls). Exits non-zero when a check fails. Against a running dev server:
//   SHE_PORT=5207 node scripts/decal-orientation-test.mjs [--shots <dir>]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withEditor } from './browser.mjs';

const shotsAt = process.argv.indexOf('--shots');
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const DECAL = 'decals/decal_posters005a';

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

await withEditor(async (d, page) => {
  await d.open('repo:phase3_arena.vmf');
  await page.click('#topbar button:has-text("New")');
  await page.dblclick('.newmap [data-template="empty"]');
  await d.settle();

  // A pillar 512 wide and 384 high in the middle of the ground.
  await d.eval(async () => {
    const ed = window.__editor.editor;
    const { boxSolid } = await import('/src/edit/brushes.ts');
    const Vector3 = ed.camera.position.constructor;
    const pillar = ed.doc.addSolid(boxSolid(ed.doc, new Vector3(-256, -256, 0), new Vector3(256, 256, 384), 'DEV/DEV_MEASUREGENERIC01'));
    ed.history.added('Add pillar', [pillar]);
    ed.changed();
    ed.tools.set('decal');
  });
  await d.settle(300);

  /** Places with the Decal tool: a click where the world point is on screen. */
  const place = async (mode, p) => {
    await d.eval((m) => { const ed = window.__editor.editor; Object.assign(ed.decal, { material: 'decals/decal_posters005a', mode: m, size: 192, rotation: 0 }); }, mode);
    await d.click(p);
    await d.settle(300);
  };
  /**
   * The preview quads near `at`: how far the texture's top row (v = 0) sits above its bottom row along `up`, and its
   * left column (u = 0) to the left of its right column along `right`. Both positive when it reads right side up.
   */
  const preview = (at, up, right) => d.eval(([at, up, right, name]) => {
    const ed = window.__editor.editor;
    const mesh = ed.decals.group.children.find((m) => m.material === ed.decals.info(name).material);
    if (!mesh) return null;
    const pos = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
    const dot = (i, a) => pos.getX(i) * a[0] + pos.getY(i) * a[1] + pos.getZ(i) * a[2];
    let top = 0, bottom = 0, left = 0, rightSum = 0, nt = 0, nb = 0, nl = 0, nr = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.hypot(pos.getX(i) - at[0], pos.getY(i) - at[1], pos.getZ(i) - at[2]) > 150) continue;
      const v = uv.getY(i), u = uv.getX(i);
      if (v < 0.01) { top += dot(i, up); nt++; } else if (v > 0.99) { bottom += dot(i, up); nb++; }
      if (u < 0.01) { left += dot(i, right); nl++; } else if (u > 0.99) { rightSum += dot(i, right); nr++; }
    }
    if (!nt || !nb || !nl || !nr) return null;
    return { upright: top / nt - bottom / nb > 1, leftToRight: rightSum / nr - left / nl > 1 };
  }, [at, up, right, DECAL]);
  const lastOverlay = () => d.eval(() => {
    const e = window.__editor.editor.doc.entities.filter((x) => x.classname === 'info_overlay').at(-1);
    return { U: e.get('BasisU'), V: e.get('BasisV'), N: e.get('BasisNormal') };
  });
  const shot = async (name) => {
    if (!shots) return;
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(shots, `${name}.png`) });
    console.log(`  saved ${name}.png`);
  };

  // n: the face's normal; right: the viewer's right looking at it.
  const faces = [
    { name: 'plus-x', n: [1, 0, 0], right: [0, 1, 0] },
    { name: 'minus-x', n: [-1, 0, 0], right: [0, -1, 0] },
    { name: 'plus-y', n: [0, 1, 0], right: [-1, 0, 0] },
    { name: 'minus-y', n: [0, -1, 0], right: [1, 0, 0] },
  ];
  for (const f of faces) {
    const at = (h) => [f.n[0] * 256, f.n[1] * 256, h];
    await d.view([f.n[0] * 900, f.n[1] * 900, 200], [f.n[0] * 256, f.n[1] * 256, 200]);
    await d.settle(300);
    await place('decal', at(300));
    await place('overlay', at(90));
    check(`${f.name} infodecal preview`, await preview(at(300), [0, 0, 1], f.right), { upright: true, leftToRight: true });
    check(`${f.name} overlay preview`, await preview(at(90), [0, 0, 1], f.right), { upright: true, leftToRight: true });
    const o = await lastOverlay();
    check(`${f.name} overlay keys`, o, { U: f.right.join(' '), V: '0 0 -1', N: f.n.join(' ') });
    await shot(`${f.name}-wall`);
  }

  // Floor, seen from above with north up: the texture's top points north (+Y), its left west.
  await d.eval(() => window.__editor.setView([600, -701, 1100], [600, -700, 0]));
  await d.settle(300);
  await place('decal', [480, -700, 0]);
  await place('overlay', [760, -700, 0]);
  check('floor infodecal preview', await preview([480, -700, 0], [0, 1, 0], [1, 0, 0]), { upright: true, leftToRight: true });
  check('floor overlay preview', await preview([760, -700, 0], [0, 1, 0], [1, 0, 0]), { upright: true, leftToRight: true });
  check('floor overlay keys', await lastOverlay(), { U: '1 0 0', V: '0 -1 0', N: '0 0 1' });
  await shot('floor-from-above');

  // All four walls at once.
  await d.view([900, -900, 700], [0, 0, 150]);
  await d.settle(300);
  await shot('pillar-plus-x-minus-y');
  await d.view([-900, 900, 700], [0, 0, 150]);
  await d.settle(300);
  await shot('pillar-minus-x-plus-y');
});

if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
