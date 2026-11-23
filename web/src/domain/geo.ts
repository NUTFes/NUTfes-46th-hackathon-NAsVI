import type { Place } from '../types';

export const ORIGIN = { lat: 37.4252, lng: 138.7788 };
const MY = 110540;
const MX = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);

/** 原点からの平面座標。東が +x、北が +y、単位はメートル。 */
export function toXY(lat: number, lng: number): [number, number] {
  return [(lng - ORIGIN.lng) * MX, (lat - ORIGIN.lat) * MY];
}

export function fromXY(x: number, y: number): { lat: number; lng: number } {
  return { lat: ORIGIN.lat + y / MY, lng: ORIGIN.lng + x / MX };
}

/** 会場の平面座標での直線距離。単位はメートル(D-003)。 */
export function distanceM(a: Place['location'], b: Place['location']): number {
  const [ax, ay] = toXY(a.lat, a.lng);
  const [bx, by] = toXY(b.lat, b.lng);
  return Math.hypot(bx - ax, by - ay);
}

/** 北を 0°、東を 90° とする時計回りの方角。0 以上 360 未満。 */
export function bearingDeg(from: Place['location'], to: Place['location']): number {
  const [fromX, fromY] = toXY(from.lat, from.lng);
  const [toX, toY] = toXY(to.lat, to.lng);
  return (Math.atan2(toX - fromX, toY - fromY) * 180 / Math.PI + 360) % 360;
}
