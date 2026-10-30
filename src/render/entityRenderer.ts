import {
  BoxGeometry, Color, Euler, Group, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3,
  Raycaster, type Intersection, Box3,
} from 'three';
import type { MapEntity, VmfDocument } from '../vmf/map.ts';
import { loadModel, type SourceModel } from '../assets/mdl.ts';
import type { MaterialLibrary } from './materials.ts';
import { fgdClass } from '../assets/fgd.ts';

/** Source angles (pitch yaw roll, degrees) to a rotation: yaw about Z, then pitch about Y, then roll about X. */
export function sourceRotation(angles: Vector3): Quaternion {
  const d = Math.PI / 180;
  return new Quaternion().setFromEuler(new Euler(angles.z * d, angles.x * d, angles.y * d, 'ZYX'));
}

export function entityMatrix(e: MapEntity): Matrix4 {
  const scale = parseFloat(e.get('modelscale') ?? '1') || 1;
  return new Matrix4().compose(e.origin ?? new Vector3(), sourceRotation(e.angles), new Vector3(scale, scale, scale));
}

/** The model an entity shows: its `model` key, or the FGD studio() model of its class. */
export function entityModel(e: MapEntity): string | null {
  if (e.solids.length) return null;
  const m = e.get('model') ?? fgdClass(e.classname)?.studio;
  return m && m.toLowerCase().endsWith('.mdl') ? m.toLowerCase().replace(/\\/g, '/') : null;
}

/** Marker colour and size per entity class. */
export function entityStyle(cls: string): { color: number; size: number } {
  const c = cls.toLowerCase();
  if (c === 'info_start_wars') return { color: 0x3ddc84, size: 48 };
  if (c === 'info_player_wars' || c === 'info_player_start') return { color: 0x2fb36b, size: 32 };
  if (c === 'control_point' || c.startsWith('control_point')) return { color: 0xffa630, size: 48 };
  if (c.startsWith('scrap_marker')) return { color: 0xd8c040, size: 28 };
  if (c.startsWith('light')) return { color: 0xffe68a, size: 20 };
  if (c.startsWith('env_') || c === 'shadow_control' || c === 'color_correction' || c === 'postprocess_controller') return { color: 0x56c2e6, size: 20 };
  if (c.startsWith('logic_') || c.startsWith('math_') || c.startsWith('filter_')) return { color: 0xb0b0b0, size: 16 };
  if (c === 'infodecal' || c === 'info_overlay') return { color: 0xc77ddb, size: 8 };
  if (c.startsWith('npc_') || c.startsWith('unit_')) return { color: 0xe05a4f, size: 32 };
  return { color: 0xe066ff, size: 16 };
}

interface PropGroup {
  key: string;
  entities: MapEntity[];
  versions: number[];
  meshes: InstancedMesh[];
}

/**
 * Draws point entities: models as instanced meshes (one draw call per model part and skin),
 * everything else as colour-coded boxes in a single instanced mesh.
 */
export class EntityRenderer {
  readonly group = new Group();
  private materials: MaterialLibrary;
  private groups = new Map<string, PropGroup>();
  private models = new Map<string, SourceModel | null>();
  private loading = new Set<string>();
  private syncQueued = false;
  private markers: InstancedMesh | null = null;
  private markerEntities: MapEntity[] = [];
  private markerVersions: number[] = [];
  private doc: VmfDocument | null = null;
  /** Objects hidden in the editor; shared with the editor. */
  hidden: Set<object> = new Set();
  showMarkers = true;
  showProps = true;
  stats = { props: 0, markers: 0, models: 0 };

  constructor(materials: MaterialLibrary) {
    this.materials = materials;
    this.group.name = 'entities';
  }

  sync(doc: VmfDocument): void {
    this.doc = doc;
    const wanted = new Map<string, MapEntity[]>();
    const markers: MapEntity[] = [];
    for (const e of doc.entities) {
      if (e.solids.length || !e.origin || this.hidden.has(e)) continue;
      const model = entityModel(e);
      if (model && this.models.get(model) !== null) {
        const key = `${model}|${parseInt(e.get('skin') ?? '0', 10) || 0}`;
        if (!wanted.has(key)) wanted.set(key, []);
        wanted.get(key)!.push(e);
        if (!this.models.has(model) && !this.loading.has(model)) void this.fetchModel(model);
      } else {
        markers.push(e);
      }
    }
    for (const [key, g] of this.groups) {
      if (!wanted.has(key)) {
        this.disposeGroup(g);
        this.groups.delete(key);
      }
    }
    for (const [key, ents] of wanted) {
      const g = this.groups.get(key);
      const model = this.models.get(key.split('|')[0]);
      if (!model) continue;
      if (!g || g.entities.length !== ents.length || g.entities.some((e, i) => e !== ents[i])) {
        if (g) this.disposeGroup(g);
        this.groups.set(key, this.buildGroup(key, model, ents));
      } else if (g.entities.some((e, i) => e.version !== g.versions[i])) {
        this.updateMatrices(g);
      }
    }
    this.syncMarkers(markers);
    this.stats.props = [...this.groups.values()].reduce((n, g) => n + g.entities.length, 0);
    this.stats.markers = markers.length;
    this.stats.models = [...this.models.values()].filter(Boolean).length;
  }

