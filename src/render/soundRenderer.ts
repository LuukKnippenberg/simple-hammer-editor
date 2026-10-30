import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { soundscapeZones } from '../audio/listener.ts';

/** Sound ranges in the viewport: soundscape zone circles (the one heard now brighter) and local sound radii. */
export class SoundRenderer {
  private editor: Editor;
  private zones: LineSegments;
  private active: LineSegments;
  private local: LineSegments;
  visible = true;
  /** Local sound entities and their audible radius, provided by the local sound player (phase 5). */
  localRanges: () => { entity: MapEntity; radius: number }[] = () => [];

  constructor(editor: Editor) {
    this.editor = editor;
    const line = (color: number, opacity: number) => {
      const l = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
      l.renderOrder = 11;
      l.frustumCulled = false;
      return l;
    };
    this.zones = line(0x4fd0c0, 0.55);
    this.active = line(0x9ffff0, 1);
    this.local = line(0xc890ff, 0.7);
    const g = new Group();
    g.add(this.zones, this.active, this.local);
    editor.scene.add(g);
    for (const ev of ['change', 'document', 'soundscape', 'selection']) editor.on(ev, () => this.update());
  }

  private circle(arr: number[], c: Vector3, r: number, z: number): void {
    const n = Math.max(24, Math.min(96, Math.round(r / 24)));
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      arr.push(c.x + Math.cos(a0) * r, c.y + Math.sin(a0) * r, z, c.x + Math.cos(a1) * r, c.y + Math.sin(a1) * r, z);
    }
  }

  update(activeEntity: MapEntity | null = this.activeEntity): void {
    this.activeEntity = activeEntity;
    const zones: number[] = [], active: number[] = [], local: number[] = [];
    for (const z of soundscapeZones(this.editor.doc.entities)) {
      if (z.radius <= 0 || this.editor.hidden.has(z.entity)) continue;
      const arr = z.entity === activeEntity ? active : zones;
      this.circle(arr, z.origin, z.radius, z.origin.z + 4);
      this.circle(arr, z.origin, z.radius, z.origin.z + 260);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = z.origin.x + Math.cos(a) * z.radius, y = z.origin.y + Math.sin(a) * z.radius;
        arr.push(x, y, z.origin.z + 4, x, y, z.origin.z + 260);
      }
    }
    for (const { entity, radius } of this.localRanges()) {
      if (!entity.origin || this.editor.hidden.has(entity)) continue;
      const o = entity.origin;
      this.circle(local, o, radius, o.z);
      if (this.editor.selection.entities.has(entity)) {
        this.circle(local, o, radius * 0.7, o.z + radius * 0.7);
        this.circle(local, o, radius * 0.7, o.z - radius * 0.7);
      }
    }
    for (const [obj, arr] of [[this.zones, zones], [this.active, active], [this.local, local]] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
      obj.geometry.dispose();
      obj.geometry = g;
      obj.visible = this.visible;
    }
  }

  private activeEntity: MapEntity | null = null;
}
