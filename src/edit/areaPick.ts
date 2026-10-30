import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { pickSurface, snap } from './tools.ts';
import { toast } from '../ui/dom.ts';

/**
 * Lets the user drag a box on the ground (in the top view) and resolves with [x0, y0, x1, y1, groundZ],
 * or null on Escape. Pointer input is taken before the tools see it.
 */
export function pickArea(editor: Editor): Promise<[number, number, number, number, number] | null> {
  return new Promise((resolve) => {
    const dom = editor.renderer.domElement;
    const prevView = editor.view;
    editor.setView3dOrTop('top');
    toast(editor.container, 'Drag a box over the area · Esc cancels', 4000);
    const line = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xff40ff, depthTest: false }));
    line.renderOrder = 13;
    line.frustumCulled = false;
    editor.scene.add(line);
    let start: Vector3 | null = null;
    let end: Vector3 | null = null;
    const g = () => Math.max(32, editor.grid);
    const at = (e: PointerEvent) => {
      const hit = pickSurface(editor, editor.ndcFromEvent(e));
      return hit ? new Vector3(snap(hit.point.x, g()), snap(hit.point.y, g()), hit.point.z) : null;
    };
    const draw = () => {
      if (!start || !end) return;
      const z = Math.max(start.z, end.z) + 8;
      const [x0, x1] = [start.x, end.x], [y0, y1] = [start.y, end.y];
      const pts = [x0, y0, z, x1, y0, z, x1, y0, z, x1, y1, z, x1, y1, z, x0, y1, z, x0, y1, z, x0, y0, z];
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
      line.geometry.dispose();
      line.geometry = geo;
    };
    const finish = (result: [number, number, number, number, number] | null) => {
      dom.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('keydown', key, true);
      editor.scene.remove(line);
      line.geometry.dispose();
      editor.setView3dOrTop(prevView);
      resolve(result);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.stopImmediatePropagation();
      start = at(e);
      end = start?.clone() ?? null;
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      e.stopImmediatePropagation();
      end = at(e) ?? end;
      draw();
    };
    const up = (e: PointerEvent) => {
      if (!start || e.button !== 0) return;
      e.stopImmediatePropagation();
      const a = start, b = end ?? start;
      if (Math.abs(a.x - b.x) < 32 || Math.abs(a.y - b.y) < 32) { start = null; return; }
      finish([Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.round(Math.min(a.z, b.z))]);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      finish(null);
    };
    dom.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', key, true);
  });
}
