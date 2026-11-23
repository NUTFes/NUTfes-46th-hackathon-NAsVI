import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { getHub } from '../../lib/changes';
import { first, prepare } from '../../lib/db';
import { problem } from '../../lib/errors';
import { nowIso } from '../../lib/time';
import { rateLimit } from '../../middleware/ratelimit';

async function matchesProof(proof: string, storedHash: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(proof));
  // proof_hash stores the SHA-256 digest as lowercase hexadecimal.
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const expected = encoder.encode(storedHash);
  return expected.byteLength === 64 && crypto.subtle.timingSafeEqual(encoder.encode(hash), expected);
}

export function register(app: Hono<AppEnv>) {
  app.delete('/stamps/:stampId', rateLimit({ key: 'stamp-press', limit: 5, windowSec: 60 }), async c => {
    try {
      const stamp = await first<{ id: string; proof_hash: string; expires_at: string }>(c.env.DB,
        'SELECT id, proof_hash, expires_at FROM stamps WHERE id = ?', [c.req.param('stampId')]);
      if (!stamp) return problem(c, 404, 'not_found', 'スタンプが見つかりません');

      const proof = c.req.header('X-Stamp-Proof');
      if (!proof || !await matchesProof(proof, stamp.proof_hash)) {
        return problem(c, 403, 'not_stamp_owner', 'このスタンプは取り消せません');
      }

      // Stamp times are stored as UTC ISO strings with milliseconds ("....000Z"),
      // so string comparison with nowIso() is chronological.
      const now = nowIso(c.env);
      if (stamp.expires_at <= now) {
        // Expired stamps are removed silently: no stampRetracted (API-38).
        await c.env.DB.prepare('DELETE FROM stamps WHERE id = ? AND proof_hash = ?')
          .bind(stamp.id, stamp.proof_hash).run();
        return c.body(null, 204);
      }

      // Delete and record the change atomically. The change row is inserted only if this
      // request actually deleted the stamp, so concurrent DELETEs record it once.
      const payload = JSON.stringify({ id: stamp.id });
      const [deleted, inserted] = await c.env.DB.batch([
        prepare(c.env.DB, 'DELETE FROM stamps WHERE id = ? AND proof_hash = ? AND expires_at > ?',
          [stamp.id, stamp.proof_hash, now]),
        prepare(c.env.DB, `INSERT INTO changes (type, payload, created_at)
          SELECT 'stampRetracted', ?, ? WHERE changes() > 0`, [payload, now]),
      ]);
      if (deleted.meta.changes === 0) return problem(c, 404, 'not_found', 'スタンプが見つかりません');

      const event = { id: inserted.meta.last_row_id, type: 'stampRetracted', payload: { id: stamp.id }, createdAt: now };
      try {
        const response = await getHub(c.env).fetch('http://hub/publish', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
        });
        await response.body?.cancel();
      } catch {
        // D1 is authoritative. Reconnecting clients replay the committed change.
      }
      return c.body(null, 204);
    } catch {
      return problem(c, 500, 'internal_error', 'スタンプを取り消せませんでした');
    }
  });
}
