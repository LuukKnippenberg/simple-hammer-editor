import { Box3, BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import { entityStyle } from './entityRenderer.ts';

/**
 * Draws what tool brushes and point entities mean in game: capture-area rings around control points,
 * base rings around player starts, and the route from each unit_maker to its order goal.
 */
export class GameplayOverlay {
  private lines: LineSegments;
  private editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 }));
    this.lines.renderOrder = 7;
    this.lines.frustumCulled = false;
    editor.scene.add(this.lines);
    for (const ev of ['document', 'change']) editor.on(ev, () => this.update());
  }

  private update(): void {
    const ed = this.editor;
    const pos: number[] = [], col: number[] = [];
    const c = new Color();
    const ring = (center: Vector3, r: number, hex: number, segments = 48) => {
      c.setHex(hex);
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
        pos.push(center.x + Math.cos(a0) * r, center.y + Math.sin(a0) * r, center.z, center.x + Math.cos(a1) * r, center.y + Math.sin(a1) * r, center.z);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    };
    const line = (a: Vector3, b: Vector3, hex: number) => {
      c.setHex(hex);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const ents = ed.doc.entities;
    for (const area of ents.filter((e) => e.classname === 'trigger_capture_area')) {
      const box = new Box3();
      for (const s of area.solids) { const b = ed.world.solidBounds(s); if (b) box.union(b); }
      if (box.isEmpty()) continue;
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      center.z = box.min.z + 18;
      const owner = ents.find((e) => e.classname === 'control_point' && e.get('targetname') === area.get('control_point'))?.get('ownernumber');
      const hex = owner && owner !== '0' ? (owner === '2' ? 0x3ddc84 : 0xe05a4f) : 0xffa630;
      ring(center, Math.min(size.x, size.y) / 2, hex);
      ring(center, Math.min(size.x, size.y) / 2 - 6, hex);
    }
    for (const s of ents.filter((e) => e.classname === 'info_start_wars' && e.origin)) ring(s.origin!.clone().add(new Vector3(0, 0, 4)), 320, entityStyle('info_start_wars').color);
    const byName = new Map(ents.filter((e) => e.get('targetname')).map((e) => [e.get('targetname')!.toLowerCase(), e]));
    for (const m of ents.filter((e) => e.classname === 'unit_maker' && e.origin)) {
      ring(m.origin!, 96, 0xe05a4f, 24);
      const order = [...byName.values()].find((o) => o.classname === 'wars_give_order' && o.get('unitname')?.toLowerCase() === m.get('NPCTargetname')?.toLowerCase());
      const goal = order?.get('targetordername') ? byName.get(order.get('targetordername')!.toLowerCase()) : undefined;
      if (goal?.origin) {
        const a = m.origin!, b = goal.origin;
        line(a, b, 0xe05a4f);
        const dir = b.clone().sub(a).setZ(0).normalize(), side = new Vector3(-dir.y, dir.x, 0);
        line(b, b.clone().addScaledVector(dir, -48).addScaledVector(side, 24), 0xe05a4f);
        line(b, b.clone().addScaledVector(dir, -48).addScaledVector(side, -24), 0xe05a4f);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    this.lines.geometry.dispose();
    this.lines.geometry = g;
  }
}
