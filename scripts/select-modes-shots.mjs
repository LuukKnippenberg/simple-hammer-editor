// Face / edge / vertex selection modes and face extrude, on a few boxes. Shots are named selmodes-*.
//   node scripts/select-modes-shots.mjs
import { withEditor } from './browser.mjs';

await withEditor(async (d, page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { errors.push(m.text()); console.log('  [console]', m.text()); } });
  await d.open('repo:phase3_arena.vmf');

  // An empty map: a floor and two boxes.
  await d.eval(async () => {
    const ed = window.__editor.editor;
    const { VmfDocument } = await import('/src/vmf/map.ts');
    const { boxSolid } = await import('/src/edit/brushes.ts');
    const V = ed.camera.position.constructor;
    const doc = VmfDocument.empty();
    ed.loadDocument(doc, 'select_modes.vmf');
    doc.addSolid(boxSolid(doc, new V(-1024, -1024, -32), new V(1536, 1024, 0), 'NATURE/BLENDGRASSGRAVEL002B'));
    doc.addSolid(boxSolid(doc, new V(0, 0, 0), new V(256, 256, 192), 'CONCRETE/CONCRETEFLOOR001A'));
    doc.addSolid(boxSolid(doc, new V(512, 0, 0), new V(768, 256, 128), { top: 'CONCRETE/CONCRETEFLOOR001A', bottom: 'TOOLS/TOOLSNODRAW', sides: 'BRICK/BRICKWALL017A' }));
    ed.changed();
    ed.grid = 16;
  });
  const view = () => d.view([-420, -820, 640], [380, 140, 60]);
  await view();
  await d.settle(1200);

  const state = () => d.eval(async () => {
    const ed = window.__editor.editor;
    const { buildBrushFaces } = await import('/src/geom/brush.ts');
    const sel = ed.selection;
    return {
      mode: sel.mode, parts: sel.parts.length, brushes: ed.doc.allSolids().length,
      faces: ed.doc.allSolids().map((s) => buildBrushFaces(s).length),
      undo: ed.history.undoLabel,
      tops: ed.doc.allSolids().slice(1).map((s) => Math.max(...buildBrushFaces(s).flatMap((f) => f.verts.map((v) => v.z)))),
    };
  });
  /** Drags the gizmo's axis handle by a screen offset. */
  async function dragGizmo(axis, dx, dy) {
    const [x, y] = await d.eval((a) => window.__editor.gizmoHandle(a), axis);
    await d.drag([x, y], [x + dx, y + dy], { screen: true, steps: 16 });
  }

  // 1. Face mode: the top of the tall box picked, the side of the low box hovered.
  await d.click([128, 128, 192]);
  await d.key('Shift+Digit2');
  await d.click([128, 128, 192]);
  console.log('face picked', JSON.stringify(await state()));
  await dragGizmo('z', 0, -60);
  console.log('face moved up', JSON.stringify(await state()));
  const [hx, hy] = await d.project([640, 0, 64]);
  await page.mouse.move(hx, hy);
  await d.settle(400);
  await d.shot('selmodes-face');

  // 2. Edge mode: the top edge of the low box along +x, dragged down into a chamfer (a sloped roof).
  await d.key('Shift+Digit3');
  await d.click([760, 128, 128]);
  console.log('edge picked', JSON.stringify(await state()));
  await dragGizmo('z', 0, 22);
  console.log('edge moved down', JSON.stringify(await state()));
  await d.settle(400);
  await d.shot('selmodes-edge');

  // 3. Vertex mode: one top corner of the tall box raised, so the top splits into a sloped wedge.
  await d.key('Shift+Digit4');
  const top = await d.eval(async () => {
    const ed = window.__editor.editor;
    const { buildBrushFaces } = await import('/src/geom/brush.ts');
    const s = ed.doc.allSolids()[1];
    return Math.max(...buildBrushFaces(s).flatMap((f) => f.verts.map((v) => v.z)));
  });
  await d.click([250, 0, top - 6]);
  console.log('vertex picked', JSON.stringify(await state()));
  await dragGizmo('z', 0, -70);
  console.log('vertex moved', JSON.stringify(await state()));
  await d.settle(400);
  await d.shot('selmodes-vertex');

  // 4. Extrude: the front face of the tall box pulled out with X, then the new cap pulled again (chained).
  await d.key('Shift+Digit2');
  await d.click([128, 0, 64]);
  console.log('front face picked', JSON.stringify(await state()));
  /** Presses X over a face and moves the mouse along the screen direction of its normal by about `units`. */
  async function pull(centre, normal, units) {
    const [ax, ay] = await d.project(centre);
    const [bx, by] = await d.project(centre.map((c, i) => c + normal[i] * 64));
    const len = Math.hypot(bx - ax, by - ay);
    const px = (len * units) / 64;
    await page.mouse.move(ax, ay);
    await d.key('x');
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(ax + ((bx - ax) / len) * px * (i / 10), ay + ((by - ay) / len) * px * (i / 10));
      await page.waitForTimeout(30);
    }
  }
  await pull([128, 0, 64], [0, -1, 0], 128);
  await d.settle(300);
  console.log('extruding', JSON.stringify(await state()), await d.eval(() => window.__editor.editor.status));
  await page.mouse.down();
  await page.mouse.up();
  console.log('extruded', JSON.stringify(await state()));
  const capY = await d.eval(async () => {
    const ed = window.__editor.editor;
    const { buildBrushFaces } = await import('/src/geom/brush.ts');
    const s = ed.selection.parts[0].solid;
    return Math.min(...buildBrushFaces(s).flatMap((f) => f.verts.map((v) => v.y)));
  });
  await pull([128, capY, 64], [0, -1, 0], 96);
  await d.settle(400);
  console.log('second extrude', JSON.stringify(await state()), await d.eval(() => window.__editor.editor.status));
  await d.shot('selmodes-extrude');
  await page.keyboard.press('Enter');
  await page.mouse.move(1450, 600);
  await d.settle(300);
  console.log('confirmed', JSON.stringify(await state()));
  await d.shot('selmodes-extrude-done');

  // Undo walks back one step per drag or extrude.
  const labels = [];
  for (let i = 0; i < 2; i++) labels.push(await d.eval(() => { const ed = window.__editor.editor; const l = ed.history.undoLabel; ed.undo(); return l; }));
  console.log('undid', labels, JSON.stringify(await state()));

  // Esc cancels an extrude; with Alt held the brush itself grows instead (top of the low box).
  await d.click([600, 128, 128]);
  await pull([600, 128, 128], [0, 0, 1], 64);
  await page.keyboard.press('Escape');
  console.log('cancelled', JSON.stringify(await state()), 'gizmo axis', await d.eval(() => window.__editor.editor.tools.select.gizmo.axis));
  await page.keyboard.down('Alt');
  await pull([600, 128, 128], [0, 0, 1], 64);
  console.log('extending', await d.eval(() => window.__editor.editor.status));
  await page.keyboard.press('Enter');
  await page.keyboard.up('Alt');
  console.log('extended', JSON.stringify(await state()));

  console.log(errors.length ? `${errors.length} console errors` : 'no console errors');
});