  private async fetchModel(path: string): Promise<void> {
    this.loading.add(path);
    const m = await loadModel(path);
    this.loading.delete(path);
    this.models.set(path, m);
    // Re-sync once per burst of model arrivals rather than once per model.
    if (!this.syncQueued) {
      this.syncQueued = true;
      requestAnimationFrame(() => {
        this.syncQueued = false;
        if (this.doc) this.sync(this.doc);
      });
    }
  }

  private buildGroup(key: string, model: SourceModel, ents: MapEntity[]): PropGroup {
    const skin = parseInt(key.split('|')[1], 10) || 0;
    const skinRow = model.skins[skin] ?? model.skins[0] ?? [];
    const g: PropGroup = { key, entities: ents, versions: ents.map((e) => e.version), meshes: [] };
    for (const part of model.parts) {
      const mat = this.materials.getModel(skinRow[part.skinRef] ?? skinRow[0] ?? 'debug/debugempty');
      const mesh = new InstancedMesh(part.geometry, mat.material, ents.length);
      mesh.name = key;
      mesh.frustumCulled = false;
      g.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.updateMatrices(g);
    for (const m of g.meshes) m.visible = this.showProps;
    return g;
  }

  private updateMatrices(g: PropGroup): void {
    g.entities.forEach((e, i) => {
      const m = entityMatrix(e);
      for (const mesh of g.meshes) mesh.setMatrixAt(i, m);
      g.versions[i] = e.version;
    });
    for (const mesh of g.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  private disposeGroup(g: PropGroup): void {
    for (const m of g.meshes) {
      this.group.remove(m);
      m.dispose();
    }
  }

  private syncMarkers(ents: MapEntity[]): void {
    const same = this.markers && ents.length === this.markerEntities.length && ents.every((e, i) => e === this.markerEntities[i]);
    if (!same) {
      if (this.markers) { this.group.remove(this.markers); this.markers.dispose(); }
      this.markers = null;
      this.markerEntities = ents;
      this.markerVersions = ents.map(() => -1);
      if (ents.length) {
        const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: 0xffffff }), ents.length);
        mesh.name = 'markers';
        mesh.frustumCulled = false;
        this.markers = mesh;
        this.group.add(mesh);
      }
    }
    if (!this.markers) return;
    let changed = false;
    const col = new Color();
    ents.forEach((e, i) => {
      if (this.markerVersions[i] === e.version) return;
      const s = entityStyle(e.classname);
      const m = new Matrix4().compose(e.origin!.clone().add(new Vector3(0, 0, s.size / 2)), new Quaternion(), new Vector3(s.size, s.size, s.size));
      this.markers!.setMatrixAt(i, m);
      this.markers!.setColorAt(i, col.setHex(s.color));
      this.markerVersions[i] = e.version;
      changed = true;
    });
    if (changed) {
      this.markers.instanceMatrix.needsUpdate = true;
      if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
      this.markers.computeBoundingSphere();
    }
    this.markers.visible = this.showMarkers;
  }

  setVisibility(props: boolean, markers: boolean): void {
    this.showProps = props;
    this.showMarkers = markers;
    for (const g of this.groups.values()) for (const m of g.meshes) m.visible = props;
    if (this.markers) this.markers.visible = markers;
  }

  /** Nearest entity under the ray (models and markers). */
  raycast(ray: Raycaster): { entity: MapEntity; distance: number; point: Vector3 } | null {
    const targets: InstancedMesh[] = [];
    if (this.showProps) for (const g of this.groups.values()) targets.push(...g.meshes);
    if (this.markers && this.showMarkers) targets.push(this.markers);
    const hits: Intersection[] = ray.intersectObjects(targets, false);
    let best: { entity: MapEntity; distance: number; point: Vector3 } | null = null;
    for (const h of hits) {
      if (h.instanceId == null || (best && h.distance >= best.distance)) continue;
      const obj = h.object as InstancedMesh;
      const entity = obj === this.markers ? this.markerEntities[h.instanceId] : this.groups.get(obj.name)?.entities[h.instanceId];
      if (entity) best = { entity, distance: h.distance, point: h.point };
    }
    return best;
  }

  /** World-space bounds of an entity (model bounds or marker box). */
  entityBounds(e: MapEntity): Box3 {
    const model = entityModel(e);
    const m = model ? this.models.get(model) : null;
    if (m && !m.bounds.isEmpty()) return m.bounds.clone().applyMatrix4(entityMatrix(e));
    const s = entityStyle(e.classname).size;
    const o = e.origin ?? new Vector3();
    return new Box3(o.clone().add(new Vector3(-s / 2, -s / 2, 0)), o.clone().add(new Vector3(s / 2, s / 2, s)));
  }
}
