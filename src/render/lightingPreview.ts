import { Color, Fog, Object3D, PCFSoftShadowMap, PointLight, SpotLight, Vector3, Box3 } from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { sourceRotation } from './entityRenderer.ts';

const POINT_POOL = 24;
const SPOT_POOL = 8;

/** "r g b brightness" (Source `_light`) → linear colour and brightness. */
export function parseLight(s: string | undefined, fallback = '255 255 255 200'): { color: Color; brightness: number } {
  const p = (s ?? fallback).trim().split(/\s+/).map(Number);
  const [r, g, b] = [p[0] ?? 255, p[1] ?? 255, p[2] ?? 255].map((x) => (Number.isFinite(x) ? x : 255));
  const brightness = Number.isFinite(p[3]) ? p[3] : 200;
  return { color: new Color().setRGB(r / 255, g / 255, b / 255).convertSRGBToLinear(), brightness };
}

interface LightSource {
  entity: MapEntity;
  kind: 'point' | 'spot';
  position: Vector3;
  color: Color;
  intensity: number;
  distance: number;
  decay: number;
  direction?: Vector3;
  angle?: number;
  penumbra?: number;
}

/** Converts light entities into three.js light parameters (brightness tuned to look like vrad's result). */
/**
 * Distance fog of the map's fog controller. Three's fog has no density cap, so a lower max density
 * stretches the fog over a longer distance instead (close enough at RTS camera distances).
 */
export function previewFog(entities: MapEntity[]): Fog | null {
  const fog = entities.find((e) => e.classname === 'env_fog_controller');
  if (!fog || fog.get('fogenable') !== '1') return null;
  const [r, g, b] = (fog.get('fogcolor') ?? '255 255 255').trim().split(/\s+/).map((x) => (Number(x) || 0) / 255);
  const start = parseFloat(fog.get('fogstart') ?? '500') || 0;
  const end = Math.max(start + 1, parseFloat(fog.get('fogend') ?? '2000') || 2000);
  const density = Math.min(1, Math.max(0.05, parseFloat(fog.get('fogmaxdensity') ?? '1') || 1));
  return new Fog(new Color(r, g, b), start, start + (end - start) / density);
}

export function lightSources(entities: MapEntity[]): LightSource[] {
  const out: LightSource[] = [];
  for (const e of entities) {
    const cls = e.classname;
    const o = e.origin;
    if (!o) continue;
    if (cls === 'light' || cls === 'light_spot') {
      const { color, brightness } = parseLight(e.get('_light'));
      // vrad uses quadratic falloff from the brightness value; this keeps the reach similar.
      const intensity = brightness * 900;
      const src: LightSource = { entity: e, kind: cls === 'light' ? 'point' : 'spot', position: o, color, intensity, distance: Math.sqrt(intensity / 0.01), decay: 2 };
      if (cls === 'light_spot') {
        const a = e.angles;
        // The separate `pitch` key overrides angles[0] with the opposite sign convention.
        const pitch = e.get('pitch');
        if (pitch !== undefined) a.x = -parseFloat(pitch);
        src.direction = new Vector3(1, 0, 0).applyQuaternion(sourceRotation(a));
        const cone = parseFloat(e.get('_cone') ?? '45') || 45;
        const inner = parseFloat(e.get('_inner_cone') ?? '30') || 30;
        src.angle = Math.min(Math.PI / 2, (cone * Math.PI) / 180);
        src.penumbra = Math.max(0, Math.min(1, 1 - inner / cone));
      }
      out.push(src);
    } else if (cls === 'light_deferred') {
      const { color, brightness } = parseLight(e.get('diffuse'), '255 255 255 255');
      const radius = parseFloat(e.get('radius') ?? '256') || 256;
      const spot = e.get('light_type') === '1';
      const src: LightSource = {
        entity: e, kind: spot ? 'spot' : 'point', position: o, color,
        intensity: (brightness / 255) * radius * radius * 1.5, distance: radius, decay: parseFloat(e.get('power') ?? '2') || 2,
      };
      if (spot) {
        src.direction = new Vector3(1, 0, 0).applyQuaternion(sourceRotation(e.angles));
        const outer = parseFloat(e.get('spot_cone_outer') ?? '45') || 45, inner = parseFloat(e.get('spot_cone_inner') ?? '35') || 35;
        src.angle = (outer * Math.PI) / 180;
        src.penumbra = Math.max(0, Math.min(1, 1 - inner / outer));
      }
      out.push(src);
    }
  }
  return out;
}

/**
 * In-editor approximation of the compiled lighting: the sun from light_environment with shadows,
 * its ambient term, and point/spot lights. A fixed pool of lights is assigned to the sources nearest
 * the camera, so moving around never triggers shader recompiles.
 */
export class LightingPreview {
  enabled = false;
  shadows = true;
  private editor: Editor;
  private points: PointLight[] = [];
  private spots: SpotLight[] = [];
  private sources: LightSource[] = [];
  private lastAssign = 0;
  private savedExposure = 1;
  private savedHemi = 1;
  private savedSun = 1;
  stats = { lights: 0, active: 0 };

