import { Vector3 } from 'three';
import { KVNode, parseKeyValues, writeKeyValues } from './keyvalues.ts';

export interface TexAxis {
  axis: Vector3;
  shift: number;
  scale: number;
}

const num = (s: string | undefined, d = 0) => {
  const v = s === undefined ? NaN : parseFloat(s);
  return Number.isFinite(v) ? v : d;
};

/** Formats a number the way Hammer does: integers plain, otherwise up to 6 significant decimals. */
export function fmt(n: number): string {
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n) || 0);
  return String(parseFloat(n.toFixed(6)));
}

export function parseVec(s: string | undefined): Vector3 {
  const p = (s ?? '').replace(/[[\]()]/g, ' ').trim().split(/\s+/).map(Number);
  return new Vector3(p[0] || 0, p[1] || 0, p[2] || 0);
}

export function vecStr(v: Vector3): string {
  return `${fmt(v.x)} ${fmt(v.y)} ${fmt(v.z)}`;
}

function parseTexAxis(s: string | undefined): TexAxis {
  // "[ax ay az shift] scale"
  const m = /\[\s*([^\]]+)\]\s*([-\d.eE+]+)?/.exec(s ?? '');
  const p = m ? m[1].trim().split(/\s+/).map(Number) : [1, 0, 0, 0];
  return { axis: new Vector3(p[0], p[1], p[2]), shift: p[3] || 0, scale: m && m[2] ? parseFloat(m[2]) || 0.25 : 0.25 };
}

function texAxisStr(t: TexAxis): string {
  return `[${fmt(t.axis.x)} ${fmt(t.axis.y)} ${fmt(t.axis.z)} ${fmt(t.shift)}] ${fmt(t.scale)}`;
}

/** One brush face. Mirrors its `side` node; edits go through the setters so the node stays the source of truth. */
export class MapSide {
  readonly node: KVNode;
  plane: [Vector3, Vector3, Vector3];
  material: string;
  uaxis: TexAxis;
  vaxis: TexAxis;

  constructor(node: KVNode) {
    this.node = node;
    const pts = (node.get('plane') ?? '').match(/\(([^)]+)\)/g) ?? [];
    this.plane = [parseVec(pts[0]), parseVec(pts[1]), parseVec(pts[2])];
    this.material = node.get('material') ?? 'TOOLS/TOOLSNODRAW';
    this.uaxis = parseTexAxis(node.get('uaxis'));
    this.vaxis = parseTexAxis(node.get('vaxis'));
  }

  get id(): number {
    return num(this.node.get('id'));
  }
  get dispinfo(): KVNode | undefined {
    return this.node.child('dispinfo');
  }

  /** Writes the cached plane/material/axes back into the node. */
  commit(): void {
    this.node.set('plane', this.plane.map((p) => `(${vecStr(p)})`).join(' '));
    this.node.set('material', this.material);
    this.node.set('uaxis', texAxisStr(this.uaxis));
    this.node.set('vaxis', texAxisStr(this.vaxis));
  }
}

export class MapSolid {
  readonly node: KVNode;
  sides: MapSide[];
  /** Owning brush entity, or null for world geometry. */
  entity: MapEntity | null;
  /** Bumped on every geometry or material change, so renderers can rebuild lazily. */
  version = 0;

  constructor(node: KVNode, entity: MapEntity | null) {
    this.node = node;
    this.entity = entity;
    this.sides = node.childrenNamed('side').map((s) => new MapSide(s));
  }

  get id(): number {
    return num(this.node.get('id'));
  }
  get isDisplacement(): boolean {
    return this.sides.some((s) => s.dispinfo);
  }
  commit(): void {
    for (const s of this.sides) s.commit();
    this.version++;
  }
}

export class MapEntity {
  readonly node: KVNode;
  solids: MapSolid[] = [];
  version = 0;

  constructor(node: KVNode) {
    this.node = node;
    const collect = (n: KVNode) => {
      for (const c of n.children) {
        const name = c.name.toLowerCase();
        if (name === 'solid') this.solids.push(new MapSolid(c, this));
        else if (name === 'hidden') collect(c);
      }
    };
    collect(node);
  }

  get id(): number {
    return num(this.node.get('id'));
  }
  get classname(): string {
    return this.node.get('classname') ?? '';
  }
  get origin(): Vector3 | null {
    const o = this.node.get('origin');
    return o === undefined ? null : parseVec(o);
  }
  set origin(v: Vector3 | null) {
    if (v) this.node.set('origin', vecStr(v));
    else this.node.delete('origin');
    this.version++;
  }
  get angles(): Vector3 {
    return parseVec(this.node.get('angles'));
  }
  set angles(v: Vector3) {
    this.node.set('angles', vecStr(v));
    this.version++;
  }
  get(key: string): string | undefined {
    return this.node.get(key);
  }
  set(key: string, value: string): void {
    this.node.set(key, value);
    this.version++;
  }
}

/** A parsed VMF. The KeyValues tree is kept whole, so everything the editor does not understand survives a save. */
export class VmfDocument {
  roots: KVNode[];
  world: KVNode;
  worldEntity: MapEntity;
  entities: MapEntity[];
  eol: string;
  private maxId = 0;

  constructor(roots: KVNode[], eol = '\r\n') {
    this.roots = roots;
    this.eol = eol;
    let world = roots.find((r) => r.name.toLowerCase() === 'world');
    if (!world) {
      world = new KVNode('world');
      world.props.push(['id', '1'], ['mapversion', '1'], ['classname', 'worldspawn'], ['skyname', 'sky_day01_01']);
      roots.push(world);
    }
    this.world = world;
    this.worldEntity = new MapEntity(world);
    for (const s of this.worldEntity.solids) s.entity = null;
    const ents: MapEntity[] = [];
    for (const r of roots) {
      const name = r.name.toLowerCase();
      if (name === 'entity') ents.push(new MapEntity(r));
      else if (name === 'hidden') for (const c of r.childrenNamed('entity')) ents.push(new MapEntity(c));
    }
    this.entities = ents;
    this.scanIds(roots);
  }

  static parse(text: string): VmfDocument {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return new VmfDocument(parseKeyValues(text), eol);
  }

  static empty(): VmfDocument {
    const doc = VmfDocument.parse(
      'versioninfo\n{\n"editorversion" "400"\n"editorbuild" "5032"\n"mapversion" "1"\n"formatversion" "100"\n"prefab" "0"\n}\n' +
        'world\n{\n"id" "1"\n"mapversion" "1"\n"classname" "worldspawn"\n"skyname" "sky_day01_01"\n"maxpropscreenwidth" "-1"\n"detailvbsp" "detail.vbsp"\n"detailmaterial" "detail/detailsprites"\n}\n',
    );
    doc.eol = '\r\n';
    return doc;
  }

  private scanIds(nodes: KVNode[]): void {
    for (const n of nodes) {
      const id = num(n.get('id'), 0);
      if (id > this.maxId) this.maxId = id;
      this.scanIds(n.children);
    }
  }

  nextId(): number {
    return ++this.maxId;
  }

  /** Every brush in the map, world and entity brushes alike. */
  allSolids(): MapSolid[] {
    const out = [...this.worldEntity.solids];
    for (const e of this.entities) out.push(...e.solids);
    return out;
  }

  serialize(): string {
    return writeKeyValues(this.roots, this.eol);
  }
}
