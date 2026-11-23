import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { commitWithChange } from '../../lib/changes';
import { first, prepare } from '../../lib/db';
import { problem } from '../../lib/errors';
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
  app.delete('/stamps/:stampId', rateLimit({ key: 'read', limit: 60, windowSec: 60 }), async c => {
    try {
      const stamp = await first<{ id: string; proof_hash: string }>(c.env.DB,
        'SELECT id, proof_hash FROM stamps WHERE id = ?', [c.req.param('stampId')]);
      if (!stamp) return problem(c, 404, 'not_found', 'スタンプが見つかりません');

      const proof = c.req.header('X-Stamp-Proof');
      if (!proof || !await matchesProof(proof, stamp.proof_hash)) {
        return problem(c, 403, 'not_stamp_owner', 'このスタンプは取り消せません');
      }

      await commitWithChange(c.env, [
        prepare(c.env.DB, 'DELETE FROM stamps WHERE id = ?', [stamp.id]),
      ], { type: 'stampRetracted', payload: { id: stamp.id } });
      return c.body(null, 204);
    } catch {
      return problem(c, 500, 'internal_error', 'スタンプを取り消せませんでした');
    }
  });
}
