import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { problem } from '../../lib/errors';
import { requireOperator } from '../../middleware/access';

export function register(app: Hono<AppEnv>) {
  app.delete('/labels/:labelId', requireOperator, async c => {
    const labelId = c.req.param('labelId');
    const usage = () => c.env.DB.prepare(`
      SELECT (SELECT COUNT(*) FROM place_labels WHERE label_id = labels.id) AS count
      FROM labels WHERE id = ?
    `).bind(labelId).first<{ count: number }>();
    const inUse = (count: number) => problem(c, 409, 'label_in_use', `種類 ${labelId} は ${count} 件の場所に付いています`);
    const notFound = () => problem(c, 404, 'not_found', `種類 ${labelId} は登録されていません`);

    try {
      const label = await usage();
      if (!label) return notFound();
      if (label.count > 0) return inUse(label.count);

      // A label may have been attached since the check above.
      const result = await c.env.DB.prepare(`
        DELETE FROM labels WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM place_labels WHERE label_id = ?)
      `).bind(labelId, labelId).run();
      if (result.meta.changes > 0) return c.body(null, 204);

      const current = await usage();
      return current ? inUse(current.count) : notFound();
    } catch {
      return problem(c, 500, 'internal_error', '種類を削除できませんでした');
    }
  });
}
