import { Box3, BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { entitiesByName, getConnections, incomingConnections, resolveTarget } from '../vmf/io.ts';

export function entityCenter(editor: Editor, e: MapEntity): Vector3 {
  if (e.solids.length) {
    const box = new Box3();
    for (const s of e.solids) {
      const b = editor.world.solidBounds(s);
      if (b) box.union(b);
    }
    if (!box.isEmpty()) return box.getCenter(new Vector3());
  }
  return editor.entities.entityBounds(e).getCenter(new Vector3());
}

/** Lines from the selected entities to what their outputs target (orange) and from what fires them (blue). */
export class IoLines {
  private out: LineSegments;
  private inc: LineSegments;
  private editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
    const mat = (color: number) => new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
    this.out = new LineSegments(new BufferGeometry(), mat(0xffa630));
    this.inc = new LineSegments(new BufferGeometry(), mat(0x4fa3e0));
    for (const l of [this.out, this.inc]) {
      l.renderOrder = 12;
      l.frustumCulled = false;
      editor.scene.add(l);
    }
    for (const ev of ['selection', 'change', 'document']) editor.on(ev, () => this.update());
  }

  private update(): void {
    const ed = this.editor;
    const byName = entitiesByName(ed.doc);
    const out: number[] = [], inc: number[] = [];
    const push = (arr: number[], a: Vector3, b: Vector3) => {
      // Slight arc so stacked connections stay readable: go through a raised midpoint.
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.z += Math.min(256, a.distanceTo(b) * 0.15);
      arr.push(a.x, a.y, a.z, mid.x, mid.y, mid.z, mid.x, mid.y, mid.z, b.x, b.y, b.z);
    };
    for (const e of [...ed.selection.entities].slice(0, 20)) {
      const from = entityCenter(ed, e);
      for (const c of getConnections(e)) {
        const t = resolveTarget(byName, c.target);
        if (t === 'special') continue;
        for (const te of t.slice(0, 50)) push(out, from, entityCenter(ed, te));
      }
      for (const { from: src } of incomingConnections(ed.doc, e).slice(0, 50)) push(inc, entityCenter(ed, src), from);
    }
    for (const [line, arr] of [[this.out, out], [this.inc, inc]] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
      line.geometry.dispose();
      line.geometry = g;
    }
  }
}
