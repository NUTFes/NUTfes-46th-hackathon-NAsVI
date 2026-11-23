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
