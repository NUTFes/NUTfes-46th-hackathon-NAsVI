import { fetchFootprint as overpassFootprint, type Point } from './overpass';

export async function fetchFootprint(location: Point): Promise<Point[] | null> {
  return overpassFootprint(location);
}

export type { Point } from './overpass';
