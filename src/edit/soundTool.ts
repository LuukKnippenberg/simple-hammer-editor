import { Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickSurface, snap } from './tools.ts';
import { placeEntity } from './actions.ts';

export type SoundToolMode = 'zone' | 'sound';

/**
 * Click to place a soundscape zone (env_soundscape with a radius); local sounds come in the second mode.
 */
export class SoundTool implements Tool {
  name: ToolName = 'sound';
  private editor: Editor;
  mode: SoundToolMode = 'zone';
  soundscape = 'wars.canals.street';
  radius = 768;

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
    const at = new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), Math.round(hit.point.z) + 64);
    if (this.mode === 'zone') {
      placeEntity(this.editor, 'env_soundscape', at, { soundscape: this.soundscape, radius: String(Math.round(this.radius)), StartDisabled: '0' });
    }
  }
}
