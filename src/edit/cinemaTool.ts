import { Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface, snap } from './tools.ts';
import { placeEntity } from './actions.ts';
import { PATH_CLASSES, chainOf } from '../lw/cinematics.ts';
import { addPathNode, addScreen } from '../lw/cinematicsAction.ts';
import { toast } from '../ui/dom.ts';

export type CinemaMode = 'path' | 'particle' | 'screen';

/**
 * Cinema tool (C): draws paths (click to add nodes at a height above the surface; a selected end node
 * extends its path), places particle systems, and puts switchable screens on walls.
 */
export class CinemaTool implements Tool {
  name: ToolName = 'cinema';
  private editor: Editor;
  mode: CinemaMode = 'path';
  /** Node height above the clicked surface (flight paths fly high, unit routes stay at 16). */
  height = 512;
  effect = 'smoke_large_01';
  startActive = false;
  screenMaterial = 'PROPS/TVSCREEN001A';
  screenW = 128;
  screenH = 96;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  activate(): void {}
  deactivate(): void {}
  down(): void {}
  move(): void {}

  up(_e: PointerEvent, ndc: Vector2): void {
    const hit = pickSurface(this.editor, ndc);
    if (!hit) return;
    const g = this.editor.grid;
    const at = new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), Math.round(hit.point.z));
    if (this.mode === 'path') {
      // A selected node that ends its path is extended; anything else starts a new path.
      const sel = [...this.editor.selection.entities];
      const node = sel.length === 1 && PATH_CLASSES.includes(sel[0].classname) ? sel[0] : null;
      const chain = node ? chainOf(this.editor.doc, node) : undefined;
      const after = node && chain && !chain.loop && chain.nodes[chain.nodes.length - 1] === node ? node : null;
      addPathNode(this.editor, at.setZ(at.z + this.height), after);
      return;
    }
    if (this.mode === 'particle') {
      placeEntity(this.editor, 'info_particle_system', at, { effect_name: this.effect, start_active: this.startActive ? '1' : '0', angles: '0 0 0' });
      return;
    }
    if (Math.abs(hit.normal.z) > 0.5) {
      toast(this.editor.container, 'Click a wall: screens hang on vertical surfaces');
      return;
    }
    const center = new Vector3(Math.round(hit.point.x), Math.round(hit.point.y), Math.round(hit.point.z));
    void addScreen(this.editor, center, hit.normal, this.screenW, this.screenH, this.screenMaterial);
  }

  key(e: KeyboardEvent): boolean {
    if (this.mode === 'path' && e.key === 'Escape') {
      this.editor.selection.clear();
      return true;
    }
    return false;
  }
}
