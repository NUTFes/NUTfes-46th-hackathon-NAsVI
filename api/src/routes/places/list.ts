import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { prepare } from '../../lib/db';
import { problem } from '../../lib/errors';
import { rateLimit } from '../../middleware/ratelimit';
import type { components } from '../../schema';

type Place = components['schemas']['Place'];
type PlaceRow = Omit<Place, 'location' | 'landmarkId' | 'hours' | 'labelIds'> & {
  lat: number;
  lng: number;
  landmark_id: string | null;
};
interface HoursRow { place_id: string; start_at: string; end_at: string }
interface LabelRow { place_id: string; label_id: string }

export function register(app: Hono<AppEnv>) {
  app.get('/places', rateLimit({ key: 'read', limit: 60, windowSec: 60 }), async c => {
    try {
      // Keep every part of the list and its cursor in one D1 transaction.
      const [places, hours, labels, changes] = await c.env.DB.batch([
        prepare(c.env.DB, 'SELECT id, name, kind, lat, lng, description, landmark_id, floor FROM places ORDER BY id'),
        prepare(c.env.DB, 'SELECT place_id, start_at, end_at FROM place_hours ORDER BY place_id, start_at'),
        prepare(c.env.DB, 'SELECT place_id, label_id FROM place_labels ORDER BY place_id, label_id'),
        prepare(c.env.DB, 'SELECT CAST(COALESCE(MAX(id), 0) AS TEXT) AS cursor FROM changes'),
      ]);
      const items = new Map<string, Place>();
      for (const row of places.results as PlaceRow[]) {
        items.set(row.id, {
          id: row.id,
          name: row.name,
          kind: row.kind,
          location: { lat: row.lat, lng: row.lng },
          description: row.description,
          landmarkId: row.landmark_id,
          floor: row.floor,
          hours: [],
          labelIds: [],
        });
      }
      for (const row of hours.results as HoursRow[]) {
        items.get(row.place_id)?.hours.push({ start: row.start_at, end: row.end_at });
      }
      for (const row of labels.results as LabelRow[]) {
        items.get(row.place_id)?.labelIds.push(row.label_id);
      }
      const { cursor } = changes.results[0] as { cursor: string };
      return c.json({ items: [...items.values()], cursor } satisfies components['schemas']['PlaceList']);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });
}
