import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { prepare } from '../../lib/db';
import { problem } from '../../lib/errors';
import { rateLimit } from '../../middleware/ratelimit';
import type { components } from '../../schema';
import { toFloorPlan, type FloorPlanRow } from './floors';

type Place = components['schemas']['Place'];
interface LandmarkRow { id: string; name: string; lat: number; lng: number; footprint: string | null }
type PlaceRow = Omit<Place, 'location' | 'landmarkId' | 'hours' | 'labelIds'> & {
  lat: number; lng: number; landmark_id: string;
};
interface HoursRow { place_id: string; start_at: string; end_at: string }
interface LabelRow { place_id: string; label_id: string }

export function register(app: Hono<AppEnv>) {
  app.get('/landmarks/:landmarkId/places', rateLimit({ key: 'read', limit: 60, windowSec: 60 }), async c => {
    const id = c.req.param('landmarkId');
    const db = c.env.DB;
    const matchingPlaces = "SELECT id FROM places WHERE landmark_id = ? AND kind IN ('event', 'parking')";
    try {
      // Keep the building, its plans and every part of its places in one snapshot.
      const [landmarks, floors, places, hours, labels] = await db.batch([
        prepare(db, 'SELECT id, name, lat, lng, footprint FROM landmarks WHERE id = ?', [id]),
        prepare(db, 'SELECT floor, view_box, d, north, south, east, west FROM floor_plans WHERE landmark_id = ? ORDER BY floor', [id]),
        prepare(db, `SELECT id, name, kind, lat, lng, description, landmark_id, floor
          FROM places WHERE id IN (${matchingPlaces}) ORDER BY name, id`, [id]),
        prepare(db, `SELECT place_id, start_at, end_at FROM place_hours
          WHERE place_id IN (${matchingPlaces}) ORDER BY place_id, start_at`, [id]),
        prepare(db, `SELECT place_id, label_id FROM place_labels
          WHERE place_id IN (${matchingPlaces}) ORDER BY place_id, label_id`, [id]),
      ]);
      const row = landmarks.results[0] as LandmarkRow | undefined;
      if (!row) return problem(c, 404, 'not_found', `建物 ${id} は見つかりません`);

      const items = new Map<string, Place>();
      for (const place of places.results as PlaceRow[]) {
        items.set(place.id, {
          id: place.id, name: place.name, kind: place.kind,
          location: { lat: place.lat, lng: place.lng }, description: place.description,
          landmarkId: place.landmark_id, floor: place.floor, hours: [], labelIds: [],
        });
      }
      for (const period of hours.results as HoursRow[]) {
        items.get(period.place_id)?.hours.push({ start: period.start_at, end: period.end_at });
      }
      for (const label of labels.results as LabelRow[]) {
        items.get(label.place_id)?.labelIds.push(label.label_id);
      }
      return c.json({
        landmark: {
          id: row.id, name: row.name, location: { lat: row.lat, lng: row.lng },
          footprint: row.footprint === null ? null : JSON.parse(row.footprint),
          floors: (floors.results as FloorPlanRow[]).map(toFloorPlan),
        },
        items: [...items.values()],
      } satisfies components['schemas']['BuildingPlaces']);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });
}
