import { Color, Fog, SRGBColorSpace, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { fetchGameFile } from '../assets/fetch.ts';
import { cameraShots, simulateShot, type AtmospherePreset } from '../lw/cinematics.ts';
import { h } from '../ui/dom.ts';

/**
 * Plays a camera shot in the editor viewport: the editor camera follows the route the game's
 * point_viewcontrol would take (simulateShot) and looks at the target, between letterbox bars, for the
 * shot's length. Esc or a click stops it and puts the camera back.
 */
export function playShot(editor: Editor, cam: MapEntity): void {
  const shot = cameraShots(editor.doc).find((s) => s.camera === cam);
  if (!shot || !shot.route.length) return;
  if (editor.view !== '3d') editor.setView3dOrTop('3d');
  const frames = simulateShot(shot.route, shot.speed, shot.duration);
  const look = shot.lookAt ?? shot.route[0].clone().add(new Vector3(100, 0, 0));
  const saved = { pos: editor.camera.position.clone(), fwd: editor.controls.forward().clone() };
  const top = h('div.cine-bar.top'), bottom = h('div.cine-bar.bottom');
  const caption = h('div.cine-caption');
  editor.container.append(top, bottom, caption);
  const t0 = performance.now();
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    top.remove(); bottom.remove(); caption.remove();
    window.removeEventListener('keydown', onKey, true);
    editor.container.removeEventListener('pointerdown', stop, true);
    editor.camera.position.copy(saved.pos);
    editor.controls.lookAt(saved.pos.clone().add(saved.fwd));
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); stop(); } };
  window.addEventListener('keydown', onKey, true);
  editor.container.addEventListener('pointerdown', stop, true);
  const step = () => {
    if (done) return;
    const t = (performance.now() - t0) / 1000;
    if (t >= shot.duration) return stop();
    const p = frames[Math.min(frames.length - 1, Math.floor(t * 60))];
    editor.camera.position.copy(p);
    editor.controls.lookAt(look);
    caption.textContent = `🎬 ${cam.get('targetname') ?? 'shot'}  ${t.toFixed(1)} / ${shot.duration.toFixed(1)} s  ·  Esc stops`;
    requestAnimationFrame(step);
  };
  step();
}

/** Shows a still of the shot's first or last frame (for screenshots and quick checks). */
export function frameShot(editor: Editor, cam: MapEntity, at: 'start' | 'end'): void {
  const shot = cameraShots(editor.doc).find((s) => s.camera === cam);
  if (!shot?.route.length) return;
  const frames = simulateShot(shot.route, shot.speed, shot.duration);
  const p = at === 'start' ? frames[0] : frames[frames.length - 1];
  if (editor.view !== '3d') editor.setView3dOrTop('3d');
  editor.camera.position.copy(p);
  editor.controls.lookAt(shot.lookAt ?? p.clone().add(new Vector3(100, 0, 0)));
}

const luts = new Map<string, Promise<Uint8Array | null>>();

/** A colour correction table: 32×32×32 RGB bytes. */
function loadLut(path: string): Promise<Uint8Array | null> {
  let p = luts.get(path);
  if (!p) luts.set(path, (p = fetchGameFile(path).then((b) => (b && b.byteLength >= 32 * 32 * 32 * 3 ? new Uint8Array(b) : null))));
  return p;
}

/** How the table maps a mid grey, per channel (1 = unchanged). Greys sit on the diagonal, so the axis order doesn't matter. */
export function lutGain(lut: Uint8Array, level = 0.6): [number, number, number] {
  const i = Math.round(level * 31);
  const o = ((i * 32 + i) * 32 + i) * 3;
  const ref = (i / 31) * 255;
  return [lut[o] / ref, lut[o + 1] / ref, lut[o + 2] / ref];
}

/**
 * Previews an atmosphere preset in the viewport: the fog (colour and distances) and an approximation of
 * its colour correction (the table's effect on a mid grey, as a tint over the view). Call with null to
 * go back to the map's own look.
 */
export class AtmospherePreview {
  private editor: Editor;
  private tint = h('div.cine-tint');
  active: AtmospherePreset | null = null;
  private saved: { fog: Fog | null; bg: Color } | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
    this.tint.hidden = true;
    editor.container.append(this.tint);
    editor.on('document', () => void this.show(null));
  }

  async show(p: AtmospherePreset | null): Promise<void> {
    const ed = this.editor;
    const canvas = ed.renderer.domElement;
    if (!p) {
      if (this.saved) {
        ed.scene.fog = this.saved.fog;
        (ed.scene.background as Color).copy(this.saved.bg);
      }
      this.saved = null;
      this.active = null;
      this.tint.hidden = true;
      canvas.style.filter = '';
      ed.emit('atmosphere');
      return;
    }
    this.saved ??= { fog: ed.scene.fog as Fog | null, bg: (ed.scene.background as Color).clone() };
    this.active = p;
    const [r, g, b] = p.fogcolor.split(/\s+/).map((x) => (Number(x) || 0) / 255);
    const color = new Color().setRGB(r, g, b, SRGBColorSpace);
    ed.scene.fog = new Fog(color, p.fogstart, Math.max(p.fogstart + 1, p.fogend));
    (ed.scene.background as Color).copy(color);
    const lut = p.cc ? await loadLut(p.cc) : null;
    if (this.active !== p) return;
    if (lut) {
      const gain = lutGain(lut).map((x) => 1 + (x - 1) * p.ccWeight);
      const max = Math.max(...gain, 1);
      this.tint.hidden = false;
      this.tint.style.background = `rgb(${gain.map((x) => Math.round((x / max) * 255)).join(',')})`;
      canvas.style.filter = max > 1.01 ? `brightness(${max.toFixed(2)})` : '';
    } else {
      this.tint.hidden = true;
      canvas.style.filter = '';
    }
    ed.emit('atmosphere');
  }
}
