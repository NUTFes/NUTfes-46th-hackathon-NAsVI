import type { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../env';
import type { components } from '../../schema';
import { commitWithChange } from '../../lib/changes';
import { problem } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { normalize } from '../../lib/normalize';
import { nowIso } from '../../lib/time';
import { requireOperator } from '../../middleware/access';

// OpenAPI string lengths count Unicode code points, as does SQLite length().
const placeInput = z.object({
  name: z.string().refine(value => Array.from(value).length >= 1 && Array.from(value).length <= 50),
  kind: z.enum(['event', 'parking', 'info', 'wc', 'rest', 'trash']),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  description: z.string().refine(value => Array.from(value).length <= 500),
  landmarkId: z.string().nullable().optional(),
  floor: z.number().int().min(-5).max(20).nullable().optional(),
  hours: z.array(z.object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  })).optional(),
}).refine(value => value.landmarkId != null || value.floor == null, { path: ['floor'] });

export function register(app: Hono<AppEnv>) {
  app.post('/places', requireOperator, async c => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problem(c, 400, 'invalid_input', 'JSON の本文を送ってください', 'body');
    }
    const parsed = placeInput.safeParse(body);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0].path[0] ?? 'body');
      return problem(c, 400, 'invalid_input', `${field} の入力が正しくありません`, field);
    }

    const input = parsed.data;
    const hours = (input.hours ?? []).map(period => ({
      start: new Date(period.start).toISOString(), end: new Date(period.end).toISOString(),
    }));
    if (hours.some(period => period.end < period.start) || new Set(hours.map(period => period.start)).size !== hours.length) {
      return problem(c, 400, 'invalid_input', 'hours の時間帯が正しくありません', 'hours');
    }
    try {
      if (input.landmarkId != null) {
        const landmark = await c.env.DB.prepare('SELECT id FROM landmarks WHERE id = ?')
          .bind(input.landmarkId).first();
        if (!landmark) return problem(c, 400, 'invalid_input', '指定した建物は存在しません', 'landmarkId');
      }

      const place: components['schemas']['Place'] = {
        id: newId(), name: input.name, kind: input.kind, location: input.location,
        description: input.description, landmarkId: input.landmarkId ?? null,
        floor: input.floor ?? null, hours, labelIds: [],
      };
      const stmts = [c.env.DB.prepare(`
        INSERT INTO places (id, name, kind, lat, lng, description, search_text, landmark_id, floor, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(place.id, place.name, place.kind, place.location.lat, place.location.lng,
        place.description, normalize(place.name), place.landmarkId, place.floor, nowIso(c.env))];
      for (const period of place.hours) {
        stmts.push(c.env.DB.prepare('INSERT INTO place_hours (place_id, start_at, end_at) VALUES (?, ?, ?)')
          .bind(place.id, period.start, period.end));
      }
      await commitWithChange(c.env, stmts, { type: 'placeAdded', payload: place });
      return c.json(place, 201);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });
}
