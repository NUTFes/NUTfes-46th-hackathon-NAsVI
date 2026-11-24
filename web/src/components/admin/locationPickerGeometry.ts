import { ORIGIN, fromXY, toXY } from '../../domain/geo';

export type Location = { lat: number; lng: number };
export type PickerPoint = { x: number; y: number };
export type PickerBounds = { west: number; north: number; width: number; height: number };

/** 北が上。取得済みデータを囲み、最低400m×200mと周囲10%を確保する。 */
export function getPickerBounds(points: readonly Location[]): PickerBounds {
  const xy = (points.length ? points : [ORIGIN]).map(point => toXY(point.lat, point.lng));
  const xs = xy.map(point => point[0]);
  const ys = xy.map(point => point[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(400, (Math.max(...xs) - Math.min(...xs)) * 1.2, (Math.max(...ys) - Math.min(...ys)) * 2.4);
  return { west: cx - width / 2, north: cy + width / 4, width, height: width / 2 };
}

export function locationToPoint(location: Location, bounds: PickerBounds): PickerPoint {
  const [x, y] = toXY(location.lat, location.lng);
  return { x: (x - bounds.west) / bounds.width * 100, y: (bounds.north - y) / bounds.height * 100 };
}

export function pointToLocation(point: PickerPoint, bounds: PickerBounds): Location {
  return fromXY(bounds.west + point.x / 100 * bounds.width, bounds.north - point.y / 100 * bounds.height);
}

export function isPointInBounds(point: PickerPoint): boolean {
  return point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
}

export function outlinePath(points: readonly Location[], bounds: PickerBounds): string {
  if (points.length < 3) return '';
  return `M ${points.map(location => { const p = locationToPoint(location, bounds); return `${p.x} ${p.y}`; }).join(' L ')} Z`;
}

/** 空欄・不正な入力と、有効だが地図の範囲外の入力を区別する。 */
export function inputToPoint(latInput: string, lngInput: string, bounds: PickerBounds): PickerPoint | null {
  if (!latInput.trim() || !lngInput.trim()) return null;
  const lat = Number(latInput), lng = Number(lngInput);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return locationToPoint({ lat, lng }, bounds);
}
