// Ambient sound: a map default soundscape, zones placed with the Sound tool, and the audio preview
// switching soundscape as the camera moves.
import { withEditor } from '../browser.mjs';

await withEditor(async (d, page) => {
  await d.open('repo:c17_district.vmf');
  await d.eval(() => { const W = window.__editor; W.lighting.setEnabled(true); W.editor.emit('lighting'); });

  // The map default, from the Settings tab card.
  await page.click('.rail-item[aria-label^="Settings"]');
  await page.click('.set-head:has(b:text-is("Ambient sound"))');
  await page.click('.set-card:has(b:text-is("Ambient sound")) input.switch');
  await d.settle(400);
  await page.selectOption('.set-card:has(b:text-is("Ambient sound")) select', 'wars.city16');
  await d.settle(300);
  await d.shot('sound-settings-card');

  // Zones: a canal street sound along the west street, ruins on the square.
  await d.view([-3300, -3700, 3600], [0, 0, 0]);
  await d.settle(600);
  await d.key('0');
  const zone = async (scape, radius, at) => {
    await d.eval(([s, r]) => { const t = window.__editor.editor.tools.tools.sound; t.mode = 'zone'; t.soundscape = s; t.radius = r; window.__editor.editor.emit('toolchange'); }, [scape, radius]);
    await d.click(at);
    await d.settle(200);
  };
  // Placed from the top view, so the clicks land in the streets.
  await d.key('t');
  await d.eval(() => { const ed = window.__editor.editor; ed.topView.center.set(0, 0); ed.topView.zoom = 2800; ed.topView.apply(); });
  await d.settle(500);
  await zone('wars.canals.street', 640, [-1280, -1700, 0]);
  await zone('wars.ruins', 768, [0, 0, 0]);
  await zone('wars.village', 512, [1280, 1700, 0]);
  await d.shot('sound-zones-top');
  await d.key('t');
  await d.key('1');
  await d.eval(() => window.__editor.editor.selection.clear());

  // Turn the audio preview on (a real click, as browsers require) and fly over the zones.
  await page.click('#topbar button:has-text("Audio")');
  const readout = () => d.eval(async () => {
    await new Promise((r) => setTimeout(r, 2500));
    const a = window.__editor.audio;
    const l = window.__editor.soundscapes.listener;
    const zones = window.__editor.editor.doc.entities.filter((e) => e.classname === 'env_soundscape').map((e) => `${e.get('soundscape')}@${e.get('origin')} r${e.get('radius')}`);
    return { ...a.stats, enabled: a.enabled, state: a.ctx?.state, listener: [l.x, l.y, l.z].map(Math.round).join(' '), zones };
  });
  const report = [];
  for (const [name, pos, target] of [
    ['default', [2600, -2600, 1400], [2200, -2200, 0]],
    ['canal street', [-1280, -2600, 900], [-1280, -1700, 0]],
    ['square', [-400, -900, 900], [0, 0, 0]],
  ]) {
    await d.view(pos, target);
    const r = await readout();
    report.push({ where: name, ...r });
    await d.shot(`sound-zone-${name.replace(' ', '-')}`);
  }
  console.log(JSON.stringify(report, null, 1));
  // The zone panel in the inspector.
  await d.view([-3300, -3700, 3600], [0, 0, 0]);
  await d.settle(300);
  await d.eval(() => {
    const ed = window.__editor.editor;
    ed.selection.set([], ed.doc.entities.filter((e) => e.classname === 'env_soundscape' && e.get('soundscape') === 'wars.ruins'));
    window.__editor.tabs.show('Selection');
  });
  await d.settle(400);
  await page.evaluate(() => { for (const el of document.querySelectorAll('.tab-body')) el.scrollTop = 0; });
  await d.shot('sound-zone-panel');
  console.log('  saved copy', await d.eval(async () => {
    const ed = window.__editor.editor;
    const { VmfDocument } = await import('/src/vmf/map.ts');
    const { applyMapSettings } = await import('/src/lw/mapSettings.ts');
    const copy = VmfDocument.parse(ed.doc.serialize());
    applyMapSettings(copy);
    return (await fetch('/api/autosave?name=she_sound_test.vmf', { method: 'POST', headers: { 'X-SHE': '1' }, body: copy.serialize() })).ok;
  }));
});
