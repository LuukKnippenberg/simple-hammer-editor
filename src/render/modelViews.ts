import {
  Box3, Color, DirectionalLight, Group, HemisphereLight, Mesh, PerspectiveCamera, Scene, Sphere, Vector3, WebGLRenderTarget, type Camera,
} from 'three';
import type { Editor } from '../editor.ts';
import { loadModel, type SourceModel } from '../assets/mdl.ts';
import { cachedThumb, canvasPng, taskQueue, type ThumbOptions } from '../assets/thumbCache.ts';

/** Yaw and pitch (degrees) and zoom (1 = fits the frame) of a model view. */
export interface ModelView {
  yaw: number;
  pitch: number;
  zoom: number;
}
export const DEFAULT_VIEW: ModelView = { yaw: -55, pitch: 22, zoom: 1 };

const scene = new Scene();
scene.add(new HemisphereLight(0xdde6f2, 0x6a6258, 1.9));
const sun = new DirectionalLight(0xffffff, 2.1);
sun.position.set(0.6, -0.8, 1.3);
scene.add(sun);
const camera = new PerspectiveCamera(28, 1, 1, 100000);
camera.up.set(0, 0, 1);

/** Linear to sRGB, per byte: render targets get linear colour, the screen gets sRGB. */
const SRGB = new Uint8ClampedArray(256).map((_, i) => {
  const c = i / 255;
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
});

/** A model's meshes with the editor's model materials; `ready` once their textures loaded. */
export function modelMeshes(editor: Editor, model: SourceModel, skin: number): { group: Group; ready: () => boolean } {
  const row = model.skins[skin] ?? model.skins[0] ?? [];
  const group = new Group();
  const infos = model.parts.map((part) => {
    const info = editor.materials.getModel(row[part.skinRef] ?? row[0] ?? 'debug/debugempty');
    group.add(new Mesh(part.geometry, info.material));
    return info;
  });
  return { group, ready: () => infos.every((i) => i.loaded) };
}

/** Renders a model with the editor's own WebGL renderer into `out` (a 2D canvas), transparent around it. */
function draw(editor: Editor, model: SourceModel, group: Group, view: ModelView, out: HTMLCanvasElement): void {
  const box = model.bounds.isEmpty() ? new Box3(new Vector3(-16, -16, 0), new Vector3(16, 16, 32)) : model.bounds;
  const sphere = box.getBoundingSphere(new Sphere());
  const y = (view.yaw * Math.PI) / 180, p = (view.pitch * Math.PI) / 180;
  const dist = (sphere.radius / Math.sin(((camera.fov / 2) * Math.PI) / 180)) * view.zoom * 1.05;
  camera.aspect = out.width / out.height;
  camera.position.copy(sphere.center).add(new Vector3(Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)).multiplyScalar(dist));
  camera.near = Math.max(0.5, dist - sphere.radius * 2);
  camera.far = dist + sphere.radius * 2;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
  scene.add(group);
  try {
    // Twice the size, scaled down: cheap antialiasing.
    renderToCanvas(editor, scene, camera, out, 2);
  } finally {
    scene.remove(group);
  }
}

/**
 * Draws `scene` with the editor's own WebGL renderer (no second context, textures shared) into `out`, a 2D canvas,
 * at `scale` times its size scaled down. Clears to transparent.
 */
