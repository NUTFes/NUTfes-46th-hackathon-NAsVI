import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import type { components } from '../../schema';
import { all } from '../../lib/db';
import { problem } from '../../lib/errors';
import { escapeLike, normalize } from '../../lib/normalize';
import { rateLimit } from '../../middleware/ratelimit';

type Place = components['schemas']['Place'];
interface PlaceRow {
  id: string;
  name: string;
  kind: Place['kind'];
  lat: number;
  lng: number;
  description: string;
  landmark_id: string | null;
  floor: number | null;
}
interface HoursRow { place_id: string; start_at: string; end_at: string }
interface LabelRow { place_id: string; label_id: string }

export function register(app: Hono<AppEnv>) {
  app.get('/places/search', rateLimit({ key: 'read', limit: 60, windowSec: 60 }), async c => {
    const q = c.req.query('q');
    if (q === undefined || q.length === 0 || [...q].length > 50) {
      return problem(c, 400, 'invalid_input', '検索語は1〜50文字で指定してください', 'q');
    }

    const term = normalize(q);
    const likePattern = `%${escapeLike(term)}%`;
    // D1 rejects LIKE patterns over 50 bytes ("pattern too complex"), so long terms use instr (same substring semantics).
    const useLike = new TextEncoder().encode(likePattern).length <= 50;
    const pattern = useLike ? likePattern : term;
    const condition = `kind IN ('event', 'parking') AND ${useLike ? "search_text LIKE ? ESCAPE '\\'" : 'instr(search_text, ?) > 0'}`;
    const matchingPlaces = `SELECT id FROM places WHERE ${condition}`;
    const rows = await all<PlaceRow>(c.env.DB, `
      SELECT id, name, kind, lat, lng, description, landmark_id, floor
      FROM places WHERE ${condition} ORDER BY name, id
    `, [pattern]);
    if (rows.length === 0) return c.json({ items: [] });

    // Subqueries keep the binding count fixed, even when many places match.
    const [hours, labels] = await Promise.all([
      all<HoursRow>(c.env.DB, `
        SELECT place_id, start_at, end_at FROM place_hours
        WHERE place_id IN (${matchingPlaces}) ORDER BY start_at
      `, [pattern]),
      all<LabelRow>(c.env.DB, `
        SELECT place_id, label_id FROM place_labels
        WHERE place_id IN (${matchingPlaces}) ORDER BY label_id
      `, [pattern]),
    ]);

    const items: Place[] = rows.map(row => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      location: { lat: row.lat, lng: row.lng },
      description: row.description,
      landmarkId: row.landmark_id,
      floor: row.floor,
      hours: [],
      labelIds: [],
    }));
    const byId = new Map(items.map(place => [place.id, place]));
    for (const row of hours) {
      byId.get(row.place_id)?.hours.push({ start: row.start_at, end: row.end_at });
    }
    for (const row of labels) {
      byId.get(row.place_id)?.labelIds.push(row.label_id);
    }
    return c.json({ items });
  });
}
