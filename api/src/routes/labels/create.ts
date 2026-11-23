import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import type { components } from '../../schema';
import { first, run } from '../../lib/db';
import { problem } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { requireOperator } from '../../middleware/access';

export function register(app: Hono<AppEnv>) {
  app.post('/labels', requireOperator, async c => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return problem(c, 400, 'invalid_input', 'JSON の本文を指定してください');
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return problem(c, 400, 'invalid_input', '種類の名前を指定してください', 'title');
    }
    const title = (body as Record<string, unknown>).title;
    if (typeof title !== 'string' || [...title].length < 1 || [...title].length > 20) {
      return problem(c, 400, 'invalid_input', '種類の名前は1〜20文字で指定してください', 'title');
    }

    try {
      const id = newId();
      // Let the unique constraint arbitrate simultaneous requests for the same title.
      const result = await run(c.env.DB,
        'INSERT INTO labels (id, title) VALUES (?, ?) ON CONFLICT(title) DO NOTHING', [id, title]);
      if (result.meta.changes === 0) {
        return problem(c, 409, 'label_title_taken', `種類「${title}」は既にあります`);
      }
      const label = await first<components['schemas']['Label']>(c.env.DB,
        'SELECT id, title FROM labels WHERE id = ?', [id]);
      if (!label) return problem(c, 500, 'internal_error', '作成した種類を取得できませんでした');
      return c.json(label, 201);
    } catch {
      return problem(c, 500, 'internal_error', '種類を作成できませんでした');
    }
  });
}
