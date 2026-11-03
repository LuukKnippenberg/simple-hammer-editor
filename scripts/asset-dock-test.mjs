// Asset finder dock, end to end: hidden at first with the status-bar button; open → strip → hidden by the button,
// the edge (double-click, a drag that snaps and one that hides) and the B key, which is ignored while typing; / opens
// it and focuses the search; the view shrinks with it and its overlays stay inside; a search counts hits in the other
// tabs and a click there switches tab; paging adds 160 tiles at a time; clicking a model, material, decal or sound
// sets that tool's asset and switches to the tool; arrows + Enter and F work in the grid; the right-click menu
// selects every use; a real tile dragged into the view places it; the rail's Material item, Paint and Decal open the
// dock on their tab (task E) and the Paint options list recent materials; the one-time hint; size and tab survive a
// reload. Exits non-zero when a check fails.
// Against a running dev server:
//   SHE_PORT=5206 node scripts/asset-dock-test.mjs [--shots <folder>]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { withEditor } from './browser.mjs';

const shotsArg = process.argv.indexOf('--shots');
const shotsDir = shotsArg > 0 ? process.argv[shotsArg + 1] : null;
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

await withEditor(async (d, page) => {
  await d.open('repo:c17_district.vmf');
  const dock = () => d.eval(() => {
    const el = document.getElementById('assetdock');
    return { size: window.__editor.assetDock.size, hidden: el.hidden, height: el.hidden ? 0 : Math.round(el.getBoundingClientRect().height) };
  });
  const viewHeight = () => d.eval(() => Math.round(document.getElementById('viewport').getBoundingClientRect().height));
  const rendered = () => d.eval(() => window.__editor.assetDock.rendered());
  /** Waits for the thumbnails in view, then saves a review shot. */
  const shot = async (name) => {
    if (!shotsDir) return;
    await page.waitForFunction(() => {
      const grid = document.querySelector('.ad-grid');
      if (!grid || document.getElementById('assetdock').hidden) return true;
      const r = grid.getBoundingClientRect();
      return [...grid.querySelectorAll('.ad-tile')].filter((t) => { const b = t.getBoundingClientRect(); return b.top < r.bottom && b.left < r.right; })
        .every((t) => t.querySelector('img')?.src || t.querySelector('img.missing') || !t.querySelector('img'));
    }, null, { timeout: 30000 }).catch(() => console.log('  (some thumbnails still loading)'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shotsDir, `${name}.png`) });
    console.log(`  saved ${name}.png`);
  };
  const toggleBtn = page.locator('#statusbar .ad-toggle');
  const edge = page.locator('#assetdock .ad-edge');
  const fullView = await viewHeight();

  // Hidden at first; the status-bar button opens it at Open.
  check('hidden at first', await dock(), { size: 'hidden', hidden: true, height: 0 });
  check('status-bar button', (await toggleBtn.textContent()).replace(/\s+/g, ' ').trim(), '▤ Assets B');
  await shot('01-hidden');
  await toggleBtn.click();
  await rendered();
  check('button opens it', await dock(), { size: 'open', hidden: false, height: 300 });
  check('view shrinks by the dock', fullView - (await viewHeight()), 300);
  check('opens on Used in this map', await page.locator('.ad-nav .src.on .src-label').textContent(), 'Used in this map');
  const usedTiles = await page.locator('.ad-grid .ad-tile').count();
  check('used models shown', usedTiles > 0, true);
  // Overlays anchored to the viewport stay inside it.
  const inside = () => d.eval(() => {
    const v = document.getElementById('viewport').getBoundingClientRect();
    return [...document.querySelectorAll('#viewport > .overlay:not([hidden])')].filter((o) => o.offsetParent)
      .every((o) => { const r = o.getBoundingClientRect(); return r.top >= v.top - 1 && r.bottom <= v.bottom + 1 && r.left >= v.left - 1 && r.right <= v.right + 1; });
  });
  check('overlays inside the view (Open)', await inside(), true);
  await shot('02-open-models');

  // Double-click the edge: Strip; again: Open.
  await edge.dblclick();
  await rendered();
  check('double-click → strip', await dock(), { size: 'strip', hidden: false, height: 132 });
  check('strip hides the sources', await page.locator('.ad-nav').isVisible(), false);
  await shot('03-strip');
  await edge.dblclick();
  check('double-click → open', (await dock()).size, 'open');
  // Drag the edge: near Strip snaps to it, past Open stays free, below 64 px hides.
  const dragEdge = async (dy) => {
    const b = await edge.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x, y + (dy * i) / 8);
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  await dragEdge(150);
  check('drag to 150 px snaps to strip', await dock(), { size: 'strip', hidden: false, height: 132 });
  await dragEdge(-268);
  check('drag to 400 px stays there', await dock(), { size: 'open', hidden: false, height: 400 });
  check('overlays inside the view (400 px)', await inside(), true);
  await dragEdge(-400);
  check('drag stops at 60% of the window', (await dock()).height, 540);
  check('overlays inside the view (60%)', await inside(), true);
  const tools = ['select', 'block', 'paint', 'entity', 'kit', 'decal', 'road', 'ground', 'powerline', 'sound', 'poi', 'cinema'];
  const outside = [];
  for (const t of tools) {
    await d.eval((t) => { const e = window.__editor.editor; e.tools.set(t); e.emit('toolchange'); }, t);
    await page.waitForTimeout(100);
    if (!(await inside())) outside.push(t);
  }
  await d.eval(() => { const e = window.__editor.editor; e.tools.set('select'); e.emit('toolchange'); });
  check('every tool panel inside the view (60%)', outside, []);
  await dragEdge(500);
  check('drag below 64 px hides', await dock(), { size: 'hidden', hidden: true, height: 0 });

  // B toggles (back at the last size, Strip here after a snap), not while typing; / opens it and focuses the search.
  await d.eval(() => window.__editor.assetDock.setSize('strip'));
  await d.eval(() => window.__editor.assetDock.setSize('hidden'));
  await d.eval(() => document.activeElement?.blur());
  await d.key('b');
  check('B shows it at the last size', (await dock()).size, 'strip');
  await d.key('b');
  check('B hides it', (await dock()).size, 'hidden');
  await d.key('/');
  check('/ opens it', (await dock()).size, 'strip');
  check('/ focuses the search', await d.eval(() => document.activeElement?.classList.contains('ad-search')), true);
  await page.keyboard.type('b');
  check('B while typing is text', { size: (await dock()).size, value: await page.locator('.ad-search').inputValue() }, { size: 'strip', value: 'b' });
  await page.keyboard.press('Escape');
  await page.locator('.ad-search').fill('');
  await d.eval(() => window.__editor.tabs.show('Entities'));
  const sidebarInput = page.locator('#sidebar input:visible').first();
  await sidebarInput.click();
  await page.keyboard.type('b');
  check('B in a sidebar field is ignored', (await dock()).size, 'strip');
  await sidebarInput.fill('');
  await d.eval(() => document.activeElement?.blur());
  await d.eval(() => window.__editor.assetDock.setSize('open'));

  // Search with hits in the other tabs; a click on one switches tab and keeps the search.
  await d.eval(() => window.__editor.assetDock.show('model'));
  await d.eval(() => window.__editor.assetDock.search('crate'));
  await rendered();
  const expected = await d.eval(async () => {
    const { loadAssets, searchAssets } = await import('/src/assets/assetCatalog.ts');
    const out = {};
    for (const k of ['model', 'material', 'decal', 'sound']) out[k] = searchAssets(await loadAssets(k), 'crate').length;
    return out;
  });
  const others = await page.locator('.ad-others .ad-other').allTextContents();
  const want = [['material', 'materials'], ['decal', 'decals'], ['sound', 'sounds']].filter(([k]) => expected[k]).map(([k, p]) => `+${expected[k].toLocaleString('en')} ${expected[k] === 1 ? p.slice(0, -1) : p}`);
  check('cross-tab counts', others, want);
  check('search hits in this tab (with the static filter)', /“crate” · \d+ models?/.test(await page.locator('.ad-count').textContent()), true);
  check('search looks through the whole tab', await page.locator('.ad-grid .ad-tile').count() > 0, true);
  await shot('04-search-crate');
  if (others.length) {
    await page.locator('.ad-others .ad-other').first().click();
    await rendered();
    check('click a count → that tab', await d.eval(() => window.__editor.assetDock.kind), 'material');
    check('search kept', await page.locator('.ad-search').inputValue(), 'crate');
  }
  await d.eval(() => window.__editor.assetDock.search(''));
  await rendered();

  // Paging: All models shows 160 tiles, scrolling to the end adds 160 more.
  await d.eval(() => window.__editor.assetDock.show('model'));
  await rendered();
  await page.locator('.ad-nav .src', { hasText: 'All models' }).click();
  await rendered();
  check('first page', await page.locator('.ad-grid .ad-tile').count(), 160);
  await page.locator('.ad-grid').evaluate((g) => g.scrollTo(0, g.scrollHeight));
  await page.waitForTimeout(200);
  check('second page on scroll', await page.locator('.ad-grid .ad-tile').count(), 320);
  await page.locator('.ad-nav .src', { hasText: 'Used in this map' }).click();
  await rendered();

  // Click a tile: the tool's asset, and that tool.
  const state = () => d.eval(() => {
    const e = window.__editor.editor;
    return { tool: e.tools.current.name, model: e.entityModel, cls: e.entityClass, material: e.currentMaterial.toLowerCase(), decal: e.decal.material, sound: e.tools.tools.sound.sound };
  });
  const firstTile = page.locator('.ad-grid .ad-tile').first();
  const modelId = await firstTile.getAttribute('data-id');
  await firstTile.click();
  let s = await state();
  check('model tile → Entity tool', { tool: s.tool, model: s.model, cls: s.cls }, { tool: 'entity', model: modelId, cls: 'prop_static' });
  check('model tile shows as current', await firstTile.evaluate((t) => t.classList.contains('on')), true);
  await d.eval(() => window.__editor.assetDock.show('material'));
  await rendered();
  await shot('05-materials');
  const mat = page.locator('.ad-grid .ad-tile').nth(1);
  const matId = await mat.getAttribute('data-id');
  await mat.click();
  s = await state();
  check('material tile → Paint tool', { tool: s.tool, material: s.material }, { tool: 'paint', material: matId });
  await d.eval(() => window.__editor.assetDock.show('decal'));
  await rendered();
  await page.locator('.ad-nav .src', { hasText: 'All decals' }).click();
  await rendered();
  await shot('06-decals');
  const decal = page.locator('.ad-grid .ad-tile').nth(2);
  const decalId = await decal.getAttribute('data-id');
  await decal.click();
  s = await state();
  check('decal tile → Decal tool', { tool: s.tool, decal: s.decal }, { tool: 'decal', decal: decalId });
  await d.eval(() => window.__editor.assetDock.show('sound'));
  await rendered();
  await shot('07-sounds');
  const sound = page.locator('.ad-grid .ad-row .ad-path').nth(3);
  const soundId = await sound.textContent();
  await sound.click();
  s = await state();
  check('sound row → Sound tool', { tool: s.tool, sound: s.sound }, { tool: 'sound', sound: soundId });

  // Arrows + Enter in the grid; F favourites.
  await d.eval(() => window.__editor.assetDock.show('model'));
  await rendered();
  const camBefore = await d.eval(() => window.__editor.editor.camera.position.toArray());
  await page.locator('.ad-grid .ad-tile').first().click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const third = await page.locator('.ad-grid .ad-tile').nth(2).getAttribute('data-id');
  check('arrows + Enter use the third tile', (await state()).model, third);
  await page.waitForTimeout(300);
  check('arrows in the grid do not fly the camera', await d.eval(() => window.__editor.editor.camera.position.toArray()), camBefore);
  await page.keyboard.press('f');
  check('F favourites it', await d.eval(async (id) => (await import('/src/assets/assetCatalog.ts')).favouriteAssets('model').has(id), third), true);
  await page.keyboard.press('ArrowDown');
  const cols = await d.eval(() => { const t = [...document.querySelectorAll('.ad-grid .ad-tile')]; return t.filter((x) => x.offsetTop === t[0].offsetTop).length; });
  check('ArrowDown moves a row', await d.eval(() => document.activeElement?.dataset.index), String(Math.min(2 + cols, usedTiles - 1)));

  // Right-click: the menu, and Select every use in this map.
  const tile0 = page.locator('.ad-grid .ad-tile').first();
  const id0 = await tile0.getAttribute('data-id');
  const used0 = Number((await tile0.locator('.used').textContent()).slice(1));
  await tile0.click({ button: 'right' });
  check('menu entries', await page.locator('.ad-menu button').allTextContents(), ['★ Favourite', 'Select every use in this map', 'Copy path', 'Open in the model picker…']);
  await shot('08-menu');
  await page.locator('.ad-menu button', { hasText: 'Select every use' }).click();
  check('selects every use', await d.eval((id) => {
    const sel = [...window.__editor.editor.selection.entities];
    return { n: sel.length, all: sel.every((e) => e.get('model').toLowerCase() === id) };
  }, id0), { n: used0, all: true });
  check('menu closes', await page.locator('.ad-menu').isHidden(), true);

  // Every source row has a label (a group without a name would show only its count).
  const unlabelled = [];
  for (const k of ['model', 'material', 'decal', 'sound']) {
    await d.eval((k) => window.__editor.assetDock.show(k), k);
    await rendered();
    for (const t of await page.locator('.ad-nav .src .src-label').allTextContents()) if (!t.trim()) unlabelled.push(k);
  }
  check('no source row without a label', unlabelled, []);

  // A real tile dragged into the view places it (the drop rules are in asset-drop-test.mjs); undo takes it back.
  await d.eval(() => window.__editor.assetDock.show('model'));
  await page.locator('.ad-nav .src', { hasText: 'Used in this map' }).click();
  await rendered();
  await d.eval(() => { const e = window.__editor.editor; e.selection.clear(); e.tools.set('select'); e.emit('toolchange'); });
  const dragTile = page.locator('.ad-grid .ad-tile').nth(4);
  const dragId = await dragTile.getAttribute('data-id');
  const ents0 = await d.eval(() => window.__editor.editor.doc.entities.length);
  const tb = await dragTile.boundingBox();
  const vb = await page.locator('#viewport').boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(tb.x + tb.width / 2 + ((vb.x + vb.width / 2 - tb.x - tb.width / 2) * i) / 16, tb.y + tb.height / 2 + ((vb.y + vb.height * 0.6 - tb.y - tb.height / 2) * i) / 16);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  check('dragging a tile shows the drop card', await d.eval(() => !document.querySelector('.asset-drag-card')?.hidden), true);
  await page.mouse.up();
  await d.settle(300);
  check('tile drag placed the model', await d.eval(() => { const e = window.__editor.editor; return [e.doc.entities.length, e.doc.entities.at(-1).get('model'), e.tools.current.name]; }), [ents0 + 1, dragId, 'select']);
  await d.eval(() => window.__editor.editor.undo());
  check('tile drag undone', await d.eval(() => window.__editor.editor.doc.entities.length), ents0);

  // The rail's Material item opens the dock on Materials; there is no Materials panel in the sidebar any more.
  const panelTitle = () => page.locator('#sidebar .panel-title').textContent();
  await d.eval(() => window.__editor.assetDock.setSize('hidden'));
  const title0 = await panelTitle();
  await page.click('.rail-item[aria-label^="Materials"]');
  await rendered();
  check('rail Material item opens the dock on Materials', { size: (await dock()).size, kind: await d.eval(() => window.__editor.assetDock.kind) }, { size: 'open', kind: 'material' });
  check('the sidebar keeps its panel', await panelTitle(), title0);

  // Paint and Decal open the dock on their tab; hidden while one of them is in use, it stays hidden.
  await d.eval(() => { window.__editor.assetDock.show('model'); window.__editor.assetDock.setSize('hidden'); });
  await d.eval(() => document.activeElement?.blur());
  await d.key('q');
  await d.key('3');
  check('Paint opens the dock on Materials', { size: (await dock()).size, kind: await d.eval(() => window.__editor.assetDock.kind) }, { size: 'open', kind: 'material' });
  await d.key('6');
  check('Decal switches it to Decals', await d.eval(() => window.__editor.assetDock.kind), 'decal');
  check('the sidebar stays put', await panelTitle(), title0);
  await d.key('b');
  await d.key('q');
  await d.key('3');
  check('hidden in Decal: Paint leaves it hidden', (await dock()).size, 'hidden');

  // The one-time hint: that Paint pick, which left it hidden, showed it; it never comes again.
  check('hint when Paint leaves the dock hidden', await page.locator('.ad-bubble').textContent(), 'Try the asset finder BOpen✕');
  await shot('09-hint');
  await page.locator('.ad-bubble button', { hasText: 'Open' }).click();
  check('hint Open shows the dock', (await dock()).size, 'open');

  // The Paint tool options: the current material, recent ones (a click uses one) and Browse materials.
  await d.eval(() => window.__editor.assetDock.setSize('hidden'));
  // A few more recent materials, as if they had been used, then the current one again.
  await d.eval(async () => {
    const { recentAssets, usedInMap } = await import('/src/assets/assetCatalog.ts');
    const ed = window.__editor.editor;
    const cur = ed.currentMaterial.toLowerCase();
    for (const m of [...usedInMap(ed, 'material').keys()].filter((m) => !m.startsWith('tools/') && m !== cur).slice(0, 7)) recentAssets('material').push(m);
    recentAssets('material').push(cur);
    ed.emit('material');
  });
  const opts = page.locator('#viewport .tool-options');
  const recents = await opts.locator('.mat-recent').evaluateAll((els) => els.map((e) => e.title));
  check('Paint options list recent materials, the current one first', [recents.length > 0, recents[0]], [true, await d.eval(() => window.__editor.editor.currentMaterial.toLowerCase())]);
  if (recents.length > 1) {
    await opts.locator('.mat-recent').nth(1).click();
    check('a recent swatch sets the material', await d.eval(() => window.__editor.editor.currentMaterial.toLowerCase()), recents[1]);
  }
  await shot('10-paint-options');
  await opts.locator('button', { hasText: 'Browse materials' }).click();
  await rendered();
  check('Browse materials opens the dock', { size: (await dock()).size, kind: await d.eval(() => window.__editor.assetDock.kind) }, { size: 'open', kind: 'material' });
  await d.key('q');
  await d.eval(() => window.__editor.assetDock.setSize('hidden'));
  await d.key('3');
  check('hint only once', await page.locator('.ad-bubble').count(), 0);

  // …or on the first Change… click (the Entity tool's model).
  await d.eval(() => localStorage.removeItem('she.pref.assetHint'));
  await d.eval(() => window.__editor.assetDock.setSize('hidden'));
  await d.key('4');
  await page.locator('#viewport .tool-options button', { hasText: 'Change…' }).click();
  check('hint on the first Change… click', await page.locator('.ad-bubble').count(), 1);
  await page.keyboard.press('Escape');
  await page.locator('.ad-bubble .ad-x').click();

  // Size, tab and source survive a reload.
  await d.eval(() => { window.__editor.assetDock.show('decal'); window.__editor.assetDock.setSize('strip'); });
  await d.open('repo:c17_district.vmf');
  await rendered();
  check('remembered after a reload', { ...(await dock()), kind: await d.eval(() => window.__editor.assetDock.kind) }, { size: 'strip', hidden: false, height: 132, kind: 'decal' });
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
