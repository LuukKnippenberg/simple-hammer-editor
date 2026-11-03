import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { audio } from './engine.ts';

/** A soundscape zone: env_soundscape with a radius (-1: everywhere, the map's default). */
export interface Zone { entity: MapEntity; soundscape: string; radius: number; origin: Vector3 }

export function soundscapeZones(entities: MapEntity[]): Zone[] {
  return entities
    .filter((e) => e.classname === 'env_soundscape' && e.get('soundscape') && e.get('StartDisabled') !== '1')
    .map((e) => ({ entity: e, soundscape: e.get('soundscape')!.toLowerCase(), radius: parseFloat(e.get('radius') ?? '128') || 0, origin: e.origin ?? new Vector3() }));
}

/**
 * The zone heard at `p`: the nearest zone whose radius reaches it (measured on the ground plan: zones act
 * as columns, since the RTS camera's view point and a zone placed on a roof or in a street should still
 * match), else the map default. (In game the
 * nearest zone in range that the player's camera can see wins, and its soundscape keeps playing after the
 * player leaves until another zone takes over; the editor falls back to the default instead, which shows
 * the zones' extent more clearly.)
 */
export function activeZone(zones: Zone[], p: Vector3): Zone | null {
  let best: Zone | null = null, bestD = Infinity;
  for (const z of zones) {
    if (z.radius < 0) continue;
    const d = Math.hypot(z.origin.x - p.x, z.origin.y - p.y);
    if (d <= z.radius && d < bestD) { best = z; bestD = d; }
  }
  return best ?? zones.find((z) => z.radius < 0) ?? null;
}

/**
 * Picks the soundscape for where the camera looks: the ground point at the screen centre (the RTS camera
 * hangs high above the action), or the camera itself when it's close to the ground.
 */
export class SoundscapeController {
  private editor: Editor;
  private last = 0;
  /** A soundscape auditioned from the UI, which overrides the zones until `until`. */
  audition: { name: string; until: number } | null = null;
  active: Zone | null = null;
  listener = new Vector3();

  constructor(editor: Editor) {
    this.editor = editor;
    editor.on('frame', () => this.update());
  }

  listenerPoint(): Vector3 {
    const ed = this.editor;
    const cam = ed.sceneCamera;
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), cam);
    const hit = ed.world.raycast(ray);
    const ground = hit?.point ?? ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3());
    if (!ground || cam.position.distanceTo(ground) < 400) return cam.position.clone();
    return ground;
  }

  private update(): void {
    const now = performance.now();
    if (now - this.last < 250) return;
    this.last = now;
    if (this.audition && now > this.audition.until) this.audition = null;
    if (!audio.enabled) return;
    this.listener = this.listenerPoint();
    this.active = activeZone(soundscapeZones(this.editor.doc.entities), this.listener);
    audio.playSoundscape(this.audition?.name ?? this.active?.soundscape ?? null);
    this.editor.emit('soundscape');
  }
}
