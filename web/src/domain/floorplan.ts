import type { FloorPlan, Place } from '../types';

/** bounds の緯度経度を SVG の viewBox に換算する(API-30)。範囲外は外挿する。 */
export function floorplanXY(
  point: Place['location'],
  bounds: FloorPlan['bounds'],
  viewBox: FloorPlan['plan']['viewBox'],
): { x: number; y: number } {
  const [minX, minY, width, height] = viewBox.trim().split(/[\s,]+/).map(Number);
  return {
    x: minX + (point.lng - bounds.west) / (bounds.east - bounds.west) * width,
    y: minY + (bounds.north - point.lat) / (bounds.north - bounds.south) * height,
  };
}
