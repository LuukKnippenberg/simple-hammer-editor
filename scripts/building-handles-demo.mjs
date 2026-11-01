// Building handles: generates two blocks of buildings from block brushes with the Building panel, selects one by
// clicking a wall, moves and resizes it with the gizmo, changes its architecture and regenerates it, undoes,
// duplicates and deletes it, and picks a single brush with the handles hidden. Screenshots building-handles-*.png.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);
await d.open('repo:phase3_arena.vmf');
await page.click('#topbar button:has-text("New")');
await page.dblclick('.newmap [data-template="empty"]');
await d.settle();

const state = () => d.eval(async () => {
  const ed = window.__editor.editor;
  const { blockOf, blockMembers, groupDressing } = await import('/src/gen/buildingStore.ts');
  const blocks = ed.doc.entities.filter((e) => blockOf(e)).map((e) => blockOf(e));
  const group = blocks[0]?.group;
  const sel = [...ed.selection.entities].map((e) => e.classname).concat([...ed.selection.solids].map(() => 'brush'));
  const panel = document.querySelector('#sidebar')?.textContent ?? '';
  return {
    blocks: blocks.map((b) => ({ rect: `${b.rect.x0} ${b.rect.y0} ${b.rect.x1} ${b.rect.y1}`, arch: b.options.architecture, seed: b.options.seed, world: blockMembers(ed.doc, b.uid).world.length })),
    handles: ed.doc.entities.filter((e) => e.classname === 'she_building_handle').length,
    cables: ed.doc.entities.filter((e) => e.classname === 'move_rope').length,
    dressing: group ? groupDressing(ed.doc, group).length : 0,
    selected: sel, panel: panel.includes('Block of buildings') ? 'block' : panel.includes('Select whole block') ? 'part' : 'other',
  };
});

// Two block brushes with a 384-wide street between them (as the Block tool draws them).
await d.eval(async () => {
  const ed = window.__editor.editor;
  const { boxSolid } = await import('/src/edit/brushes.ts');
  const Vector3 = ed.camera.position.constructor;
  const add = (x0, y0, x1, y1) => ed.doc.addSolid(boxSolid(ed.doc, new Vector3(x0, y0, 0), new Vector3(x1, y1, 64), 'DEV/DEV_MEASUREGENERIC01'));
  const a = add(-1408, -512, -384, 512), b = add(0, -512, 1024, 512);
  ed.history.added('Add blocks', [a, b]);
  ed.changed();
});
await d.view([-300, -2600, 1900], [-200, 0, 0]);
await d.settle(600);
// Select both brushes with the mouse and generate from the Building panel.
await d.click([-900, 0, 64]);
await d.click([500, 0, 64], { shift: true });
await d.eval(() => window.__editor.tabs.show('Selection'));
await page.selectOption('#sidebar select[title^="Kind of buildings"]', 'tenement');
await page.fill('#sidebar input[title^="The same seed"]', '11');
await page.click('#sidebar button:has-text("Generate buildings")');
await d.settle(1500);
await d.key('Escape');
await d.settle(400);
await d.shot('building-handles-1-generated');
console.log('generated', await state());

// Click a wall of the right block: the whole block gets selected by its handle.
await d.view([1300, -2200, 900], [500, 0, 150]);
await d.settle(600);
await d.click([500, -512, 100]);
await d.settle(500);
await d.shot('building-handles-2-selected');
console.log('clicked a wall', await state());

// Move: drag the gizmo's x arrow (away from the other block: the cables between them go).
await d.view([-300, -2600, 1900], [-200, 0, 0]);
await d.settle(400);
await d.key('m');
await d.settle(200);
let [hx, hy] = await d.eval(() => window.__editor.gizmoHandle('x'));
await d.drag([hx, hy], [hx + 160, hy], { screen: true, steps: 20 });
await d.settle(1500);
await d.shot('building-handles-3-moved');
console.log('moved', await state());

// Resize: drag the gizmo's y handle outwards.
await d.key('r');
await d.settle(200);
[hx, hy] = await d.eval(() => window.__editor.gizmoHandle('y'));
await d.drag([hx, hy], [hx + 60, hy - 60], { screen: true, steps: 20 });
await d.settle(1500);
await d.shot('building-handles-4-resized');
console.log('resized', await state());

// The Selection tab shows the block's stored settings: change the architecture and regenerate.
await page.selectOption('#sidebar select[title^="Kind of buildings"]', 'brick');
await page.click('#sidebar button:has-text("Regenerate")');
await d.settle(1500);
await d.shot('building-handles-5-regenerated');
console.log('regenerated as brick', await state());

// Undo three times: regenerate, resize, move.
for (let i = 0; i < 3; i++) await d.key('Control+z');
await d.settle(1200);
await d.shot('building-handles-6-undone');
console.log('after 3 undos', await state());

// Duplicate with Ctrl+D (same group: the street between gets cables and lamps), then delete it with Delete.
await d.click([500, -512, 100]);
await d.settle(300);
await d.key('Control+d');
await d.settle(1500);
await d.view([600, -3400, 2400], [700, 0, 0]);
await d.settle(800);
await d.shot('building-handles-7-duplicated');
console.log('duplicated', await state());
await d.key('Delete');
await d.settle(1000);
console.log('deleted the copy', await state());

// Hide the handles: a click picks the single brush, and the panel offers the whole block.
await page.click('#topbar button:text-is("Handles")');
await d.view([1300, -2200, 900], [500, 0, 150]);
await d.settle(600);
await d.click([500, -512, 100]);
await d.settle(400);
await d.shot('building-handles-8-single-brush');
console.log('handles hidden, clicked a wall', await state());

// What a compile gets: no handles.
console.log('compiled copy', await d.eval(async () => {
  const { VmfDocument } = await import('/src/vmf/map.ts');
  const { stripHandles } = await import('/src/gen/handle.ts');
  const copy = VmfDocument.parse(window.__editor.editor.doc.serialize());
  const n = stripHandles(copy);
  return { stripped: n, left: copy.serialize().includes('she_building_handle') };
}));
await browser.close();
