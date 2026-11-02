// Local sounds: the sound browser, presets placed with the Sound tool, a broken lamp added to an existing
// lamp post from the inspector, and the 3D audio preview.
import { withEditor } from './browser.mjs';

await withEditor(async (d, page) => {
  await d.open('repo:c17_district.vmf');
  await d.eval(() => { const W = window.__editor; W.lighting.setEnabled(true); W.editor.emit('lighting'); });

  // A lamp post near the south-west crossing: select it and use the inspector's suggestion.
  const lamp = await d.eval(() => {
    const ed = window.__editor.editor;
    const lamps = ed.doc.entities.filter((e) => /lamppost03a/.test(e.get('model') ?? ''));
    lamps.sort((a, b) => a.origin.distanceTo({ x: -1280, y: -1280, z: 0 }) - b.origin.distanceTo({ x: -1280, y: -1280, z: 0 }));
    ed.selection.set([], [lamps[0]]);
    window.__editor.tabs.show('Selection');
    const o = lamps[0].origin;
    return [o.x, o.y, o.z, lamps[0].angles.y];
  });
  await d.view([lamp[0] - 420, lamp[1] - 520, 420], [lamp[0], lamp[1], 300]);
  await d.settle(600);
  await d.shot('local-lamp-suggestion');
  await page.click('.kg-head:has(b:text-is("Sound and effects"))');
  await page.click('button:has-text("Broken lamp")');
  await d.settle(500);
  // Up close under the lamp head, the sparks and the buzzing sound's range.
  const head = await d.eval(() => { const s = [...window.__editor.editor.selection.entities][0]; return s.origin.toArray(); });
  // From down the street (streets run through x = -1280, y = -1280, ...), looking up at the head.
  await d.view([-1280, head[1] - 520, 200], [head[0], head[1], head[2] - 60]);
  await d.settle(600);
  await d.shot('local-broken-lamp');

  // Presets placed with the Sound tool: a fire barrel on the square, a generator and dripping water.
  await d.view([-500, -2700, 2100], [-300, -500, 0]);
  await d.settle(500);
  await d.key('0');
  await page.click('.tool-options .seg button:text("Local sound")');
  const place = async (local, at) => {
    await d.eval((l) => { const t = window.__editor.editor.tools.tools.sound; t.local = l; window.__editor.editor.emit('toolchange'); }, local);
    await d.click(at);
    await d.settle(300);
  };
  await place('fire', [-200, -400, 0]);
  await place('fire', [250, -350, 0]);
  await place('generator', [400, -700, 0]);
  await place('drip', [-1280, -700, 0]);
  // The sound browser, searching.
  await d.eval(() => { const t = window.__editor.editor.tools.tools.sound; t.local = 'file'; window.__editor.editor.emit('toolchange'); });
  await page.fill('.tool-options input[type=search]', 'fire loop');
  await d.settle(600);
  await d.shot('local-sound-browser');
  await page.click('.tool-options b');
  await d.key('1');
  await d.eval(() => window.__editor.editor.selection.clear());

  // Hear it: audio on, camera over the fires, then at the lamp.
  await page.click('#topbar button:has-text("Audio")');
  const readout = async (pos, target, name) => {
    await d.view(pos, target);
    await page.waitForTimeout(2500);
    await d.shot(name);
    return d.eval(() => ({ ...window.__editor.audio.stats }));
  };
  const atFire = await readout([0, -1100, 700], [0, -400, 0], 'local-fires');
  const atLamp = await readout([lamp[0] - 300, lamp[1] - 300, 500], [lamp[0], lamp[1], 0], 'local-lamp-audio');
  console.log(JSON.stringify({ atFire, atLamp }));
  console.log('  saved copy', await d.eval(async () => {
    const ed = window.__editor.editor;
    const { VmfDocument } = await import('/src/vmf/map.ts');
    const { applyMapSettings } = await import('/src/lw/mapSettings.ts');
    const { nonStaticProps, convertToDynamic } = await import('/src/edit/preflight.ts');
    convertToDynamic(ed, await nonStaticProps(ed));
    const copy = VmfDocument.parse(ed.doc.serialize());
    applyMapSettings(copy);
    return (await fetch('/api/autosave?name=she_local_test.vmf', { method: 'POST', headers: { 'X-SHE': '1' }, body: copy.serialize() })).ok;
  }));
});
