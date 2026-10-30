// Shared setup for the POI demo scripts: an empty map with a sun, a ground plane and the lighting preview.
import { launch, driver } from './browser.mjs';

export async function poiSession(name, { ground = 'NATURE/BLENDGRASSGRAVEL002B', size = 4096, terrain = false } = {}) {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('  [console]', m.text()); });
  page.on('dialog', (dlg) => dlg.accept());
  const d = driver(page);
  await d.open('repo:phase3_arena.vmf');
  await d.eval(async ([name, ground, size, terrain]) => {
    const W = window.__editor, ed = W.editor;
    const { VmfDocument } = await import('/src/vmf/map.ts');
    const { boxSolid } = await import('/src/edit/brushes.ts');
    const { SETTING_GROUPS, createGroupEntity, writeField } = await import('/src/lw/mapSettings.ts');
    const Vector3 = ed.camera.position.constructor;
    const doc = VmfDocument.empty();
    const sun = SETTING_GROUPS.find((g) => g.id === 'sun');
    createGroupEntity(doc, sun);
    writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun height'), '-42');
    writeField(doc, sun, sun.fields.find((f) => f.label === 'Sun direction'), '215');
    ed.loadDocument(doc, name);
    const h = size / 2;
    if (terrain) {
      const { terrainPatch } = await import('/src/gen/layout.ts');
      for (let x = -h; x < h; x += 512) for (let y = -h; y < h; y += 512) {
        doc.addSolid(terrainPatch(doc, x, y, 512, ground, (px, py) => 24 * Math.sin(px / 700) + 18 * Math.cos(py / 530), () => 0));
      }
    } else {
      doc.addSolid(boxSolid(doc, new Vector3(-h, -h, -64), new Vector3(h, h, 0), ground));
    }
    ed.changed();
    if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
  }, [name, ground, size, terrain]);
  await d.settle(800);
  return { browser, page, d };
}

/** Generates a POI through the editor's action (same path as the tool), returns its uid. */
export async function makePoi(d, type, rect, opts = {}) {
  return d.eval(async ([type, rect, opts]) => {
    const ed = window.__editor.editor;
    const { generatePoi, poiType } = await import('/src/gen/poi/action.ts');
    const e = generatePoi(ed, poiType(type), { x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3] }, opts.z ?? 0, opts);
    ed.selection.clear();
    return e.get('she_poi_id');
  }, [type, rect, opts]);
}

/** The RTS camera: pitch 65 looking down from the south-east like the game's spawn camera. */
export function rtsView(d, target, dist = 1500) {
  const yaw = (135 * Math.PI) / 180, pitch = (65 * Math.PI) / 180;
  const back = dist * Math.cos(pitch), up = dist * Math.sin(pitch);
  return d.view([target[0] - Math.cos(yaw) * back, target[1] - Math.sin(yaw) * back, (target[2] ?? 0) + up], target);
}
