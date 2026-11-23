import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import type { components } from '../../schema';
import { commitWithChange } from '../../lib/changes';
import { all, first, prepare } from '../../lib/db';
import { problem } from '../../lib/errors';
import { normalize } from '../../lib/normalize';
import { nowIso } from '../../lib/time';
import { requireOperator } from '../../middleware/access';

type Place = components['schemas']['Place'];
type PlaceRow = {
  id: string; name: string; kind: Place['kind']; lat: number; lng: number;
  description: string; landmark_id: string | null; floor: number | null;
};

const dateTime = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
async function readPlace(db: D1Database, id: string): Promise<Place | null> {
  const row = await first<PlaceRow>(db, 'SELECT * FROM places WHERE id = ?', [id]);
  if (!row) return null;
  const hours = await all<Place['hours'][number]>(db,
    'SELECT start_at AS start, end_at AS end FROM place_hours WHERE place_id = ? ORDER BY start_at', [id]);
  const labels = await all<{ label_id: string }>(db,
    'SELECT label_id FROM place_labels WHERE place_id = ? ORDER BY label_id', [id]);
  return {
    id: row.id, name: row.name, kind: row.kind, location: { lat: row.lat, lng: row.lng },
    description: row.description, landmarkId: row.landmark_id, floor: row.floor,
    hours, labelIds: labels.map(label => label.label_id),
  };
}

const patchSchema = z.looseObject({
  // Supplying kind is invalid even when it equals the current kind.
  kind: z.never().optional(),
  name: z.string().refine(value => [...value].length >= 1 && [...value].length <= 50).optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
  description: z.string().refine(value => [...value].length <= 500).optional(),
  landmarkId: z.string().nullable().optional(),
  floor: z.number().int().min(-5).max(20).nullable().optional(),
  hours: z.array(z.object({ start: dateTime, end: dateTime }))
    .refine(hours => new Set(hours.map(period => period.start)).size === hours.length,
      '開催時間の開始が重複しています')
    .refine(hours => hours.every(period => period.end >= period.start), '開催時間の終了は開始以降にしてください').optional(),
}).refine(value => ['name', 'location', 'description', 'landmarkId', 'floor', 'hours'].some(key => key in value), '更新する項目を入れてください');

export function register(app: Hono<AppEnv>) {
  app.patch('/places/:placeId', requireOperator, async c => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problem(c, 400, 'invalid_input', 'JSON の本文を入れてください');
    }
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      const field = parsed.error.issues[0].path[0];
      return problem(c, 400, 'invalid_input',
        field === 'kind' ? '種別は変更できません' : '更新する項目を正しく入れてください',
        typeof field === 'string' ? field : undefined);
    }
    const patch = parsed.data;
    const id = c.req.param('placeId');
    const db = c.env.DB;
    try {
      const row = await first<PlaceRow>(db, 'SELECT * FROM places WHERE id = ?', [id]);
      if (!row) return problem(c, 404, 'not_found', `場所 ${id} は見つかりません`);

      const landmarkId = patch.landmarkId !== undefined ? patch.landmarkId : row.landmark_id;
      const floor = patch.floor !== undefined ? patch.floor : row.floor;
      if (landmarkId === null && floor !== null) {
        return problem(c, 400, 'invalid_input', '階は建物の中の場所にだけ指定できます', 'floor');
      }
      if (patch.landmarkId !== undefined && landmarkId !== null &&
          !await first(db, 'SELECT id FROM landmarks WHERE id = ?', [landmarkId])) {
        return problem(c, 400, 'invalid_input', '指定した建物は見つかりません', 'landmarkId');
      }

      const hours = patch.hours ?? await all<Place['hours'][number]>(db,
        'SELECT start_at AS start, end_at AS end FROM place_hours WHERE place_id = ? ORDER BY start_at', [id]);
      const labels = await all<{ label_id: string }>(db,
        'SELECT label_id FROM place_labels WHERE place_id = ? ORDER BY label_id', [id]);
      const place: Place = {
        id, name: patch.name ?? row.name, kind: row.kind,
        location: patch.location ?? { lat: row.lat, lng: row.lng },
        description: patch.description ?? row.description,
        landmarkId, floor, hours, labelIds: labels.map(label => label.label_id),
      };

      // Update only supplied columns so another partial edit is not overwritten.
      const columns = ['updated_at = ?'];
      const values: unknown[] = [nowIso(c.env)];
      const set = (column: string, value: unknown) => { columns.push(`${column} = ?`); values.push(value); };
      if (patch.name !== undefined) { set('name', patch.name); set('search_text', normalize(patch.name)); }
      if (patch.location !== undefined) { set('lat', patch.location.lat); set('lng', patch.location.lng); }
      if (patch.description !== undefined) set('description', patch.description);
      if (patch.landmarkId !== undefined) set('landmark_id', landmarkId);
      if (patch.floor !== undefined) set('floor', floor);
      const statements = [prepare(db, `UPDATE places SET ${columns.join(', ')} WHERE id = ?`, [...values, id])];
      if (patch.hours !== undefined) {
        statements.push(prepare(db, 'DELETE FROM place_hours WHERE place_id = ?', [id]));
        for (const period of patch.hours) {
          statements.push(prepare(db, 'INSERT INTO place_hours (place_id, start_at, end_at) VALUES (?, ?, ?)',
            [id, period.start, period.end]));
        }
      }
      await commitWithChange(c.env, statements, { type: 'placeUpdated', payload: place });
      // 読み取りと書き込みの間に別の運営が別の項目を直した場合に備え、DB の現在値を応答と配信に使う。
      const current = await readPlace(db, id);
      if (!current) return problem(c, 404, 'not_found', `場所 ${id} は見つかりません`);
      if (JSON.stringify(current) !== JSON.stringify(place)) {
        await commitWithChange(c.env, [], { type: 'placeUpdated', payload: current });
      }
      return c.json(current, 200);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });
}
