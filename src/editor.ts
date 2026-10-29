import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, HemisphereLight, DirectionalLight, GridHelper,
  Raycaster, Vector2, Vector3, Box3, SRGBColorSpace, ACESFilmicToneMapping,
} from 'three';
import { VmfDocument } from './vmf/map.ts';
import { WorldRenderer, type BrushHit } from './render/worldRenderer.ts';
import { MaterialLibrary } from './render/materials.ts';
import { CameraControls } from './render/cameraControls.ts';

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
    container.tabIndex = 0;

    this.camera = new PerspectiveCamera(70, 1, 4, 60000);
    this.camera.position.set(-1500, -1500, 1500);
    this.controls = new CameraControls(this.camera, this.renderer.domElement);
    this.controls.pick = (ndc) => this.pickBrush(ndc)?.point ?? null;

    this.scene.background = new Color(0x2a3038);
    this.scene.add(new HemisphereLight(0xdde6f2, 0x6a6258, 1.6));
    this.sun.position.set(0.4, 0.3, 1).normalize().multiplyScalar(10000);
    this.scene.add(this.sun, this.sun.target);

    this.grid = new GridHelper(16384, 128, 0x4a5260, 0x30353d);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    this.world = new WorldRenderer(this.materials);
    this.scene.add(this.world.group);

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
