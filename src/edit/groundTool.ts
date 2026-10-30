import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineLoop, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapSolid } from '../vmf/map.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface } from './tools.ts';
import { GROUND_SETS, dab, readDisp, setGroundMaterial, type Disp, type GroundMode } from './terrain.ts';
import { terrainPatch } from '../gen/layout.ts';
import { solidBounds } from './brushes.ts';

/**
 * Paints and sculpts displacement terrain: drag to paint the second texture of the ground set (or erase back
 * to the first), raise, lower, smooth or flatten. Painting with a different ground set switches the
 * touched patches to it. One undo step per stroke.
 */
export class GroundTool implements Tool {
  name: ToolName = 'ground';
  private editor: Editor;
  private ring: LineLoop;
  private stroke: { disps: Disp[]; end: () => void; last: Vector3 | null; level: number; changed: boolean } | null = null;
  mode: GroundMode = 'paint';
  radius = 128;
  strength = 0.35;
  set: string = GROUND_SETS[0].material;

  constructor(editor: Editor) {
    this.editor = editor;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(64 * 3), 3));
    this.ring = new LineLoop(g, new LineBasicMaterial({ color: 0xffd060, depthTest: false, transparent: true, opacity: 0.9 }));
    this.ring.renderOrder = 12;
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    editor.scene.add(this.ring);
  }

  activate(): void {}
  deactivate(): void {
    this.ring.visible = false;
  }

  private showRing(p: Vector3): void {
    const pos = this.ring.geometry.getAttribute('position') as BufferAttribute;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      pos.setXYZ(k, p.x + Math.cos(a) * this.radius, p.y + Math.sin(a) * this.radius, p.z + 4);
    }
    pos.needsUpdate = true;
    this.ring.visible = true;
  }

  hoverAt(ndc: Vector2): void {
    const hit = pickSurface(this.editor, ndc);
    if (hit) this.showRing(hit.point); else this.ring.visible = false;
    this.editor.status = `Ground: ${this.mode}, radius ${this.radius}`;
  }

  down(_e: PointerEvent, ndc: Vector2): void {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return;
    const disps = this.editor.doc.allSolids().filter((s) => s.isDisplacement && !this.editor.hidden.has(s)).map(readDisp).filter((d): d is Disp => !!d);
    if (!disps.length) {
      this.editor.status = 'No terrain here: turn a floor brush into terrain first (tool options).';
      return;
    }
    const end = this.editor.history.begin(`Ground: ${this.mode}`, disps.map((d) => d.solid));
    this.stroke = { disps, end, last: null, level: hit.point.z, changed: false };
    this.apply(hit.point);
  }

  move(_e: PointerEvent, ndc: Vector2): void {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return;
    this.showRing(hit.point);
    if (!this.stroke) return;
    // Dabs about a quarter radius apart keep strokes even at any mouse speed.
    if (this.stroke.last && this.stroke.last.distanceTo(hit.point) < this.radius * 0.25) return;
    this.apply(hit.point);
  }

  private apply(p: Vector3): void {
    const s = this.stroke!;
    s.last = p.clone();
    const changed = dab(s.disps, p, { mode: this.mode, radius: this.radius, strength: this.strength, level: s.level });
    for (const d of changed) {
      if (this.mode === 'paint') setGroundMaterial(d, this.set);
      d.solid.version++;
    }
    if (changed.length) {
      s.changed = true;
      this.editor.changed(true);
    }
  }

  up(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    if (s.changed) {
      for (const d of s.disps) d.solid.reload();
      s.end();
    }
    this.editor.changed();
  }
}

/**
 * Replaces flat floor brushes with displacement terrain covering their top: patches of up to 512 units
 * (9×9 vertices, 64 apart) in the chosen ground set, all showing its first texture. One undo step.
 */
export function makeTerrain(editor: Editor, solids: MapSolid[], material: string): number {
  const doc = editor.doc;
  const created: MapSolid[] = [];
  editor.history.group('Make terrain', () => {
    for (const s of solids) {
      const b = solidBounds(s);
      const top = Math.round(b.max.z);
      for (let x = b.min.x; x < b.max.x - 1; x += 512) {
        for (let y = b.min.y; y < b.max.y - 1; y += 512) {
          const w = Math.min(512, b.max.x - x), h = Math.min(512, b.max.y - y);
          const power = Math.min(w, h) >= 256 ? 3 : 2;
          created.push(doc.addSolid(terrainPatch(doc, x, y, w, material, () => top, () => 0, power, top, h)));
        }
      }
    }
    editor.history.remove('Remove floor', solids);
    editor.history.added('Add terrain', created);
  });
  editor.selection.clear();
  editor.changed();
  return created.length;
}
