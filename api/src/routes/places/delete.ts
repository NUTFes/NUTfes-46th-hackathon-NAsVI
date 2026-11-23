import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { commitWithChange } from '../../lib/changes';
import { first, prepare } from '../../lib/db';
import { problem } from '../../lib/errors';
import { requireOperator } from '../../middleware/access';

export function register(app: Hono<AppEnv>) {
  app.delete('/places/:placeId', requireOperator, async c => {
    const id = c.req.param('placeId');
    try {
      if (!await first(c.env.DB, 'SELECT id FROM places WHERE id = ?', [id])) {
        return problem(c, 404, 'not_found', `場所 ${id} は見つかりません`);
      }
      // place_hours and place_labels are removed by ON DELETE CASCADE.
      await commitWithChange(c.env, [prepare(c.env.DB, 'DELETE FROM places WHERE id = ?', [id])],
        { type: 'placeRemoved', payload: { id } });
      return c.body(null, 204);
    } catch {
      return problem(c, 500, 'internal_error', '時間をおいて、もう一度試してください');
    }
  });
}
