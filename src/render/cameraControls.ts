import { PerspectiveCamera, Vector3, Raycaster, Vector2, Box3 } from 'three';

/**
 * Editor camera for a Z-up world.
 * - Right mouse drag: look around. WASD flies, E/Space up, Q down, Shift is faster.
 * - Middle mouse drag: pan. Alt + left drag: orbit around the point under the cursor.
 * - Wheel: dolly towards the cursor.
 */
export class CameraControls {
  readonly camera: PerspectiveCamera;
  private dom: HTMLElement;
  enabled = true;
  yaw = 0;
  pitch = -0.6;
  speed = 900;
  private keys = new Set<string>();
  private mode: 'none' | 'look' | 'pan' | 'orbit' = 'none';
  private last = new Vector2();
  private orbitPivot = new Vector3();
  private orbitDist = 0;
  /** Returns the world point under a screen position, used for dolly and orbit targets. */
  pick: (ndc: Vector2) => Vector3 | null = () => null;
  onChange: () => void = () => {};

  constructor(camera: PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;
    camera.up.set(0, 0, 1);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey) return;
      this.keys.add(e.code);
      // Shift pressed during a look drag (to fly faster) would open Firefox's menu on release.
      if (e.key === 'Shift' && this.mode === 'look') lockForShiftDrag(this.dom);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.apply();
  }

  get isNavigating(): boolean {
    return this.mode !== 'none';
  }

  forward(): Vector3 {
    const cp = Math.cos(this.pitch);
    return new Vector3(cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), Math.sin(this.pitch));
  }

  apply(): void {
    const c = this.camera;
    c.lookAt(c.position.clone().add(this.forward()));
    c.updateMatrixWorld();
    this.onChange();
  }

  lookAt(target: Vector3): void {
    const d = target.clone().sub(this.camera.position);
    this.yaw = Math.atan2(d.y, d.x);
    this.pitch = Math.atan2(d.z, Math.hypot(d.x, d.y));
    this.apply();
  }

  /** Frames a bounding box from a three-quarter view. */
  frame(box: Box3): void {
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const r = Math.max(size.x, size.y, size.z * 2) * 0.6 + 64;
    this.camera.position.set(center.x - r * 0.75, center.y - r * 0.75, center.z + r * 0.8);
    this.lookAt(center);
  }

  private ndc(e: PointerEvent | WheelEvent): Vector2 {
    const r = this.dom.getBoundingClientRect();
    return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private onDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    // The preventDefault below keeps focus where it was, so a form field used last would keep the keyboard
    // and the fly keys would be ignored until a left click.
    const focused = document.activeElement as HTMLElement | null;
    if (focused && isTextField(focused)) focused.blur();
    if (e.button === 2) this.mode = 'look';
    else if (e.button === 1) this.mode = 'pan';
    else if (e.button === 0 && e.altKey) {
      this.mode = 'orbit';
      const hit = this.pick(this.ndc(e));
      this.orbitPivot.copy(hit ?? this.camera.position.clone().addScaledVector(this.forward(), 1024));
      this.orbitDist = this.camera.position.distanceTo(this.orbitPivot);
    } else return;
    e.preventDefault();
    this.last.set(e.clientX, e.clientY);
    this.dom.setPointerCapture(e.pointerId);
    if (this.mode === 'look' && e.shiftKey) lockForShiftDrag(this.dom);
  };

  private onMove = (e: PointerEvent) => {
    if (this.mode === 'none') return;
    const { x: dx, y: dy } = dragDelta(this.dom, e, this.last);
    if (this.mode === 'look' || this.mode === 'orbit') {
      this.yaw -= dx * 0.004;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * 0.004));
      if (this.mode === 'orbit') {
        this.camera.position.copy(this.orbitPivot).addScaledVector(this.forward(), -this.orbitDist);
      }
      this.apply();
    } else if (this.mode === 'pan') {
      const scale = Math.max(1, this.camera.position.z) * 0.002 + 0.6;
      const right = new Vector3().crossVectors(this.forward(), this.camera.up).normalize();
      const up = new Vector3().crossVectors(right, this.forward()).normalize();
      this.camera.position.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
      this.apply();
    }
  };

  private onUp = (e: PointerEvent) => {
    if (this.mode === 'look' && e.button === 2) unlockAfterDrag();
    if (this.mode !== 'none' && [0, 1, 2].includes(e.button)) this.mode = 'none';
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    const ndc = this.ndc(e);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = this.pick(ndc);
    const dist = hit ? hit.distanceTo(this.camera.position) : 1500;
    const step = Math.sign(-e.deltaY) * Math.max(16, dist * 0.18);
    this.camera.position.addScaledVector(ray.ray.direction, hit ? Math.min(step, dist - 16) : step);
    this.apply();
  };

  /** Advances keyboard fly movement; returns true if the camera moved. */
  update(dt: number): boolean {
    if (!this.enabled) return false;
    const k = this.keys;
    const f = this.forward();
    const right = new Vector3().crossVectors(f, this.camera.up).normalize();
    const move = new Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(f);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(f);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
    if (k.has('KeyE') || k.has('Space')) move.z += 1;
    if (k.has('KeyQ')) move.z -= 1;
    if (move.lengthSq() === 0) return false;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
    this.camera.position.addScaledVector(move.normalize(), this.speed * fast * dt);
    this.apply();
    return true;
  }
}

let unlockTimer = 0;

/**
 * Locks the pointer during a Shift + right drag. Firefox opens its own context menu on Shift + right
 * click and ignores preventDefault, but it never opens one while the pointer is locked.
 */
export function lockForShiftDrag(dom: HTMLElement): void {
  clearTimeout(unlockTimer);
  if (document.pointerLockElement === dom) return;
  try {
    Promise.resolve(dom.requestPointerLock()).catch(() => {});
  } catch {
    // Without the lock the drag still works; Firefox just shows its menu.
  }
}

/** Releases the lock shortly after the button is released, so the contextmenu event that follows still sees it. */
export function unlockAfterDrag(): void {
  clearTimeout(unlockTimer);
  unlockTimer = window.setTimeout(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, 150);
}

/** Mouse movement since the last event; a locked pointer reports movement instead of a position. */
export function dragDelta(dom: HTMLElement, e: PointerEvent, last: Vector2): Vector2 {
  const d = document.pointerLockElement === dom
    ? new Vector2(e.movementX, e.movementY)
    : new Vector2(e.clientX - last.x, e.clientY - last.y);
  last.set(e.clientX, e.clientY);
  return d;
}

export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && isTextField(t);
}

/** Form fields that take keys (the fly keys are ignored while one has focus). */
export function isTextField(t: HTMLElement): boolean {
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}