export function renderToCanvas(editor: Editor, scene: Scene, cam: Camera, out: HTMLCanvasElement, scale = 1): void {
  const w = out.width, h = out.height;
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const r = editor.renderer;
  const rt = new WebGLRenderTarget(W, H);
  const prevTarget = r.getRenderTarget(), prevColor = r.getClearColor(new Color()), prevAlpha = r.getClearAlpha();
  const pixels = new Uint8Array(W * H * 4);
  try {
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    r.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
  } finally {
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    rt.dispose();
  }
  // Flip rows (GL reads bottom-up) and convert to sRGB.
  const img = new ImageData(W, H);
  for (let row = 0; row < H; row++) {
    const src = (H - 1 - row) * W * 4, dst = row * W * 4;
    for (let i = 0; i < W * 4; i += 4) {
      img.data[dst + i] = SRGB[pixels[src + i]];
      img.data[dst + i + 1] = SRGB[pixels[src + i + 1]];
      img.data[dst + i + 2] = SRGB[pixels[src + i + 2]];
      img.data[dst + i + 3] = pixels[src + i + 3];
    }
  }
  const ctx = out.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (W === w && H === h) return ctx.putImageData(img, 0, 0);
  const big = document.createElement('canvas');
  big.width = W;
  big.height = H;
  big.getContext('2d')!.putImageData(img, 0, 0);
  ctx.drawImage(big, 0, 0, w, h);
}

/** Waits until `ready()` (or `ms` passed). */
export async function whenReady(ready: () => boolean, ms = 4000): Promise<void> {
  const until = performance.now() + ms;
  while (!ready() && performance.now() < until) await new Promise((r) => setTimeout(r, 40));
}

/** Loading a model and its materials: a few at once (mostly waiting on the network and texture decodes). */
const loads = taskQueue(3);
/** Drawing: one at a time on the shared renderer, a few milliseconds per frame. */
const draws = taskQueue(1);
const FRAME_BUDGET_MS = 8;
let budgetEnd = 0;

/** Resolves at once while this frame's thumbnail budget lasts, else just after the next frame (the view draws first). */
async function frameTurn(): Promise<void> {
  if (performance.now() < budgetEnd) return;
  await new Promise<void>((r) => (document.hidden ? setTimeout(r, 0) : requestAnimationFrame(() => setTimeout(r, 0))));
  budgetEnd = performance.now() + FRAME_BUDGET_MS;
}

/**
 * A thumbnail (object URL) of a model and skin, drawn by the editor's own MDL loader and kept across reloads.
 * `opts.priority` moves it up the queue; aborting `opts.signal` resolves null and drops it when nobody else waits.
 */
export function modelThumbnail(editor: Editor, path: string, skin = 0, size = 112, opts: ThumbOptions = {}): Promise<string | null> {
  const key = `model|${path.toLowerCase()}|${skin}|${size}`;
  return cachedThumb(key, async (priority, signal) => {
    const loaded = await loads.run(async () => {
      const model = await loadModel(path);
      if (!model || !model.parts.length) return null;
      const m = modelMeshes(editor, model, skin);
      await whenReady(m.ready);
      return { model, group: m.group };
    }, priority, signal);
    if (!loaded) return null;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const drawn = await draws.run(async () => {
      await frameTurn();
      draw(editor, loaded.model, loaded.group, DEFAULT_VIEW, c);
      return true;
    }, priority, signal);
    const blob = drawn && (await canvasPng(c));
    return blob ? { blob, width: size, height: size } : null;
  }, opts).then((t) => t?.url ?? null);
}

/**
 * A live view of a model in `canvas`: drag to orbit, scroll to zoom. Returns a function that switches
 * the skin; resolves false when the model can't be loaded.
 */
export async function modelPreview(editor: Editor, canvas: HTMLCanvasElement, path: string, skin = 0): Promise<((skin: number) => void) | null> {
  const model = await loadModel(path);
  if (!model || !model.parts.length) return null;
  const view = { ...DEFAULT_VIEW };
  let m = modelMeshes(editor, model, skin);
  const redraw = () => draw(editor, model, m.group, view, canvas);
  const setSkin = async (s: number) => {
    m = modelMeshes(editor, model, s);
    await whenReady(m.ready);
    redraw();
  };
  await setSkin(skin);
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw -= (e.clientX - drag.x) * 0.6;
    view.pitch = Math.max(-80, Math.min(85, view.pitch + (e.clientY - drag.y) * 0.4));
    drag = { x: e.clientX, y: e.clientY };
    redraw();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.zoom = Math.max(0.35, Math.min(3, view.zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
    redraw();
  }, { passive: false });
  return (s) => void setSkin(s);
}
