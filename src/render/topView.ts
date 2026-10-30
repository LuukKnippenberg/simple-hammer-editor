import { OrthographicCamera, Vector2, Vector3, Box3 } from 'three';
import { dragDelta, isTyping, lockForShiftDrag, unlockAfterDrag } from './cameraControls.ts';

/**
 * Orthographic top-down view (north up), like Hammer's 2D top view.
 * Right or middle drag pans, the wheel zooms towards the cursor, WASD / arrows pan.
 */
export class TopView {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, 80000);
  enabled = false;
  /** Half the visible height in world units. */
  zoom = 2048;
  readonly center = new Vector2();
  private dom: HTMLElement;
  private aspect = 1;
  private panning = false;
  private last = new Vector2();
  private keys = new Set<string>();
  onChange: () => void = () => {};

  constructor(dom: HTMLElement) {
    this.dom = dom;
    this.camera.up.set(0, 1, 0);
    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled || (e.button !== 1 && e.button !== 2)) return;
      this.panning = true;
      this.last.set(e.clientX, e.clientY);
      dom.setPointerCapture(e.pointerId);
      if (e.button === 2 && e.shiftKey) lockForShiftDrag(dom);
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.panning) return;
      const k = (2 * this.zoom) / dom.clientHeight;
      const d = dragDelta(dom, e, this.last);
      this.center.x -= d.x * k;
      this.center.y += d.y * k;
      this.apply();
    });
    window.addEventListener('pointerup', (e) => {
      if (this.panning && e.button === 2) unlockAfterDrag();
      this.panning = false;
    });
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const before = this.worldAt(e);
      this.zoom = Math.max(64, Math.min(40000, this.zoom * (e.deltaY > 0 ? 1.2 : 1 / 1.2)));
      this.apply();
      const after = this.worldAt(e);
      this.center.add(before.sub(after));
      this.apply();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!isTyping(e) && !e.ctrlKey && !e.metaKey) this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private worldAt(e: { clientX: number; clientY: number }): Vector2 {
    const r = this.dom.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    return new Vector2(this.center.x + nx * this.zoom * this.aspect, this.center.y + ny * this.zoom);
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.apply();
  }

  apply(): void {
    const c = this.camera;
    c.left = -this.zoom * this.aspect;
    c.right = this.zoom * this.aspect;
    c.top = this.zoom;
    c.bottom = -this.zoom;
    c.position.set(this.center.x, this.center.y, 40000);
    c.lookAt(this.center.x, this.center.y, 0);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    this.onChange();
  }

  frame(box: Box3): void {
    const c = box.getCenter(new Vector3());
    const s = box.getSize(new Vector3());
    this.center.set(c.x, c.y);
    this.zoom = Math.max(s.y / 2, s.x / 2 / this.aspect) * 1.1 + 64;
    this.apply();
  }

  /** Keyboard panning; returns true when the view moved. */
  update(dt: number): boolean {
    if (!this.enabled) return false;
    const k = this.keys;
    const d = new Vector2();
    if (k.has('KeyW') || k.has('ArrowUp')) d.y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) d.y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) d.x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) d.x -= 1;
    if (!d.lengthSq()) return false;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
    this.center.addScaledVector(d.normalize(), this.zoom * 1.2 * fast * dt);
    this.apply();
    return true;
  }
}
