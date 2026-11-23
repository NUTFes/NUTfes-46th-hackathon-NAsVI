import { fetchFootprint as overpassFootprint, type Point } from './overpass';

export async function fetchFootprint(location: Point, options?: { contact?: string }): Promise<Point[] | null> {
  return overpassFootprint(location, options);
}

export type { Point } from './overpass';