  constructor(editor: Editor) {
    this.editor = editor;
    const root = new Object3D();
    root.name = 'preview-lights';
    for (let i = 0; i < POINT_POOL; i++) {
      const l = new PointLight(0xffffff, 0, 1, 2);
      l.visible = false;
      this.points.push(l);
      root.add(l);
    }
    for (let i = 0; i < SPOT_POOL; i++) {
      const l = new SpotLight(0xffffff, 0, 1, 0.6, 0.3, 2);
      l.visible = false;
      this.spots.push(l);
      root.add(l, l.target);
    }
    editor.scene.add(root);
    const r = editor.renderer;
    r.shadowMap.type = PCFSoftShadowMap;
    const sun = editor.sun;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 1.5;
    for (const ev of ['document', 'change']) editor.on(ev, () => this.refresh());
    editor.on('frame', () => this.update());
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    const ed = this.editor;
    this.enabled = on;
    if (on) {
      this.savedExposure = ed.renderer.toneMappingExposure;
      this.savedHemi = ed.hemi.intensity;
      this.savedSun = ed.sun.intensity;
    } else {
      ed.renderer.toneMappingExposure = this.savedExposure;
      ed.hemi.intensity = this.savedHemi;
      ed.sun.intensity = this.savedSun;
      ed.scene.fog = null;
      ed.applyEnvironment();
    }
    for (const l of [...this.points, ...this.spots]) l.visible = on;
    this.applyShadows();
    this.refresh();
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    this.applyShadows();
  }

  private applyShadows(): void {
    const ed = this.editor;
    const on = this.enabled && this.shadows;
    ed.renderer.shadowMap.enabled = on;
    ed.sun.castShadow = on;
    ed.world.setShadows(on);
    ed.entities.setShadows(on);
    // Materials compile differently with shadows; flag them once.
    for (const m of ed.materials.all()) m.material.needsUpdate = true;
    this.fitShadowCamera();
  }

  /** Re-reads light entities and the environment. */
  refresh(): void {
    if (!this.enabled) return;
    const ed = this.editor;
    this.sources = lightSources(ed.doc.entities);
    this.stats.lights = this.sources.length;
    ed.applyEnvironment();
    // Preview: weaker sky fill (vrad ambient), the sun as the key light.
    const le = ed.doc.entities.find((e) => e.classname === 'light_environment');
    const amb = parseLight(le?.get('_ambient'), '150 160 180 120');
    ed.hemi.color.copy(amb.color);
    ed.hemi.groundColor.copy(amb.color).multiplyScalar(0.35);
    ed.hemi.intensity = Math.min(2.2, 0.35 + amb.brightness / 180);
    ed.sun.intensity = le ? Math.min(5, 1.2 + parseLight(le.get('_light')).brightness / 220) : 0;
    ed.renderer.toneMappingExposure = 1.15;
    ed.scene.fog = previewFog(ed.doc.entities);
    this.fitShadowCamera();
    this.lastAssign = 0;
  }

  /** Shadow camera covering the world, centred on the sun direction. */
  private fitShadowCamera(): void {
    const ed = this.editor;
    const box: Box3 = ed.world.bounds();
    if (box.isEmpty()) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.75 + 256;
    const dir = ed.sun.position.clone().normalize();
    ed.sun.target.position.copy(center);
    ed.sun.position.copy(center).addScaledVector(dir, r * 2);
    ed.sun.target.updateMatrixWorld();
    const cam = ed.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = r * 4;
    cam.updateProjectionMatrix();
  }

  private update(): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastAssign < 250) return;
    this.lastAssign = now;
    const ed = this.editor;
    const cam = ed.activeCamera.position;
    const focus = ed.view === 'top' ? new Vector3(ed.topView.center.x, ed.topView.center.y, 0) : cam;
    const byDist = (a: LightSource, b: LightSource) => a.position.distanceToSquared(focus) - b.position.distanceToSquared(focus);
    const pts = this.sources.filter((s) => s.kind === 'point').sort(byDist);
    const sps = this.sources.filter((s) => s.kind === 'spot').sort(byDist);
    this.points.forEach((l, i) => {
      const s = pts[i];
      l.intensity = s ? s.intensity : 0;
      if (!s) return;
      l.position.copy(s.position);
      l.color.copy(s.color);
      l.distance = s.distance;
      l.decay = s.decay;
    });
    this.spots.forEach((l, i) => {
      const s = sps[i];
      l.intensity = s ? s.intensity : 0;
      if (!s) return;
      l.position.copy(s.position);
      l.target.position.copy(s.position).addScaledVector(s.direction!, 256);
      l.target.updateMatrixWorld();
      l.color.copy(s.color);
      l.distance = s.distance;
      l.decay = s.decay;
      l.angle = s.angle!;
      l.penumbra = s.penumbra!;
    });
    this.stats.active = Math.min(pts.length, POINT_POOL) + Math.min(sps.length, SPOT_POOL);
  }
}
