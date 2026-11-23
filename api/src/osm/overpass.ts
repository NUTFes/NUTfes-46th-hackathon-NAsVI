import type { components } from '../schema';

export type Point = components['schemas']['Point'];

// A-10 will select the Overpass request and handle unavailable footprints.
export async function fetchFootprint(location: Point): Promise<Point[] | null> {
  void location;
  throw new Error('OSM の輪郭取得は未実装です');
}
