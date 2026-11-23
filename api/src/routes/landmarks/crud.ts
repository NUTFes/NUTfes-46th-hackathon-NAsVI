import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import type { components } from '../../schema';
import { first, prepare, run } from '../../lib/db';
import { problem } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { nowIso } from '../../lib/time';
import { requireOperator } from '../../middleware/access';
import { rateLimit } from '../../middleware/ratelimit';
import { fetchFootprint } from '../../osm';

type Landmark = components['schemas']['Landmark'];
type LandmarkRow = { id: string; name: string; lat: number; lng: number; footprint: string | null };
type FloorRow = {
  landmark_id: string; floor: number; view_box: string; d: string;
  north: number; south: number; east: number; west: number;
};

const landmarkInput = z.object({
  // OpenAPI and SQLite count Unicode code points rather than UTF-16 units.
  name: z.string().refine(value => [...value].length >= 1 && [...value].length <= 50),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
});
const landmarkPatch = landmarkInput.partial()
  .refine(value => value.name !== undefined || value.location !== undefined, '更新する項目を入れてください');

async function readLandmarks(db: D1Database, id?: string): Promise<Landmark[]> {
  const values = id === undefined ? [] : [id];
  const [landmarks, plans] = await db.batch<LandmarkRow | FloorRow>([
    prepare(db, `SELECT id, name, lat, lng, footprint FROM landmarks${id === undefined ? '' : ' WHERE id = ?'} ORDER BY id`, values),
    prepare(db, `SELECT * FROM floor_plans${id === undefined ? '' : ' WHERE landmark_id = ?'} ORDER BY landmark_id, floor`, values),
  ]);
  const floors = new Map<string, Landmark['floors']>();
  for (const row of plans.results as FloorRow[]) {
    const entries = floors.get(row.landmark_id) ?? [];
    entries.push({
      floor: row.floor, plan: { viewBox: row.view_box, d: row.d },
      bounds: { north: row.north, south: row.south, east: row.east, west: row.west },
    });
    floors.set(row.landmark_id, entries);
  }
  return (landmarks.results as LandmarkRow[]).map(row => ({
    id: row.id, name: row.name, location: { lat: row.lat, lng: row.lng },
    footprint: row.footprint === null ? null : JSON.parse(row.footprint),
    floors: floors.get(row.id) ?? [],
  }));
}

export function register(app: Hono<AppEnv>) {
  // The changes contract has no landmark events; CRUD does not publish one.
  app.get('/landmarks', rateLimit({ key: 'read', limit: 60, windowSec: 60 }), async c => {
    try {
      return c.json({ items: await readLandmarks(c.env.DB) });
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });

  app.post('/landmarks', requireOperator, async c => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problem(c, 400, 'invalid_input', 'JSON の本文を送ってください', 'body');
    }
    const parsed = landmarkInput.safeParse(body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0].path[0] ?? 'body');
      return problem(c, 400, 'invalid_input', `${field} の入力が正しくありません`, field);
    }
    const input = parsed.data;
    let footprint: Landmark['footprint'] = null;
    try {
      footprint = await fetchFootprint(input.location);
    } catch {
      // API-37: unavailable OSM data must not prevent registration.
    }
    try {
      const id = newId();
      await run(c.env.DB, `INSERT INTO landmarks (id, name, lat, lng, footprint, footprint_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [id, input.name, input.location.lat, input.location.lng,
        footprint === null ? null : JSON.stringify(footprint), footprint === null ? null : nowIso(c.env)]);
      const [current] = await readLandmarks(c.env.DB, id);
      if (!current) throw new Error('登録した建物が見つかりません');
      return c.json(current, 201);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });

  app.patch('/landmarks/:landmarkId', requireOperator, async c => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problem(c, 400, 'invalid_input', 'JSON の本文を送ってください', 'body');
    }
    const parsed = landmarkPatch.safeParse(body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0].path[0] ?? 'body');
      return problem(c, 400, 'invalid_input', `${field} の入力が正しくありません`, field);
    }
    const patch = parsed.data;
    const id = c.req.param('landmarkId');
    try {
      if (!await first(c.env.DB, 'SELECT id FROM landmarks WHERE id = ?', [id])) {
        return problem(c, 404, 'not_found', `建物 ${id} は見つかりません`);
      }
      // Update only supplied columns so another partial edit is not overwritten.
      const columns: string[] = [];
      const values: unknown[] = [];
      if (patch.name !== undefined) { columns.push('name = ?'); values.push(patch.name); }
      if (patch.location !== undefined) {
        columns.push('lat = ?', 'lng = ?'); values.push(patch.location.lat, patch.location.lng);
      }
      await run(c.env.DB, `UPDATE landmarks SET ${columns.join(', ')} WHERE id = ?`, [...values, id]);
      const [current] = await readLandmarks(c.env.DB, id);
      if (!current) return problem(c, 404, 'not_found', `建物 ${id} は見つかりません`);
      return c.json(current);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });

  app.delete('/landmarks/:landmarkId', requireOperator, async c => {
    const id = c.req.param('landmarkId');
    try {
      const row = await first<{ name: string }>(c.env.DB, 'SELECT name FROM landmarks WHERE id = ?', [id]);
      if (!row) return problem(c, 404, 'not_found', `建物 ${id} は見つかりません`);
      // Check references in the DELETE as well, including places added after the read.
      // floor_plans are removed by ON DELETE CASCADE.
      const removed = await first(c.env.DB, `DELETE FROM landmarks WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM places WHERE landmark_id = ?) RETURNING id`, [id, id]);
      if (removed) return c.body(null, 204);
      const references = await first<{ count: number }>(c.env.DB,
        'SELECT COUNT(*) AS count FROM places WHERE landmark_id = ?', [id]);
      if (references && references.count > 0) {
        return problem(c, 409, 'landmark_in_use', `${row.name}には ${references.count} 件の場所が付いています`);
      }
      return problem(c, 404, 'not_found', `建物 ${id} は見つかりません`);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });
}
