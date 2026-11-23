import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { all, first, run } from '../../lib/db';
import { problem } from '../../lib/errors';
import { nowIso } from '../../lib/time';
import { requireOperator } from '../../middleware/access';
import { fetchFootprint } from '../../osm';
import type { components } from '../../schema';

type Landmark = components['schemas']['Landmark'];
interface LandmarkRow { id: string; name: string; lat: number; lng: number; footprint: string | null }
interface FloorRow {
  floor: number; view_box: string; d: string;
  north: number; south: number; east: number; west: number;
}

export function register(app: Hono<AppEnv>) {
  app.post('/landmarks/:landmarkId/footprint', requireOperator, async c => {
    const id = c.req.param('landmarkId');
    try {
      const landmark = await first<LandmarkRow>(c.env.DB, 'SELECT * FROM landmarks WHERE id = ?', [id]);
      if (!landmark) return problem(c, 404, 'not_found', `建物 ${id} は見つかりません`);
      const footprint = await fetchFootprint({ lat: landmark.lat, lng: landmark.lng });
      if (!footprint) {
        return problem(c, 502, 'footprint_unavailable', 'この位置の建物の輪郭が地図データに見つかりません');
      }
      await run(c.env.DB, 'UPDATE landmarks SET footprint = ?, footprint_at = ? WHERE id = ?',
        [JSON.stringify(footprint), nowIso(c.env), id]);
      const saved = await first<LandmarkRow>(c.env.DB, 'SELECT * FROM landmarks WHERE id = ?', [id]);
      if (!saved) return problem(c, 404, 'not_found', `建物 ${id} は見つかりません`);
      const floors = await all<FloorRow>(c.env.DB,
        'SELECT * FROM floor_plans WHERE landmark_id = ? ORDER BY floor ASC', [id]);
      const result: Landmark = {
        id: saved.id,
        name: saved.name,
        location: { lat: saved.lat, lng: saved.lng },
        footprint: saved.footprint === null ? null : JSON.parse(saved.footprint),
        floors: floors.map(row => ({
          floor: row.floor,
          plan: { viewBox: row.view_box, d: row.d },
          bounds: { north: row.north, south: row.south, east: row.east, west: row.west },
        })),
      };
      return c.json(result, 200);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });
}
