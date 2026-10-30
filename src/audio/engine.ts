import { fetchGameFile } from '../assets/fetch.ts';
import { loadSoundscapes, type Soundscape, type SoundRule } from './soundscapes.ts';

/**
 * Web Audio playback of the game's sounds: soundscapes (looping beds and timed random one-shots, nested
 * soundscapes included) with cross-fades between them, and positional sources for local sounds.
 * The context starts suspended until a user gesture enables it.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private scape: { name: string; gain: GainNode; stop: () => void } | null = null;
  enabled = false;
  volume = 0.7;
  /** What plays now, for the viewport readout. */
  stats = { soundscape: '', loops: 0, oneShots: 0, local: 0, missing: 0 };

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    const ctx = this.context();
    if (on) await ctx.resume();
    else {
      this.playSoundscape(null);
      await ctx.suspend();
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Decoded buffer for a game sound path (sound/...), cached; null when missing or undecodable. */
  buffer(path: string): Promise<AudioBuffer | null> {
    const key = path.toLowerCase();
    let p = this.buffers.get(key);
    if (!p) {
      p = (async () => {
        const data = await fetchGameFile(key);
        if (!data) { this.stats.missing++; return null; }
        try {
          return await this.context().decodeAudioData(data.slice(0));
        } catch {
          this.stats.missing++;
          return null;
        }
      })();
      this.buffers.set(key, p);
    }
    return p;
  }

  /** Plays a sound once (UI previews). */
  async preview(path: string, volume = 1): Promise<number> {
    const ctx = this.context();
    await ctx.resume();
    const buf = await this.buffer(path);
    if (!buf) return 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master!);
    src.start();
    return buf.duration;
  }

  /** Switches the soundscape bed, cross-fading over two seconds. Null stops it. */
  playSoundscape(name: string | null): void {
    if ((this.scape?.name ?? null) === (name?.toLowerCase() ?? null)) return;
    const ctx = this.context();
    const old = this.scape;
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      setTimeout(() => old.stop(), 2500);
    }
    this.scape = null;
    this.stats.soundscape = name ?? '';
    this.stats.loops = this.stats.oneShots = 0;
    if (!name || !this.enabled) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.5);
    gain.connect(this.master!);
    const stops: (() => void)[] = [];
    const entry = { name: name.toLowerCase(), gain, stop: () => { for (const s of stops) s(); gain.disconnect(); } };
    this.scape = entry;
    void loadSoundscapes().then((all) => {
      if (this.scape !== entry) return;
      this.startRules(all, all.get(name.toLowerCase()), gain, 1, stops, 0);
    });
  }

  private startRules(all: Map<string, Soundscape>, s: Soundscape | undefined, out: AudioNode, volume: number, stops: (() => void)[], depth: number): void {
    if (!s || depth > 4) return;
    for (const r of s.rules) this.startRule(all, r, out, volume, stops, depth);
  }

  private startRule(all: Map<string, Soundscape>, r: SoundRule, out: AudioNode, volume: number, stops: (() => void)[], depth: number): void {
    const ctx = this.ctx!;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    if (r.kind === 'nested') { this.startRules(all, all.get(r.name), out, volume * r.volume, stops, depth + 1); return; }
    if (r.kind === 'loop') {
      void this.buffer(r.wave).then((buf) => {
        if (!buf || !this.scape) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.playbackRate.value = r.pitch / 100;
        const g = ctx.createGain();
        g.gain.value = r.volume * volume;
        src.connect(g).connect(out);
        src.start();
        this.stats.loops++;
        stops.push(() => { try { src.stop(); } catch { /* already stopped */ } });
      });
      return;
    }
    // Random one-shots: each at a random time in the range, panned to a random side ("position random").
    let timer = 0;
    let alive = true;
    const schedule = (first: boolean) => {
      timer = window.setTimeout(async () => {
        if (!alive) return;
        const buf = await this.buffer(r.waves[Math.floor(Math.random() * r.waves.length)]);
        if (buf && alive) {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.playbackRate.value = rnd(r.pitch[0], r.pitch[1]) / 100;
          const g = ctx.createGain();
          g.gain.value = rnd(r.volume[0], r.volume[1]) * volume;
          const pan = ctx.createStereoPanner();
          pan.pan.value = rnd(-0.8, 0.8);
          src.connect(g).connect(pan).connect(out);
          src.start();
          this.stats.oneShots++;
        }
        schedule(false);
      }, rnd(first ? 0.5 : r.time[0], r.time[1]) * 1000);
    };
    schedule(true);
    stops.push(() => { alive = false; clearTimeout(timer); });
  }
}

/** One engine for the editor. */
export const audio = new AudioEngine();
