// Editor screenshots of the interior buildings' outsides: Garden District's station and customs house on a plain
// square, seen from the RTS camera's side (south-east), close up and from further off.
//   node scripts/facade-preview.mjs [prefix]
import { withEditor } from './browser.mjs';

const prefix = process.argv[2] ?? 'facade';

await withEditor(async (d) => {
  await d.open('repo:phase3_arena.vmf');
  const at = await d.eval(async () => {
    const W = window.__editor, ed = W.editor;
    const { VmfDocument } = await import('/src/vmf/map.ts');
    const { boxFaces, solidNode } = await import('/src/edit/brushes.ts');
    const { addEnvironment, finishDoc } = await import('/src/gen/layout.ts');
    const { storedRoomBuilding } = await import('/src/gen/rooms/store.ts');
    const { customsSpec, stationSpec } = await import('/src/examples/gardenDistrict.ts');
    const { Vector3 } = await import('/node_modules/three/build/three.module.js');
    const doc = VmfDocument.empty();
    doc.world.set('skyname', 'sky_day01_01');
    const solids = [], ents = [];
    solids.push(solidNode(doc, boxFaces(new Vector3(-1024, -1024, -64), new Vector3(5120, 4096, 0), { top: 'STONE/STONEFLOOR006D', bottom: 'TOOLS/TOOLSNODRAW', sides: 'TOOLS/TOOLSNODRAW' })));
    const place = (spec, x, y) => ({ ...spec, origin: { x, y, z: 0 } });
    const st = storedRoomBuilding(doc, place(stationSpec(0), 0, 1600));
    const cu = storedRoomBuilding(doc, place(customsSpec(0), 2400, 0));
    for (const b of [st, cu]) { solids.push(...b.world); ents.push(...b.entities); }
    addEnvironment(doc, solids, ents, { width: 6144, height: 5120, apron: 256, maxHeight: 768, sunYaw: 215, sunPitch: -52, fogColor: '185 195 205' });
    ed.loadDocument(finishDoc(doc, solids, ents, new Vector3()), 'facade_preview.vmf');
    if (!W.lighting.enabled) { W.lighting.setEnabled(true); ed.emit('lighting'); }
    W.lighting.refresh();
    const c = (b) => [(b.layout.bounds.x0 + b.layout.bounds.x1) / 2, (b.layout.bounds.y0 + b.layout.bounds.y1) / 2, b.layout.bounds];
    return { station: c(st), customs: c(cu) };
  });
  await d.eval(() => { window.__editor.editor.gridHelper.visible = false; });
  await d.settle(4000);
  for (const [name, [x, y, b]] of Object.entries(at)) {
    // The south-east corner close up, and the whole building.
    await d.view([b.x1 + 260, b.y0 - 420, 330], [b.x1 - 420, b.y0 + 60, 170]);
    await d.settle(1500);
    await d.shot(`${prefix}-${name}-corner`);
    await d.view([x + 1500, y - 1500, 1700], [x, y, 0]);
    await d.settle(1500);
    await d.shot(`${prefix}-${name}`);
  }
});
