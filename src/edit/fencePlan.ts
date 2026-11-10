import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from 'three';
import type { Editor } from '../editor.ts';
import { fenceHeight, fenceLayout, pointAlong } from '../gen/fences.ts';
import { fenceOf } from '../gen/fenceStore.ts';

/**
 * Fences in the top view: seen from above a fence is a few units thin (chain-link, planks), so every placed fence
 * also gets a line along its runs and a bracket at each side of a doorway, drawn on a layer only the top view's camera
 * shows (the 3D view shows the fence itself; raycasts don't see the layer).
 */
export const FENCE_PLAN_LAYER = 3;
/** How far a doorway's brackets stand out to each side. */
const TICK = 24;

/** Plan lines of a fence spec (segments, flat x, y, z pairs), at the top of the fence. */
export function fencePlanLines(spec: Parameters<typeof fenceLayout>[0] & Parameters<typeof fenceHeight>[0]): number[] {
  const out: number[] = [];
  const h = fenceHeight(spec);
  for (const st of fenceLayout(spec)) {
    const across = { x: -st.dir.y * TICK, y: st.dir.x * TICK };
    for (const run of st.runs) {
      const a = pointAlong(st, run.s0), b = pointAlong(st, run.s1);
      out.push(a.x, a.y, a.z + h, b.x, b.y, b.z + h);
    }
    for (const g of st.gaps) {
      for (const s of [g.s0, g.s1]) {
        const p = pointAlong(st, s);
        out.push(p.x - across.x, p.y - across.y, p.z + h, p.x + across.x, p.y + across.y, p.z + h);
      }
    }
  }
  return out;
}

/** Keeps the top view's fence lines in step with the map. */
export function mountFencePlan(editor: Editor): void {
  const lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xd8b070, depthTest: false, transparent: true, opacity: 0.95 }));
  lines.layers.set(FENCE_PLAN_LAYER);
  lines.renderOrder = 10;
  lines.frustumCulled = false;
  editor.scene.add(lines);
  editor.topView.camera.layers.enable(FENCE_PLAN_LAYER);
  const redraw = () => {
    const arr: number[] = [];
    for (const e of editor.doc.entities) {
      const spec = e.classname === 'func_detail' ? fenceOf(e) : null;
      if (spec) arr.push(...fencePlanLines(spec));
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    lines.geometry.dispose();
    lines.geometry = g;
  };
  for (const event of ['change', 'document']) editor.on(event, redraw);
  redraw();
}
