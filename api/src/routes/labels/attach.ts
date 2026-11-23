import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { commitWithChange } from '../../lib/changes';
import { problem } from '../../lib/errors';
import { nowIso } from '../../lib/time';
import { requireOperator } from '../../middleware/access';
import type { components } from '../../schema';

type Place = components['schemas']['Place'];
class UnchangedLabel extends Error {}

async function changeLabel(c: Context<AppEnv>, attach: boolean): Promise<Response> {
  const placeId = c.req.param('placeId');
  const labelId = c.req.param('labelId');
  const { DB } = c.env;

  const findMissing = async (): Promise<Response | null> => {
    if (!await DB.prepare('SELECT id FROM places WHERE id = ?').bind(placeId).first()) {
      return problem(c, 404, 'not_found', `場所 ${placeId} は登録されていません`);
    }
    if (!await DB.prepare('SELECT id FROM labels WHERE id = ?').bind(labelId).first()) {
      return problem(c, 404, 'label_not_found', `種類 ${labelId} は登録されていません`);
    }
    return null;
  };

  try {
    const missing = await findMissing();
    if (missing) return missing;

    const mutation = DB.prepare(attach
      ? 'INSERT INTO place_labels (place_id, label_id) VALUES (?, ?) ON CONFLICT (place_id, label_id) DO NOTHING'
      : 'DELETE FROM place_labels WHERE place_id = ? AND label_id = ?'
    ).bind(placeId, labelId);
    const createdAt = nowIso(c.env);
    const change: { type: 'placeUpdated'; payload: Place | null } = { type: 'placeUpdated', payload: null };

    // commitWithChange serializes payload before executing its batch. Replace its
    // final INSERT locally so the snapshot is read AFTER the mutation, atomically.
    // RETURNING also supplies that exact snapshot to the subsequent Hub publish.
    const insertChange = DB.prepare(`
      INSERT INTO changes (type, payload, created_at)
      SELECT 'placeUpdated', json_object(
        'id', id, 'name', name, 'kind', kind,
        'location', json_object('lat', lat, 'lng', lng),
        'description', description, 'landmarkId', landmark_id, 'floor', floor,
        'hours', json((
          SELECT json_group_array(json_object('start', start_at, 'end', end_at))
          FROM (SELECT start_at, end_at FROM place_hours WHERE place_id = ? ORDER BY start_at)
        )),
        'labelIds', json((
          SELECT json_group_array(label_id)
          FROM (SELECT label_id FROM place_labels WHERE place_id = ? ORDER BY label_id)
        ))
      ), ? FROM places WHERE id = ? AND changes() > 0
      RETURNING payload
    `).bind(placeId, placeId, createdAt, placeId);
    const changeDb: D1Database = {
      prepare: sql => DB.prepare(sql),
      exec: sql => DB.exec(sql),
      dump: () => DB.dump(),
      withSession: constraint => DB.withSession(constraint),
      async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
        const results = await DB.batch<{ payload: string }>([...statements.slice(0, -1), insertChange]);
        const row = results[results.length - 1].results[0];
        // A duplicate PUT / absent DELETE commits no history and publishes nothing.
        if (!row) throw new UnchangedLabel();
        change.payload = JSON.parse(row.payload) as Place;
        return results as D1Result<T>[];
      },
    };
    // Only when the mutation changed a row (changes() > 0, same condition as the change event).
    const touch = DB.prepare('UPDATE places SET updated_at = ? WHERE id = ? AND changes() > 0').bind(createdAt, placeId);
    await commitWithChange({ ...c.env, DB: changeDb, NOW: createdAt }, [mutation, touch], change);
    return c.body(null, 204);
  } catch (error) {
    if (error instanceof UnchangedLabel) return c.body(null, 204);
    // The place or label may have been deleted after the existence check (foreign key violation).
    try {
      const missing = await findMissing();
      if (missing) return missing;
    } catch { /* fall through to 500 */ }
    return problem(c, 500, 'internal_error', '場所の種類を変更できませんでした');
  }
}

export function register(app: Hono<AppEnv>) {
  app.put('/places/:placeId/labels/:labelId', requireOperator, c => changeLabel(c, true));
  app.delete('/places/:placeId/labels/:labelId', requireOperator, c => changeLabel(c, false));
}
