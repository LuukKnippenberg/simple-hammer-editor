// Cinematics: camera shots, paths with a flyby, particles, a screen and atmosphere presets in sp_cine_test.
import { withEditor } from '../browser.mjs';

await withEditor(async (d, page) => {
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });
  await d.open('repo:sp_cine_test.vmf');
  await d.eval(() => { const W = window.__editor; W.lighting.setEnabled(true); W.editor.emit('lighting'); W.tabs.show('Cinema'); });
  const select = (name) => d.eval((n) => { const ed = window.__editor.editor; ed.selection.set([], [ed.doc.entities.find((e) => e.get('targetname') === n)]); }, name);

  await d.view([-1650, -2050, 1250], [150, 150, 150]);
  await d.settle(1200);
  await d.shot('cine-overview');

  // A flight path node: heights, send a unit along, flyby.
  await select('route_3');
  await d.settle(300);
  await d.shot('cine-path-node');

  // The camera shot: inspector, then a frame of the preview between the letterbox bars.
  await select('shot_intro');
  await d.settle(300);
  await d.shot('cine-shot-inspector');
  await d.eval(async () => {
    const { playShot } = await import('/src/render/cinemaPreview.ts');
    const ed = window.__editor.editor;
    ed.selection.clear();
    playShot(ed, ed.doc.entities.find((e) => e.get('targetname') === 'shot_intro'));
  });
  await page.waitForTimeout(4000);
  await d.shot('cine-shot-preview');
  await page.keyboard.press('Escape');
  await d.settle(300);

  // Particle picker in the Cinema tool.
  await d.view([-700, -700, 520], [150, 250, 100]);
  await d.key('c');
  await d.eval(() => { const ed = window.__editor.editor; ed.tools.tools.cinema.mode = 'particle'; ed.emit('toolchange'); });
  await page.fill('.tool-options input[type=search]', 'smoke large');
  await d.settle(800);
  await d.shot('cine-particles');
  await d.eval(() => document.activeElement.blur());
  await d.key('1');

  // The screen on the wall.
  await select('screen');
  await d.view([150, -60, 220], [640, 0, 176]);
  await d.settle(800);
  await d.shot('cine-screen');

  // Atmosphere: preview the dusk preset.
  await select('atmo_dusk');
  await d.view([-1650, -2050, 1250], [150, 150, 150]);
  await d.eval(async () => {
    const { atmosphereOf } = await import('/src/lw/cinematics.ts');
    const ed = window.__editor.editor;
    const relay = ed.doc.entities.find((e) => e.get('targetname') === 'atmo_dusk');
    [...document.querySelectorAll('.tab-body button')].find((b) => b.textContent.includes('Preview'))?.click();
    return atmosphereOf(relay);
  });
  await d.settle(1200);
  await d.shot('cine-atmosphere-dusk');
});
