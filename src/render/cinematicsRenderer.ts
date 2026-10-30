import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, LineBasicMaterial, LineSegments,
  Raycaster, Sprite, SpriteMaterial, Vector3, type Texture,
} from 'three';
import type { Editor } from '../editor.ts';
import type { MapEntity } from '../vmf/map.ts';
import { particleLook } from '../lw/particles.ts';
import { pathChains, cameraShots, PATH_CLASSES } from '../lw/cinematics.ts';

/** A soft round puff, tinted per effect by the sprite material. */
function puffTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

function labelTexture(text: string, color: string): { tex: Texture; aspect: number } {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = '600 26px system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 20;
  c.width = w;
  c.height = 40;
  g.font = '600 26px system-ui, sans-serif';
  g.fillStyle = 'rgba(20,22,26,0.78)';
  g.fillRect(0, 0, w, 40);
  g.fillStyle = color;
  g.fillText(text, 10, 29);
  return { tex: new CanvasTexture(c), aspect: w / 40 };
}

/**
 * Cinematic helpers in the viewport: unit and flight paths (path_track / path_corner chains, with drop
 * lines to the ground so heights read), camera shots (the camera's spot, a line to what it looks at and a
 * small frustum), and particle systems as labelled puffs sized and coloured by their effect.
 */
export class CinematicsRenderer {
  private editor: Editor;
  private lines: LineSegments;
  private sprites = new Group();
  private puff = puffTexture();
  private labels = new Map<string, { tex: Texture; aspect: number }>();
  visible = true;

  constructor(editor: Editor) {
    this.editor = editor;
    this.lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }));
    this.lines.renderOrder = 8;
    this.lines.frustumCulled = false;
    const g = new Group();
    g.name = 'cinematics';
    g.add(this.lines, this.sprites);
    editor.scene.add(g);
    for (const ev of ['document', 'change', 'selection', 'hidden']) editor.on(ev, () => this.update());
  }

  private label(text: string, color: string) {
    const key = `${color}|${text}`;
    let l = this.labels.get(key);
    if (!l) {
      l = labelTexture(text, color);
      this.labels.set(key, l);
    }
    return l;
  }

  update(): void {
    const ed = this.editor;
    const pos: number[] = [], col: number[] = [];
    const c = new Color();
    const line = (a: Vector3, b: Vector3, hex: number) => {
      c.setHex(hex);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const selected = (e: MapEntity) => ed.selection.entities.has(e);
    const shown = (e: MapEntity) => !ed.hidden.has(e) && !!e.origin;

    for (const chain of pathChains(ed.doc)) {
      const hot = chain.nodes.some(selected);
      const hex = hot ? 0xffd166 : 0x4fc3f7;
      for (let i = 0; i < chain.nodes.length; i++) {
        const n = chain.nodes[i];
        if (!shown(n)) continue;
        const p = n.origin!;
        const ground = this.groundBelow(p);
        if (ground !== null && p.z - ground > 24) line(p, new Vector3(p.x, p.y, ground), 0x2a6f8f);
        const next = chain.nodes[i + 1] ?? (chain.loop ? chain.nodes[0] : undefined);
        if (next && shown(next)) {
          const q = next.origin!;
          line(p, q, hex);
          // An arrow head halfway along shows the direction.
          const mid = p.clone().lerp(q, 0.5), dir = q.clone().sub(p).normalize(), side = new Vector3(-dir.y, dir.x, 0).normalize();
          if (side.lengthSq() > 0) {
            line(mid, mid.clone().addScaledVector(dir, -32).addScaledVector(side, 16), hex);
            line(mid, mid.clone().addScaledVector(dir, -32).addScaledVector(side, -16), hex);
          }
        }
      }
    }

    for (const shot of cameraShots(ed.doc)) {
      if (!shown(shot.camera)) continue;
      const hot = selected(shot.camera) || (shot.target ? selected(shot.target) : false);
      const hex = hot ? 0xffd166 : 0xff8a65;
      const p = shot.camera.origin!;
      const look = shot.lookAt;
      if (look) line(p, look, hex);
      // A small frustum pointing at the target (or along the entity's angles).
      const fwd = look ? look.clone().sub(p).normalize() : new Vector3(1, 0, 0);
      const up = Math.abs(fwd.z) > 0.95 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
      const right = new Vector3().crossVectors(fwd, up).normalize();
      const top = new Vector3().crossVectors(right, fwd).normalize();
      const d = 96, w = 64, hgt = 40;
      const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => p.clone().addScaledVector(fwd, d).addScaledVector(right, a * w).addScaledVector(top, b * hgt));
      for (let i = 0; i < 4; i++) {
        line(p, corners[i], hex);
        line(corners[i], corners[(i + 1) % 4], hex);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    this.lines.geometry.dispose();
    this.lines.geometry = geo;

    this.sprites.clear();
    for (const e of ed.doc.entities) {
      if (e.classname !== 'info_particle_system' || !shown(e)) continue;
      const name = e.get('effect_name') ?? '';
      const look = particleLook(name);
      const o = e.origin!;
      const puff = new Sprite(new SpriteMaterial({ map: this.puff, color: look.color, transparent: true, depthWrite: false, opacity: selected(e) ? 0.95 : 0.75, blending: look.kind === 'fire' || look.kind === 'sparks' || look.kind === 'explosion' || look.kind === 'glow' ? AdditiveBlending : undefined }));
      puff.scale.set(look.size, look.height, 1);
      puff.position.set(o.x, o.y, o.z + look.height / 2);
      puff.renderOrder = 6;
      const tag = this.label(`✦ ${name || '(no effect)'}${e.get('start_active') === '1' ? '' : ' · off'}`, `#${new Color(look.color).offsetHSL(0, 0, 0.15).getHexString()}`);
      // Labels keep the same size on screen at any distance.
      const text = new Sprite(new SpriteMaterial({ map: tag.tex, depthTest: false, transparent: true, sizeAttenuation: false }));
      const th = 0.028;
      text.scale.set(th * tag.aspect, th, 1);
      text.position.set(o.x, o.y, o.z + look.height + 12);
      text.renderOrder = 12;
      this.sprites.add(puff, text);
    }
    this.lines.visible = this.sprites.visible = this.visible;
  }

  /** The ground under a point (first brush hit straight down), for the node drop lines. */
  private groundBelow(p: Vector3): number | null {
    const hit = this.editor.world.raycast(new Raycaster(p.clone().setZ(p.z - 1), new Vector3(0, 0, -1)));
    return hit ? hit.point.z : null;
  }
}

export { PATH_CLASSES };
