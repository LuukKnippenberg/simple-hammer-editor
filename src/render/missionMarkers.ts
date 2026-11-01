import {
  Box3, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, DoubleSide, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial, Vector3, type Texture,
} from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import type { Locus } from '../lw/missionView.ts';

/** One stage as the markers draw it: its number in play order, a label and where its conditions happen. */
export interface MarkerStage {
  n: number;
  title: string;
  loci: { locus: Locus; defeat: boolean }[];
}

const CURRENT = 0xffa630;
const DEFEAT = 0xe05a4f;
const DIM = 0x8fa3b8;

/** World bounds of an entity: its brushes, else its model or marker box. */
export function entityBox(editor: Editor, e: MapEntity): Box3 {
  const box = new Box3();
  for (const s of e.solids) { const b = editor.world.solidBounds(s); if (b) box.union(b); }
  return box.isEmpty() ? editor.entities.entityBounds(e) : box;
}

/** What a locus covers in the world, or null when it has no place. */
export function locusBox(editor: Editor, l: Locus): Box3 | null {
  if (l.kind === 'area') return new Box3(new Vector3(l.area[0], l.area[1], l.z), new Vector3(l.area[2], l.area[3], l.z + 128));
  if (l.kind === 'entities') {
    const box = new Box3();
    for (const e of l.entities) box.union(entityBox(editor, e));
    return box.isEmpty() ? null : box;
  }
  return null;
}

/** A box worth framing the camera on: the loci, grown so a single unit still shows its surroundings. */
export function frameBoxFor(editor: Editor, loci: Locus[]): Box3 | null {
  const box = new Box3();
  for (const l of loci) { const b = locusBox(editor, l); if (b) box.union(b); }
  if (box.isEmpty()) return null;
  const size = box.getSize(new Vector3());
  const grow = new Vector3(Math.max(0, 900 - size.x) / 2, Math.max(0, 900 - size.y) / 2, 0);
  return box.expandByVector(grow);
}

function labelTexture(text: string, color: string, big: boolean): { tex: Texture; aspect: number } {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = `600 ${big ? 30 : 24}px system-ui, sans-serif`;
  const hgt = big ? 46 : 36;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 22;
  c.width = w;
  c.height = hgt;
  g.font = font;
  g.fillStyle = big ? 'rgba(40,28,10,0.88)' : 'rgba(20,22,26,0.72)';
  g.fillRect(0, 0, w, hgt);
  if (big) { g.strokeStyle = color; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, hgt - 3); }
  g.fillStyle = color;
  g.fillText(text, 11, big ? 32 : 26);
  return { tex: new CanvasTexture(c), aspect: w / hgt };
}

/**
 * Draws where the mission's objectives happen: reach areas as boxes on the ground, targets as rings with a
 * post, a numbered label per stage and a line through the stages in play order. The current stage is drawn
 * bright (a filled area, a label per target), the others dimmed.
 */
export class MissionMarkers {
  private editor: Editor;
  private group = new Group();
  private bright: LineSegments;
  private dim: LineSegments;
  private fills = new Group();
  private sprites = new Group();
  private labels = new Map<string, { tex: Texture; aspect: number }>();

