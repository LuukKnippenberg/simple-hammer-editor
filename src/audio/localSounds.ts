import { Vector3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { fetchGameFile } from '../assets/fetch.ts';
import { audio } from './engine.ts';
import type { SoundscapeController } from './listener.ts';

/** ambient_generic's sound path as a game file (sound/...), or null for a soundscript name. */
export function soundPath(message: string | undefined): string | null {
  if (!message) return null;
  const m = message.replace(/^[*#@)(><^]+/, '').replace(/\\/g, '/').toLowerCase();
  if (!/\.(wav|mp3)$/.test(m)) return null;
  return m.startsWith('sound/') ? m : `sound/${m}`;
}

const loopCache = new Map<string, Promise<boolean>>();
/** True when the WAV has loop points (a `cue ` or `smpl` chunk): the engine then loops it. */
export function wavLoops(path: string): Promise<boolean> {
  let p = loopCache.get(path);
  if (!p) {
    p = fetchGameFile(path).then((b) => {
      if (!b || b.byteLength < 12) return false;
      const dv = new DataView(b);
      for (let o = 12; o + 8 <= b.byteLength;) {
        const id = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
        if (id === 'cue ' || id === 'smpl') return true;
        const size = dv.getUint32(o + 4, true);
        o += 8 + size + (size & 1);
      }
      return false;
    });
    loopCache.set(path, p);
  }
  return p;
}

/** A sound an entity makes, as the game would play it. */
export interface LocalSound { entity: MapEntity; path: string; radius: number; volume: number; pitch: number; kind: 'ambient' | 'spark' }

const SPARKS = ['sound/ambient/energy/spark5.wav', 'sound/ambient/energy/spark6.wav', 'sound/ambient/energy/zap1.wav'];

/** ambient_generic (not started silent) and env_spark (its crackle) entities. */
export function localSounds(entities: MapEntity[]): LocalSound[] {
  const out: LocalSound[] = [];
  for (const e of entities) {
    if (!e.origin) continue;
    const flags = parseInt(e.get('spawnflags') ?? '0', 10) || 0;
    if (e.classname === 'ambient_generic') {
      const path = soundPath(e.get('message'));
      if (!path || flags & 16) continue;
      out.push({
        entity: e, path, kind: 'ambient',
        radius: flags & 1 ? 1e6 : parseFloat(e.get('radius') ?? '1250') || 1250,
        volume: Math.min(1, (parseFloat(e.get('health') ?? '10') || 0) / 10),
        pitch: parseFloat(e.get('pitch') ?? '100') || 100,
      });
    } else if (e.classname === 'env_spark' && flags & 64) {
      out.push({ entity: e, path: SPARKS[0], radius: 512, volume: 0.6, pitch: 100, kind: 'spark' });
    }
  }
  return out;
}

interface Voice { src: AudioBufferSourceNode | null; panner: PannerNode; gain: GainNode; timer: number; key: string }

/**
 * Plays local sounds positioned in 3D around the listener (the same point the soundscape uses): looping
 * sounds while in range, one-shots each time the listener comes into range, sparks at random intervals.
 */
export class LocalSoundPlayer {
  private editor: Editor;
  private scapes: SoundscapeController;
  private voices = new Map<MapEntity, Voice>();
  private last = 0;
  sounds: LocalSound[] = [];

  constructor(editor: Editor, scapes: SoundscapeController) {
    this.editor = editor;
    this.scapes = scapes;
    editor.on('frame', () => this.update());
    for (const ev of ['change', 'document']) editor.on(ev, () => (this.sounds = localSounds(editor.doc.entities)));
    this.sounds = localSounds(editor.doc.entities);
  }

  private stop(e: MapEntity): void {
    const v = this.voices.get(e);
    if (!v) return;
    clearTimeout(v.timer);
    try { v.src?.stop(); } catch { /* not started */ }
    v.gain.disconnect();
    this.voices.delete(e);
  }

  private update(): void {
    const now = performance.now();
    if (now - this.last < 200) return;
    this.last = now;
    if (!audio.enabled || !audio.ctx || !audio.master) {
      for (const e of [...this.voices.keys()]) this.stop(e);
      audio.stats.local = 0;
      return;
    }
    const ctx = audio.ctx;
    const at = this.scapes.listener;
    // The listener hears from the camera's direction, standing at the point it looks at.
    const l = ctx.listener;
    const fwd = new Vector3();
    this.editor.activeCamera.getWorldDirection(fwd);
    fwd.z = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 1, 0);
    fwd.normalize();
    if (l.positionX) {
      l.positionX.value = at.x; l.positionY.value = at.y; l.positionZ.value = at.z + 64;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = 0;
      l.upX.value = 0; l.upY.value = 0; l.upZ.value = 1;
    }
    const alive = new Set<MapEntity>();
    for (const s of this.sounds) {
      const o = s.entity.origin!;
      const inRange = o.distanceTo(at) < s.radius;
      const key = `${s.path}|${s.radius}|${s.volume}|${o.x},${o.y},${o.z}`;
      if (this.voices.get(s.entity)?.key !== key) this.stop(s.entity);
      if (!inRange) { this.stop(s.entity); continue; }
      alive.add(s.entity);
      if (this.voices.has(s.entity)) continue;
      const panner = new PannerNode(ctx, {
        panningModel: 'HRTF', distanceModel: 'linear', refDistance: 1, maxDistance: Math.min(s.radius, 1e5), rolloffFactor: 1,
        positionX: o.x, positionY: o.y, positionZ: o.z,
      });
      const gain = ctx.createGain();
      gain.gain.value = s.volume;
      gain.connect(panner).connect(audio.master);
      const voice: Voice = { src: null, panner, gain, timer: 0, key };
      this.voices.set(s.entity, voice);
      const play = async (path: string, loop: boolean) => {
        const buf = await audio.buffer(path);
        if (!buf || this.voices.get(s.entity) !== voice) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = loop;
        src.playbackRate.value = s.pitch / 100;
        src.connect(gain);
        src.start();
        voice.src = src;
      };
      if (s.kind === 'spark') {
        const tick = () => {
          void play(SPARKS[Math.floor(Math.random() * SPARKS.length)], false);
          const max = parseFloat(s.entity.get('MaxDelay') ?? '2') || 2;
          voice.timer = window.setTimeout(tick, (0.3 + Math.random() * max) * 1000);
        };
        tick();
      } else {
        void wavLoops(s.path).then((loop) => play(s.path, loop));
      }
    }
    for (const e of [...this.voices.keys()]) if (!alive.has(e)) this.stop(e);
    audio.stats.local = this.voices.size;
  }
}
