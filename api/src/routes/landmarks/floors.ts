import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import { prepare, run } from '../../lib/db';
import { problem } from '../../lib/errors';
import { requireOperator } from '../../middleware/access';
import type { components } from '../../schema';

export interface FloorPlanRow {
  floor: number; view_box: string; d: string;
  north: number; south: number; east: number; west: number;
}

export function toFloorPlan(row: FloorPlanRow): components['schemas']['FloorPlan'] {
  return {
    floor: row.floor,
    plan: { viewBox: row.view_box, d: row.d },
    bounds: { north: row.north, south: row.south, east: row.east, west: row.west },
  };
}

const floorSchema = z.string().regex(/^-?\d+$/).transform(Number).pipe(z.number().int().min(-5).max(20));
const viewBoxSchema = z.string().refine(value => {
  const parts = value.trim().split(/\s*,\s*|\s+/);
  const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
  const values = parts.map(Number);
  return parts.length === 4 && parts.every(part => number.test(part)) &&
    values.every(Number.isFinite) && values[2] > 0 && values[3] > 0;
});
const planInput = z.object({
  plan: z.object({ viewBox: viewBoxSchema, d: z.string().min(1).max(200000) }),
  bounds: z.object({
    north: z.number().finite(), south: z.number().finite(), east: z.number().finite(), west: z.number().finite(),
  }).refine(bounds => bounds.north > bounds.south && bounds.east > bounds.west),
});

export function register(app: Hono<AppEnv>) {
  app.put('/landmarks/:landmarkId/floors/:floor/plan', requireOperator, bodyLimit({
    maxSize: 1024 * 1024,
    onError: c => problem(c, 413, 'payload_too_large', '見取り図は 1 MB 以下にしてください'),
  }), async c => {
    const floor = floorSchema.safeParse(c.req.param('floor'));
    if (!floor.success) return problem(c, 400, 'invalid_input', '階は -5〜20 の整数で指定してください', 'floor');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problem(c, 400, 'invalid_input', 'JSON の本文を送ってください', 'body');
    }
    const parsed = planInput.safeParse(body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0].path[0] ?? 'body');
      return problem(c, 400, 'invalid_input', `${field} の入力が正しくありません`, field);
    }

    const id = c.req.param('landmarkId');
    const db = c.env.DB;
    const { plan, bounds } = parsed.data;
    try {
      // Read the stored value in the same transaction, including any database-side changes.
      const [, current] = await db.batch([
        prepare(db, `INSERT INTO floor_plans (landmark_id, floor, view_box, d, north, south, east, west)
          SELECT id, ?, ?, ?, ?, ?, ?, ? FROM landmarks WHERE id = ?
          ON CONFLICT (landmark_id, floor) DO UPDATE SET
            view_box = excluded.view_box, d = excluded.d, north = excluded.north,
            south = excluded.south, east = excluded.east, west = excluded.west`,
        [floor.data, plan.viewBox, plan.d, bounds.north, bounds.south, bounds.east, bounds.west, id]),
        prepare(db, 'SELECT floor, view_box, d, north, south, east, west FROM floor_plans WHERE landmark_id = ? AND floor = ?',
          [id, floor.data]),
      ]);
      const row = current.results[0] as FloorPlanRow | undefined;
      if (!row) return problem(c, 404, 'not_found', `建物 ${id} は見つかりません`);
      return c.json(toFloorPlan(row), 200);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });

  app.delete('/landmarks/:landmarkId/floors/:floor/plan', requireOperator, async c => {
    const id = c.req.param('landmarkId');
    const floor = floorSchema.safeParse(c.req.param('floor'));
    const missing = () => problem(c, 404, 'not_found', `建物 ${id} の ${c.req.param('floor')} 階の見取り図は見つかりません`);
    // DELETE has no 400 response in OpenAPI; invalid floors cannot identify a plan.
    if (!floor.success) return missing();
    try {
      const result = await run(c.env.DB, 'DELETE FROM floor_plans WHERE landmark_id = ? AND floor = ?', [id, floor.data]);
      if (result.meta.changes === 0) return missing();
      return c.body(null, 204);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });
}