  constructor(editor: Editor) {
    this.editor = editor;
    const lines = (opacity: number) => {
      const l = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity }));
      l.renderOrder = 9;
      l.frustumCulled = false;
      return l;
    };
    this.bright = lines(0.95);
    this.dim = lines(0.4);
    this.group.name = 'mission-markers';
    this.group.add(this.dim, this.bright, this.fills, this.sprites);
    this.group.visible = false;
    editor.scene.add(this.group);
  }

  hide(): void {
    this.group.visible = false;
  }

  /** Redraws for these stages; `current` is the n of the stage being looked at. */
  show(stages: MarkerStage[], current: number): void {
    const ed = this.editor;
    const out = { bright: { pos: [] as number[], col: [] as number[] }, dim: { pos: [] as number[], col: [] as number[] } };
    const c = new Color();
    const seg = (to: 'bright' | 'dim', a: Vector3, b: Vector3, hex: number) => {
      c.setHex(hex);
      out[to].pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      out[to].col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const ring = (to: 'bright' | 'dim', o: Vector3, r: number, hex: number) => {
      for (let i = 0; i < 32; i++) {
        const a0 = (i / 32) * Math.PI * 2, a1 = ((i + 1) / 32) * Math.PI * 2;
        seg(to, new Vector3(o.x + Math.cos(a0) * r, o.y + Math.sin(a0) * r, o.z), new Vector3(o.x + Math.cos(a1) * r, o.y + Math.sin(a1) * r, o.z), hex);
      }
    };
    for (const f of this.fills.children as Mesh[]) { f.geometry.dispose(); (f.material as MeshBasicMaterial).dispose(); }
    for (const s of this.sprites.children as Sprite[]) s.material.dispose();
    this.fills.clear();
    this.sprites.clear();
    if (this.labels.size > 300) this.labels.clear();

    const anchors: { n: number; at: Vector3 }[] = [];
    for (const s of stages) {
      const on = s.n === current;
      const to = on ? 'bright' : 'dim';
      let anchor: Vector3 | null = null;
      for (const { locus, defeat } of s.loci) {
        const hex = on ? (defeat ? DEFEAT : CURRENT) : DIM;
        if (locus.kind === 'area') {
          const [x0, y0, x1, y1] = locus.area;
          const z = locus.z + 8, top = z + (on ? 96 : 0);
          const corners = [new Vector3(x0, y0, z), new Vector3(x1, y0, z), new Vector3(x1, y1, z), new Vector3(x0, y1, z)];
          for (let i = 0; i < 4; i++) {
            const a = corners[i], b = corners[(i + 1) % 4];
            seg(to, a, b, hex);
            if (on) {
              seg(to, a, a.clone().setZ(top), hex);
              seg(to, a.clone().setZ(top), b.clone().setZ(top), hex);
            }
          }
          if (on) {
            const fill = new Mesh(new PlaneGeometry(x1 - x0, y1 - y0), new MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide }));
            fill.position.set((x0 + x1) / 2, (y0 + y1) / 2, z - 2);
            fill.renderOrder = 8;
            this.fills.add(fill);
          }
          anchor ??= new Vector3((x0 + x1) / 2, (y0 + y1) / 2, top);
        } else if (locus.kind === 'entities') {
          const centers: Vector3[] = [];
          for (const e of locus.entities) {
            const b = entityBox(ed, e);
            const ctr = b.getCenter(new Vector3());
            const r = Math.max(56, Math.min(240, Math.max(b.max.x - b.min.x, b.max.y - b.min.y) * 0.6));
            const foot = new Vector3(ctr.x, ctr.y, b.min.z + 4);
            ring(to, foot, r, hex);
            if (on) {
              ring(to, foot, r + 12, hex);
              const disc = new Mesh(new CircleGeometry(r + 12, 32), new MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false, side: DoubleSide }));
              disc.position.copy(foot);
              disc.renderOrder = 8;
              this.fills.add(disc);
              const head = new Vector3(ctr.x, ctr.y, b.max.z + 80);
              seg(to, new Vector3(ctr.x, ctr.y, b.max.z + 8), head, hex);
              seg(to, head, head.clone().add(new Vector3(-14, 0, 20)), hex);
              seg(to, head, head.clone().add(new Vector3(14, 0, 20)), hex);
            }
            centers.push(new Vector3(ctr.x, ctr.y, b.max.z + 96));
          }
          if (on && centers.length) {
            const tag = `${locus.base ? '⌂ ' : ''}${locus.name}${locus.entities.length > 1 ? ` ×${locus.entities.length}` : ''}`;
            this.label(tag, defeat ? '#ff8f86' : '#ffd28a', false, centers[0].clone().add(new Vector3(0, 0, 40)), 1);
          }
          anchor ??= centers.reduce((a, b) => a.add(b), new Vector3()).divideScalar(centers.length || 1);
        }
      }
      if (anchor) {
        anchors.push({ n: s.n, at: anchor });
        this.label(`${s.n} · ${s.title || '(untitled)'}`, on ? '#ffd28a' : '#c2ccd6', on, anchor.clone().add(new Vector3(0, 0, on ? 150 : 70)), on ? 1 : 0.7);
      }
    }
    // The order: a line from each stage's place to the next one's, with an arrowhead halfway.
    anchors.sort((a, b) => a.n - b.n);
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1].at, b = anchors[i].at;
      if (a.distanceTo(b) < 1) continue;
      const near = anchors[i].n === current || anchors[i - 1].n === current;
      const hex = near ? 0xffe0a8 : DIM;
      seg(near ? 'bright' : 'dim', a, b, hex);
      const mid = a.clone().lerp(b, 0.5), dir = b.clone().sub(a).normalize(), side = new Vector3(-dir.y, dir.x, 0).normalize();
      seg(near ? 'bright' : 'dim', mid, mid.clone().addScaledVector(dir, -40).addScaledVector(side, 20), hex);
      seg(near ? 'bright' : 'dim', mid, mid.clone().addScaledVector(dir, -40).addScaledVector(side, -20), hex);
    }
    for (const k of ['bright', 'dim'] as const) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(out[k].pos), 3));
      g.setAttribute('color', new BufferAttribute(new Float32Array(out[k].col), 3));
      this[k].geometry.dispose();
      this[k].geometry = g;
    }
    this.group.visible = true;
  }

  /** A label that keeps its size on screen. */
  private label(text: string, color: string, big: boolean, at: Vector3, opacity: number): void {
    const key = `${text}|${color}|${big}`;
    let l = this.labels.get(key);
    if (!l) this.labels.set(key, (l = labelTexture(text, color, big)));
    const s = new Sprite(new SpriteMaterial({ map: l.tex, depthTest: false, transparent: true, opacity, sizeAttenuation: false }));
    const th = big ? 0.036 : 0.026;
    s.scale.set(th * l.aspect, th, 1);
    s.position.copy(at);
    s.renderOrder = big ? 13 : 12;
    this.sprites.add(s);
  }
}
