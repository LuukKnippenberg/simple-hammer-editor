// Prints the bounds (and the $staticprop flag) of models as the editor loads them, in MODEL_BOUNDS form:
//   node scripts/model-bounds.mjs props_rooftop/dome004 ...
import { withEditor } from './browser.mjs';

await withEditor(async (d) => {
  await d.open('repo:phase3_arena.vmf');
  const out = await d.eval(async (names) => {
    const { loadModel } = await import('/src/assets/mdl.ts');
    const res = {};
    for (const n of names) {
      const m = await loadModel(`models/${n}.mdl`);
      res[n] = m ? [...m.bounds.min.toArray(), ...m.bounds.max.toArray()].map(Math.round).concat(m.isStatic ? 1 : 0).join(', ') : null;
    }
    return res;
  }, process.argv.slice(2));
  console.log(JSON.stringify(out, null, 1));
});
