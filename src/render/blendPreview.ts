import {
  AmbientLight, BufferAttribute, BufferGeometry, DirectionalLight, Group, LineDashedMaterial, LineSegments, Mesh, MeshLambertMaterial,
  OrthographicCamera, Plane, Raycaster, Scene, Vector2, Vector3,
} from 'three';
import type { Editor } from '../editor.ts';
import { blendPreviewMaterial } from './materials.ts';
import { modelMeshes, renderToCanvas, whenReady } from './modelViews.ts';
import { loadModel } from '../assets/mdl.ts';
import { PREVIEW_W, vertexX, vertexY, type PreviewGrid } from '../edit/blendSample.ts';
import type { BlendDef } from '../edit/multiblend.ts';

/** The RTS camera's pitch in Lambda Wars (degrees down from the horizon). */
const PITCH = 65;
/** World units per texel: the texture scale terrain patches get. */
const TEXEL = 0.25;
const SOLDIER = 'models/combine_soldier.mdl';

export interface BlendPreview {
  /** Shows a blend definition (async: its textures load first). */
  setBlend(def: BlendDef): Promise<void>;
  /** Copies the grid's weights to the ground. */
  setWeights(grid: PreviewGrid): void;
  /** Dashed outline segments [x0, y0, x1, y1, …] on the ground. */
  setOutline(segments: number[]): void;
  setLighting(on: boolean): void;
  /** The ground point under a canvas pixel. */
  groundAt(px: number, py: number): Vector2 | null;
  draw(): void;
  dispose(): void;
}

/**
 * The material blender's preview: a flat patch of ground with the blend's real textures and shader, seen from the
 * game's camera angle, a 256-unit scale bar and a soldier. Drawn on demand with the editor's own renderer into a
 * 2D canvas (like model thumbnails), so the map's view and textures are shared and nothing in the map changes.
 */
