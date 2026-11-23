import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { commitWithChange } from '../../lib/changes';
import { problem } from '../../lib/errors';
import { nowIso } from '../../lib/time';
import { requireOperator } from '../../middleware/access';

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
    // Only touch the place when the preceding mutation changed a row.
    const touch = DB.prepare('UPDATE places SET updated_at = ? WHERE id = ? AND changes() > 0').bind(createdAt, placeId);
    await commitWithChange({ ...c.env, NOW: createdAt }, [mutation, touch], {
      type: 'placeUpdated',
      payloadSql: {
        sql: `SELECT json_object(
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
        ) FROM places WHERE id = ? AND changes() > 0`,
        params: [placeId, placeId, placeId],
      },
    });
    return c.body(null, 204);
  } catch (error) {
    // A no-op leaves changes() = 0 after touch: the scalar SELECT returns NULL,
    // and changes.payload's NOT NULL constraint rolls back the batch before publish.
    // Match only that constraint, so unrelated database failures still return 500.
    if (error instanceof Error
      && /^(?:D1_ERROR: )?NOT NULL constraint failed: changes\.payload(?:: SQLITE_CONSTRAINT(?: \(extended: SQLITE_CONSTRAINT_NOTNULL\))?)?$/.test(error.message)) {
      return c.body(null, 204);
    }
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
