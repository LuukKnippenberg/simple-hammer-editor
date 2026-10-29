import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, HemisphereLight, DirectionalLight, GridHelper,
  Raycaster, Vector2, Vector3, Box3, SRGBColorSpace, ACESFilmicToneMapping,
} from 'three';
import { VmfDocument } from './vmf/map.ts';
import { WorldRenderer, type BrushHit } from './render/worldRenderer.ts';
import { MaterialLibrary } from './render/materials.ts';
import { CameraControls } from './render/cameraControls.ts';
import { EntityRenderer } from './render/entityRenderer.ts';
import { textureSupport } from './assets/textures.ts';
import { pendingRequests } from './assets/fetch.ts';

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

/** Owns the three.js scene, the open document and the render loop. UI modules hang off this. */
export class Editor {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: CameraControls;
  readonly materials = new MaterialLibrary();
  readonly world: WorldRenderer;
  readonly entities: EntityRenderer;
  readonly hemi = new HemisphereLight(0xdde6f2, 0x6a6258, 1.6);
  readonly sun = new DirectionalLight(0xffffff, 2.2);
  readonly grid: GridHelper;
  doc: VmfDocument = VmfDocument.empty();
  mapName = 'untitled.vmf';
  frame: FrameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };
  private listeners = new Map<string, Set<() => void>>();
  private frameTimes: number[] = [];
  private lastTime = performance.now();
  readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    const ext = this.renderer.extensions;
    textureSupport.s3tcSrgb = ext.has('WEBGL_compressed_texture_s3tc') && ext.has('WEBGL_compressed_texture_s3tc_srgb');
    textureSupport.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    container.tabIndex = 0;

    this.camera = new PerspectiveCamera(70, 1, 4, 60000);
    this.camera.position.set(-1500, -1500, 1500);
    this.controls = new CameraControls(this.camera, this.renderer.domElement);
    this.controls.pick = (ndc) => this.pickBrush(ndc)?.point ?? null;

    this.scene.background = new Color(0x2a3038);
    this.scene.add(this.hemi);
    this.sun.position.set(0.4, 0.3, 1).normalize().multiplyScalar(10000);
    this.scene.add(this.sun, this.sun.target);

    this.grid = new GridHelper(16384, 128, 0x4a5260, 0x30353d);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    this.world = new WorldRenderer(this.materials);
    this.scene.add(this.world.group);
    this.entities = new EntityRenderer(this.materials);
    this.scene.add(this.entities.group);
    this.materials.onKindChange = () => this.world.applyVisibility();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  on(event: string, fn: () => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  emit(event: string): void {
    this.listeners.get(event)?.forEach((fn) => fn());
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.controls.update(dt);
    this.emit('frame');
    this.renderer.render(this.scene, this.camera);

    this.frameTimes.push(now);
    while (this.frameTimes.length && this.frameTimes[0] < now - 1000) this.frameTimes.shift();
    const info = this.renderer.info.render;
    this.frame = {
      fps: this.frameTimes.length,
      frameMs: Math.round(dt * 10000) / 10,
      drawCalls: info.calls,
      triangles: info.triangles,
    };
  };

  loadDocument(doc: VmfDocument, name: string): void {
    this.doc = doc;
    this.mapName = name;
    const t0 = performance.now();
    this.world.sync(doc);
    this.entities.sync(doc);
    this.applyEnvironment();
    console.log(`[editor] built ${name} in ${Math.round(performance.now() - t0)} ms`, this.world.stats);
    const box = this.world.bounds();
    if (!box.isEmpty()) {
      this.frameBox(box);
      const c = box.getCenter(new Vector3());
      this.grid.position.set(c.x, c.y, box.min.z - 1);
    }
    this.emit('document');
  }

  async loadMapById(id: string): Promise<void> {
    const res = await fetch(`/api/map?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Could not load ${id}`);
    const text = await res.text();
    const t0 = performance.now();
    const doc = VmfDocument.parse(text);
    console.log(`[editor] parsed ${id} in ${Math.round(performance.now() - t0)} ms`);
    this.loadDocument(doc, id.split(':')[1] ?? id);
  }

  /** True while textures or models are still streaming in. */
  busy(): boolean {
    return pendingRequests() > 0;
  }

  /** Sun and ambient from light_environment, background from the fog controller. */
  applyEnvironment(): void {
    const ents = this.doc.entities;
    const le = ents.find((e) => e.classname === 'light_environment');
    const rgb = (s: string | undefined, fallback: [number, number, number, number]) => {
      const p = (s ?? '').trim().split(/\s+/).map(Number);
      return p.length >= 3 && p.every(Number.isFinite) ? [p[0], p[1], p[2], p[3] ?? 200] : fallback;
    };
    if (le) {
      const ang = le.angles;
      const pitch = le.get('pitch') !== undefined ? parseFloat(le.get('pitch')!) : ang.x;
      const d = Math.PI / 180;
      // AngleVectors() of the light_environment angles points towards the sun.
      const toSun = new Vector3(Math.cos(pitch * d) * Math.cos(ang.y * d), Math.cos(pitch * d) * Math.sin(ang.y * d), -Math.sin(pitch * d));
      if (toSun.z < 0.15) toSun.z = 0.15;
      this.sun.position.copy(toSun.normalize().multiplyScalar(10000));
      const [r, g, b, i] = rgb(le.get('_light'), [255, 255, 255, 200]);
      const max = Math.max(r, g, b, 1);
      this.sun.color.setRGB(r / max, g / max, b / max);
      this.sun.intensity = Math.min(3.2, Math.max(1.2, (i / 200) * 2.2));
      const [ar, ag, ab] = rgb(le.get('_ambient'), [150, 160, 180, 20]);
      const amax = Math.max(ar, ag, ab, 1);
      this.hemi.color.setRGB(0.55 + 0.45 * (ar / amax), 0.55 + 0.45 * (ag / amax), 0.55 + 0.45 * (ab / amax));
      // vrad bounces light into shadowed areas; a strong hemisphere term stands in for that.
      this.hemi.intensity = 2.1;
    }
    const fog = ents.find((e) => e.classname === 'env_fog_controller');
    const [fr, fg, fb] = rgb(fog?.get('fogcolor'), [42, 48, 56, 0]);
    const bg = new Color(fr / 255, fg / 255, fb / 255);
    // Keep the background readable even for black fog.
    const hsl = { h: 0, s: 0, l: 0 };
    bg.getHSL(hsl);
    bg.setHSL(hsl.h, Math.min(hsl.s, 0.4), Math.min(0.55, Math.max(0.16, hsl.l)));
    (this.scene.background as Color).copy(bg);
  }

  frameBox(box: Box3): void {
    this.controls.frame(box);
  }

  ndcFromEvent(e: { clientX: number; clientY: number }): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  raycaster(ndc: Vector2): Raycaster {
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  pickBrush(ndc: Vector2): BrushHit | null {
    return this.world.raycast(this.raycaster(ndc));
  }
}