export function blendPreview(editor: Editor, canvas: HTMLCanvasElement, grid: PreviewGrid): BlendPreview {
  const scene = new Scene();
  const ambient = new AmbientLight(0xffffff, 1);
  const sun = new DirectionalLight(0xffffff, 0);
  scene.add(ambient, sun, sun.target);

  const n = grid.cols * grid.rows;
  const geometry = new BufferGeometry();
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), normal = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = vertexX(grid, i), y = vertexY(grid, i);
    pos.set([x, y, 0], i * 3);
    uv.set([x / TEXEL, -y / TEXEL], i * 2);
    normal[i * 3 + 2] = 1;
  }
  const index: number[] = [];
  for (let r = 0; r < grid.rows - 1; r++) {
    for (let c = 0; c < grid.cols - 1; c++) {
      const i = r * grid.cols + c;
      index.push(i, i + 1, i + grid.cols + 1, i, i + grid.cols + 1, i + grid.cols);
    }
  }
  geometry.setIndex(index);
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  const blend = new BufferAttribute(new Float32Array(n * 4), 4);
  geometry.setAttribute('mblend', blend);
  const ground = new Mesh(geometry, new MeshLambertMaterial({ color: 0x3c4238 }));
  scene.add(ground);

  const outline = new LineSegments(new BufferGeometry(), new LineDashedMaterial({ color: 0xffffff, dashSize: 14, gapSize: 10, transparent: true, opacity: 0.85, depthTest: false }));
  outline.renderOrder = 2;
  scene.add(outline);

  // The game's camera angle, looking north; 1536 units across, the near edge at the bottom.
  const aspect = canvas.width / canvas.height;
  const camera = new OrthographicCamera(-PREVIEW_W / 2, PREVIEW_W / 2, PREVIEW_W / 2 / aspect, -PREVIEW_W / 2 / aspect, 1, 20000);
  const p = (PITCH * Math.PI) / 180;
  camera.up.set(0, 0, 1);
  camera.position.set(0, -Math.cos(p) * 8000, Math.sin(p) * 8000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const unitsPerPx = PREVIEW_W / canvas.width;
  /** Ground y at the bottom of the view, and the scale bar's place. */
  const nearY = -(PREVIEW_W / 2 / aspect) / Math.sin(p);
  const barX = -PREVIEW_W / 2 + 28 * unitsPerPx, barY = nearY + 44 * unitsPerPx / Math.sin(p);

  const soldier = new Group();
  soldier.position.set(barX + 256 + 80, barY + 40, 0);
  // Source models face +x; turn it towards the camera.
  soldier.rotation.z = -Math.PI / 2;
  scene.add(soldier);
  let disposed = false;
  void (async () => {
    const model = await loadModel(SOLDIER);
    if (!model?.parts.length || disposed) return;
    const m = modelMeshes(editor, model, 0);
    soldier.add(m.group);
    await whenReady(m.ready);
    if (!disposed) draw();
  })();

  const toCanvas = (x: number, y: number) => {
    const v = new Vector3(x, y, 0).project(camera);
    return [(v.x + 1) / 2 * canvas.width, (1 - v.y) / 2 * canvas.height];
  };

  function draw(): void {
    if (disposed) return;
    renderToCanvas(editor, scene, camera, canvas);
    // The 256-unit bar is drawn flat on top, so it reads at any lighting.
    const ctx = canvas.getContext('2d')!;
    const [ax, ay] = toCanvas(barX, barY), [bx] = toCanvas(barX + 256, barY);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, ay);
    ctx.moveTo(ax, ay - 6); ctx.lineTo(ax, ay + 6);
    ctx.moveTo(bx, ay - 6); ctx.lineTo(bx, ay + 6);
    ctx.stroke();
    ctx.font = '11px "IBM Plex Mono", Consolas, monospace';
    ctx.fillText('256 u', ax, ay - 10);
    const [sx, sy] = toCanvas(soldier.position.x + 40, soldier.position.y);
    ctx.font = '11px Barlow, "Segoe UI", sans-serif';
    ctx.fillText('soldier', sx, sy + 4);
    ctx.textAlign = 'right';
    ctx.font = '11px "IBM Plex Mono", Consolas, monospace';
    ctx.fillText(`preview patch · ${PREVIEW_W} u across`, canvas.width - 10, canvas.height - 10);
    ctx.restore();
  }

  let version = 0;
  return {
    async setBlend(def) {
      const v = ++version;
      const mat = await blendPreviewMaterial(def);
      if (!mat || v !== version || disposed) return mat?.dispose();
      (ground.material as MeshLambertMaterial).dispose();
      ground.material = mat;
      draw();
    },
    setWeights(g) {
      (blend.array as Float32Array).set(g.weights);
      blend.needsUpdate = true;
    },
    setOutline(segments) {
      const pts = new Float32Array((segments.length / 2) * 3);
      for (let k = 0; k < segments.length / 2; k++) pts.set([segments[k * 2], segments[k * 2 + 1], 1], k * 3);
      outline.geometry.dispose();
      outline.geometry = new BufferGeometry();
      outline.geometry.setAttribute('position', new BufferAttribute(pts, 3));
      outline.computeLineDistances();
    },
    setLighting(on) {
      // Lit like the map's sun and ambient (the viewport's lights), or flat to judge the textures themselves.
      if (on) {
        sun.color.copy(editor.sun.color);
        sun.intensity = editor.sun.intensity;
        sun.position.copy(editor.sun.position).normalize().multiplyScalar(5000);
        ambient.color.copy(editor.hemi.color);
        ambient.intensity = editor.hemi.intensity * 0.55;
      } else {
        sun.intensity = 0;
        ambient.color.set(0xffffff);
        ambient.intensity = Math.PI;
      }
    },
    groundAt(px, py) {
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2((px / canvas.clientWidth) * 2 - 1, -(py / canvas.clientHeight) * 2 + 1), camera);
      const hit = ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), new Vector3());
      return hit ? new Vector2(hit.x, hit.y) : null;
    },
    draw,
    dispose() {
      disposed = true;
      geometry.dispose();
      outline.geometry.dispose();
      (ground.material as MeshLambertMaterial).dispose();
    },
  };
}
