import { Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { Tool, ToolName } from './tools.ts';
import { pickObject, pickSurface, snap } from './tools.ts';
import { placeEntity } from './actions.ts';
import { addPreset } from './presetAction.ts';
import { SOUND_PRESETS } from '../lw/soundPresets.ts';

export type SoundToolMode = 'zone' | 'sound';

/**
 * Click to place a soundscape zone (env_soundscape with a radius) or a local sound: an ambient_generic
 * playing the chosen file, or a preset (sound plus effects). A preset clicked onto a fitting prop is added
 * to that prop instead of bringing its own.
 */
export class SoundTool implements Tool {
  name: ToolName = 'sound';
  private editor: Editor;
  mode: SoundToolMode = 'zone';
  soundscape = 'wars.canals.street';
  radius = 768;
  /** 'file' or a preset id. */
  local = 'file';
  sound = 'ambient/levels/canals/waterleak_loop1.wav';
  soundRadius = 512;
  volume = 6;

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
    const ground = new Vector3(snap(hit.point.x, g), snap(hit.point.y, g), Math.round(hit.point.z));
    if (this.mode === 'zone') {
      placeEntity(this.editor, 'env_soundscape', ground.clone().setZ(ground.z + 64), { soundscape: this.soundscape, radius: String(Math.round(this.radius)), StartDisabled: '0' });
      return;
    }
    if (this.local === 'file') {
      placeEntity(this.editor, 'ambient_generic', ground.clone().setZ(ground.z + 32), {
        message: this.sound, health: String(this.volume), radius: String(Math.round(this.soundRadius)), pitch: '100', pitchstart: '100', spawnflags: '0',
      });
      return;
    }
    const preset = SOUND_PRESETS.find((p) => p.id === this.local);
    if (!preset) return;
    const obj = pickObject(this.editor, ndc);
    const onto = obj?.entity && preset.suits?.test(obj.entity.get('model') ?? '') ? obj.entity : undefined;
    // Stand-alone presets face the camera.
    const cam = this.editor.activeCamera.position;
    const yaw = Math.round((Math.atan2(cam.y - ground.y, cam.x - ground.x) * 180) / Math.PI / 15) * 15;
    addPreset(this.editor, preset, ground, yaw, onto);
  }
}
