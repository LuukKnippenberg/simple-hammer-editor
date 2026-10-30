// Wall brackets turned out from their wall, with street cables and powerline feeds on the outer insulator.
import { launch, driver } from './browser.mjs';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('dialog', (dlg) => dlg.accept());
const d = driver(page);

/** Views a bracket from in front and to the side; returns how far its wire end is from the cable end. */
const look = (mountName) => d.eval((name) => {
  const ed = window.__editor.editor;
  const mounts = ed.doc.entities.filter((e) => e.get('model')?.includes('utilitypolemount01a') && (!name || e.get('targetname') === name));
  const ropes = ed.doc.entities.filter((e) => e.classname === 'move_rope' || e.classname === 'keyframe_rope');
  // A bracket with a rope end at its insulator.
  let best = null;
  for (const m of mounts) {
    const yaw = (Number(m.get('angles').split(' ')[1]) * Math.PI) / 180;
    const out = { x: -Math.sin(yaw), y: Math.cos(yaw) };
    const wire = { x: m.origin.x + out.x * 7, y: m.origin.y + out.y * 7, z: m.origin.z + 22 };
    for (const r of ropes) {
      const dist = Math.hypot(r.origin.x - wire.x, r.origin.y - wire.y, r.origin.z - wire.z);
      if (!best || dist < best.dist) best = { m, out, wire, dist };
    }
  }
  const { out, wire } = best;
  const side = { x: -out.y, y: out.x };
  return { dist: Math.round(best.dist * 10) / 10, pos: [wire.x + out.x * 260 + side.x * 170, wire.y + out.y * 260 + side.y * 170, wire.z + 90], target: [wire.x - out.x * 20, wire.y - out.y * 20, wire.z - 10] };
}, mountName);

await d.open('repo:c17_district.vmf');
let v = await look(null);
console.log('  street cable: wire end to rope end', v.dist);
await d.view(v.pos, v.target);
await d.settle(1500);
await d.shot('wall-mount-street-cable');

// A powerline with house feeds along a street of the district.
const created = await d.eval(async () => {
  const { addPowerline } = await import('/src/edit/powerlineTool.ts');
  const { Vector3 } = await import('/node_modules/.vite/deps/three.js');
  const ed = window.__editor.editor;
  const made = addPowerline(ed, { points: [new Vector3(-1280, -2600, 128), new Vector3(-1280, 400, 128)], pole: 'wooden', spacing: 640, slack: 0.06, feeds: true });
  return made.filter((e) => e.get('targetname')?.endsWith('_mount')).map((e) => e.get('targetname'));
});
console.log('  feeds:', created.length, created.slice(0, 3));
if (created.length) {
  v = await look(created[0]);
  console.log('  feed: wire end to rope end', v.dist);
  await d.view(v.pos, v.target);
  await d.settle(1500);
  await d.shot('wall-mount-feed');
}
await browser.close();
