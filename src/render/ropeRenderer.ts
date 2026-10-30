import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';

const SEGMENTS = 16;

/**
 * Sagging cables for move_rope / keyframe_rope chains: each rope entity links to the next by NextKey.
 * The sag follows the rope's Slack (extra length): about sqrt(3 · span · slack / 8) at mid-span.
 */
export class RopeRenderer {
  private lines: LineSegments;
  private editor: Editor;
  private version = '';

  constructor(editor: Editor) {
    this.editor = editor;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x1c1c1c }));
    this.lines.frustumCulled = false;
    editor.scene.add(this.lines);
    for (const ev of ['change', 'document']) editor.on(ev, () => this.update());
    this.update();
  }

  /** Rope segments as [start, end, slack] for every NextKey link in the document. */
  static spans(entities: MapEntity[]): [Vector3, Vector3, number][] {
    const byName = new Map<string, MapEntity>();
    for (const e of entities) {
      const n = e.get('targetname');
      if (n && (e.classname === 'move_rope' || e.classname === 'keyframe_rope')) byName.set(n.toLowerCase(), e);
    }
    const out: [Vector3, Vector3, number][] = [];
    for (const e of entities) {
      if (e.classname !== 'move_rope' && e.classname !== 'keyframe_rope') continue;
      const next = byName.get((e.get('NextKey') ?? e.get('nextkey') ?? '').toLowerCase());
      if (!next || !e.origin || !next.origin) continue;
      out.push([e.origin.clone(), next.origin.clone(), parseFloat(e.get('Slack') ?? e.get('slack') ?? '25') || 0]);
    }
    return out;
  }

  private update(): void {
    const ents = this.editor.doc.entities.filter((e) => e.classname === 'move_rope' || e.classname === 'keyframe_rope');
    const key = ents.map((e) => `${e.get('origin')}${e.get('NextKey') ?? ''}${e.get('Slack') ?? ''}`).join('|');
    if (key === this.version) return;
    this.version = key;
    const pts: number[] = [];
    for (const [a, b, slack] of RopeRenderer.spans(ents)) {
      const span = a.distanceTo(b);
      const sag = Math.sqrt((3 * span * Math.max(0, slack)) / 8);
      let prev = a;
      for (let i = 1; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        const p = a.clone().lerp(b, t);
        p.z -= sag * 4 * t * (1 - t);
        pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    this.lines.geometry.dispose();
    this.lines.geometry = g;
  }
}
