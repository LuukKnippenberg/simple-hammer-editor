import {
  WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, Color, HemisphereLight, DirectionalLight, GridHelper,
  Raycaster, Vector2, Vector3, Box3, SRGBColorSpace, ACESFilmicToneMapping,
} from 'three';
import { VmfDocument } from './vmf/map.ts';
import { WorldRenderer, type BrushHit } from './render/worldRenderer.ts';
import { MaterialLibrary } from './render/materials.ts';
import { CameraControls } from './render/cameraControls.ts';
import { TopView } from './render/topView.ts';
import { EntityRenderer } from './render/entityRenderer.ts';
import { DecalRenderer } from './render/decalRenderer.ts';
import { textureSupport } from './assets/textures.ts';
import { pendingRequests } from './assets/fetch.ts';
import { loadFgd } from './assets/fgd.ts';
import { Selection } from './edit/selection.ts';
import { History } from './edit/history.ts';
import { ToolManager } from './edit/tools.ts';
import type { Sketch } from './gen/sketch.ts';
import { parseMission, type MissionGraph } from './lw/mission.ts';

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
  readonly topView: TopView;
  /** '3d' perspective editing or the orthographic 'top' view. */
  view: '3d' | 'top' = '3d';
  /** Objects hidden in the editor (H). Hidden objects are still saved and compiled. */
  readonly hidden = new Set<object>();
  readonly materials = new MaterialLibrary();
  readonly world: WorldRenderer;
  readonly entities: EntityRenderer;
  readonly decals: DecalRenderer;
  readonly hemi = new HemisphereLight(0xdde6f2, 0x6a6258, 1.6);
  readonly sun = new DirectionalLight(0xffffff, 2.2);
  readonly gridHelper: GridHelper;
  doc: VmfDocument = VmfDocument.empty();
  mapName = 'untitled.vmf';
  /** Unsaved changes since load or last save. */
  dirty = false;
  /** The text the document was loaded from, for the round-trip check. */
  sourceText = '';
  frame: FrameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };
  readonly selection: Selection;
  readonly history = new History(() => this.doc);
  readonly tools: ToolManager;
  /** Snap size in units. */
  grid = 16;
  currentMaterial = 'CONCRETE/CONCRETEFLOOR001A';
  entityClass = 'info_start_wars';
  entityModel = 'models/props_c17/oildrum001_static.mdl';
  decal: import('./edit/decals.ts').DecalSettings = { material: 'decals/decal_posters001a', mode: 'decal', size: 128, rotation: 0 };
  lastAutosave: Date | null = null;
  /** The 2D sketch the map was generated from (saved as maps/<name>.sketch.json). */
  sketch: Sketch | null = null;
  /** The mission flowchart (saved as maps/<name>.mission.json). */
  mission: MissionGraph | null = null;
  /** Transient status text (e.g. block dimensions while dragging). */
  status = '';
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
    this.topView = new TopView(this.renderer.domElement);

    this.scene.background = new Color(0x2a3038);
    this.scene.add(this.hemi);
    this.sun.position.set(0.4, 0.3, 1).normalize().multiplyScalar(10000);
    this.scene.add(this.sun, this.sun.target);

    this.gridHelper = new GridHelper(16384, 128, 0x4a5260, 0x30353d);
    this.gridHelper.rotation.x = Math.PI / 2;
    this.scene.add(this.gridHelper);

    this.world = new WorldRenderer(this.materials);
    this.scene.add(this.world.group);
    this.entities = new EntityRenderer(this.materials);
    this.scene.add(this.entities.group);
    this.world.hidden = this.entities.hidden = this.hidden;
    this.decals = new DecalRenderer(this.world);
    this.scene.add(this.decals.group);
    this.materials.onKindChange = () => this.world.applyVisibility();
    this.selection = new Selection(this.entities);
    this.scene.add(this.selection.group);
    this.tools = new ToolManager(this);
    void loadFgd().then(() => {
      this.entities.sync(this.doc);
      this.emit('fgd');
    });

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
    this.topView.setAspect(w / h);
  }

  get activeCamera(): PerspectiveCamera | OrthographicCamera {
    return this.view === 'top' ? this.topView.camera : this.camera;
  }

  /** Switches between the 3D view and the orthographic top view, keeping the same spot in view. */
  setView3dOrTop(mode: '3d' | 'top'): void {
    if (mode === this.view) return;
    this.view = mode;
    this.controls.enabled = mode === '3d';
    this.topView.enabled = mode === 'top';
    if (mode === 'top') {
      const f = this.controls.forward();
      const p = this.camera.position;
      const t = f.z < -0.05 ? -p.z / f.z : 2000;
      this.topView.center.set(p.x + f.x * t, p.y + f.y * t);
      this.topView.zoom = Math.max(512, Math.min(16000, Math.abs(p.z) * 0.9));
      this.topView.apply();
    } else {
      const c = this.topView.center;
      this.camera.position.set(c.x - this.topView.zoom * 0.5, c.y - this.topView.zoom * 0.7, this.topView.zoom * 0.9);
      this.controls.lookAt(new Vector3(c.x, c.y, 0));
    }
    this.tools.select.gizmo.camera = this.activeCamera;
    this.emit('view');
  }

  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.view === 'top') this.topView.update(dt);
    else this.controls.update(dt);
    this.emit('frame');
    // Distance fog makes no sense from the top view's camera, high above the map.
    const fog = this.scene.fog;
    if (this.view === 'top') this.scene.fog = null;
    this.renderer.render(this.scene, this.activeCamera);
    this.scene.fog = fog;

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

  loadDocument(doc: VmfDocument, name: string, sourceText = ''): void {
    this.doc = doc;
    this.mapName = name;
    this.sourceText = sourceText;
    this.dirty = false;
    this.history.clear();
    this.hidden.clear();
    this.sketch = null;
    this.mission = null;
    this.selection.clear();
    const t0 = performance.now();
    this.world.sync(doc);
    this.entities.sync(doc);
    this.decals.sync(doc);
    this.applyEnvironment();
    console.log(`[editor] built ${name} in ${Math.round(performance.now() - t0)} ms`, this.world.stats);
    const box = this.world.bounds();
    this.gridHelper.position.set(0, 0, 0);
    if (!box.isEmpty()) {
      this.frameBox(box);
      const c = box.getCenter(new Vector3());
      this.gridHelper.position.set(c.x, c.y, box.min.z - 1);
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
    this.loadDocument(doc, id.split(':')[1] ?? id, text);
    const sk = await fetch(`/api/sketch?id=${encodeURIComponent(id)}`);
    if (sk.ok) {
      this.sketch = await sk.json();
      this.emit('sketch');
    }
    const ms = await fetch(`/api/mission?id=${encodeURIComponent(id)}`);
    if (ms.ok) {
      this.mission = parseMission(await ms.text());
      this.emit('mission');
    }
  }

  /**
   * Call after mutating the document: rebuilds what changed and marks the map unsaved.
   * `live` is for per-frame updates during a drag (skips UI refreshes).
   */
  changed(live = false): void {
    this.world.sync(this.doc);
    this.entities.sync(this.doc);
    this.decals.sync(this.doc);
    this.selection.prune(this.doc);
    this.dirty = true;
    if (!live) this.emit('change');
  }

  /** Hides the selection in the editor (not in game). */
  hideSelection(): void {
    const sel = this.selection;
    if (sel.isEmpty) return;
    for (const s of sel.solids) this.hidden.add(s);
    for (const e of sel.entities) this.hidden.add(e);
    sel.clear();
    this.world.sync(this.doc);
    this.entities.sync(this.doc);
    this.emit('hidden');
  }

  unhideAll(): void {
    if (!this.hidden.size) return;
    this.hidden.clear();
    this.world.sync(this.doc);
    this.entities.sync(this.doc);
    this.emit('hidden');
  }

  undo(): void {
    const label = this.history.undo();
    if (label) this.changed();
  }

  redo(): void {
    const label = this.history.redo();
    if (label) this.changed();
  }

  setMaterial(name: string): void {
    this.currentMaterial = name.toUpperCase();
    this.emit('material');
  }

  /** Writes the VMF to the repo's maps/ folder. Bumps mapversion like Hammer does. */
  async save(name = this.mapName): Promise<{ id: string; bytes: number }> {
    if (!name.toLowerCase().endsWith('.vmf')) name += '.vmf';
    if (this.dirty) {
      const vi = this.doc.roots.find((r) => r.name.toLowerCase() === 'versioninfo');
      const v = (parseInt(vi?.get('mapversion') ?? '0', 10) || 0) + 1;
      vi?.set('mapversion', String(v));
      if (this.doc.world.get('mapversion') !== undefined) this.doc.world.set('mapversion', String(v));
    }
    const text = this.doc.serialize();
    const res = await fetch(`/api/map/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: text });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error ?? 'save failed');
    if (this.sketch) {
      await fetch(`/api/sketch?name=${encodeURIComponent(name.replace(/\.vmf$/i, '.sketch.json'))}`, { method: 'POST', body: JSON.stringify(this.sketch) });
    }
    if (this.mission) {
      await fetch(`/api/mission?name=${encodeURIComponent(name.replace(/\.vmf$/i, '.mission.json'))}`, { method: 'POST', body: JSON.stringify(this.mission, null, 1) });
    }
    this.mapName = name;
    this.sourceText = text;
    this.dirty = false;
    this.emit('saved');
    return out;
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

  setView(pos: Vector3, target: Vector3): void {
    this.camera.position.copy(pos);
    this.controls.lookAt(target);
  }

  frameBox(box: Box3): void {
    if (this.view === 'top') this.topView.frame(box);
    else this.controls.frame(box);
  }

  ndcFromEvent(e: { clientX: number; clientY: number }): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  raycaster(ndc: Vector2): Raycaster {
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.activeCamera);
    return ray;
  }

  pickBrush(ndc: Vector2): BrushHit | null {
    return this.world.raycast(this.raycaster(ndc));
  }
}
