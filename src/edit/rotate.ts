import { Euler, Quaternion, Vector3 } from 'three';
import { vecStr, parseVec, type MapEntity } from '../vmf/map.ts';

const D = Math.PI / 180;

/** Snaps an angle in degrees to steps of `step` degrees; a step of 0 (or less) leaves it free. */
export function snapAngle(degrees: number, step: number): number {
  return step > 0 ? Math.round(degrees / step) * step : degrees;
}

/** The angle (degrees, -180 to 180) a rotation turns about a unit axis. */
export function angleAbout(q: Quaternion, axis: Vector3): number {
  const a = 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w) / D;
  return a > 180 ? a - 360 : a <= -180 ? a + 360 : a;
}

const wrap = (deg: number) => {
  const r = Math.round(deg * 1000) / 1000;
  return ((r % 360) + 360) % 360 || 0;
};

/**
 * Turns a point entity `degrees` about `axis` (unit X, Y or Z) through `pivot`: its origin moves round the
 * pivot and its angles turn with it (yaw for Z, pitch and roll for the others). Overlays turn their basis.
 */
export function rotateEntity(e: MapEntity, pivot: Vector3, axis: Vector3, degrees: number): void {
  const q = new Quaternion().setFromAxisAngle(axis, degrees * D);
  if (e.origin) e.origin = e.origin.clone().sub(pivot).applyQuaternion(q).add(pivot);
  if (e.classname === 'info_overlay') {
    for (const k of ['BasisU', 'BasisV', 'BasisNormal']) {
      const v = e.get(k);
      if (v) e.set(k, vecStr(parseVec(v).applyQuaternion(q)));
    }
    const o = e.get('BasisOrigin');
    if (o) e.set('BasisOrigin', vecStr(parseVec(o).sub(pivot).applyQuaternion(q).add(pivot)));
    return;
  }
  const a = e.angles;
  if (Math.abs(axis.z) === 1 && !a.x && !a.z) {
    // Upright: only the yaw changes, kept exact.
    e.angles = new Vector3(0, wrap(a.y + degrees * axis.z), 0);
    return;
  }
  // Source angles are pitch yaw roll: yaw about Z, then pitch about Y, then roll about X.
  const cur = new Quaternion().setFromEuler(new Euler(a.z * D, a.x * D, a.y * D, 'ZYX'));
  const r = new Euler().setFromQuaternion(q.multiply(cur), 'ZYX');
  e.angles = new Vector3(wrap(r.y / D), wrap(r.z / D), wrap(r.x / D));
}
