import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { components } from '../schema';
import { types } from '../hub/Hub';
import { getHub } from '../lib/changes';
type ChangeType = typeof types[number];

// Preserve the prototype's 502 response when publishing fails.
export function register(app: Hono<AppEnv>) {
  app.post('/dev/emit', async c => {
    if (c.env.ENABLE_DEV_EMIT !== 'true') return c.notFound();
    const body = await c.req.json<{ type?: string; sentAt?: number }>().catch(() => null);
    if (!body || (body.type !== undefined && !types.includes(body.type as ChangeType)) || (body.sentAt !== undefined && !Number.isFinite(body.sentAt))) return c.json({ error: 'invalid body' }, 400);
    const type = (body.type ?? 'stampPressed') as ChangeType;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stamp: components['schemas']['Stamp'] = { id, kind: 'food', at: { lat: 37.4251, lng: 138.778 }, pressedAt: now, expiresAt: new Date(Date.now() + 1_800_000).toISOString() };
    const place: components['schemas']['Place'] = { id, name: '試作用の場所', kind: 'event', location: stamp.at, description: '', landmarkId: null, floor: null, hours: [], labelIds: [] };
    const base = type === 'stampPressed' ? stamp : type === 'placeAdded' || type === 'placeUpdated' ? place : type === 'appVersionChanged' ? { version: 'dev' } : { id };
    const payload = { ...base, ...(body.sentAt === undefined ? {} : { sentAt: body.sentAt }) };
    const result = await c.env.DB.prepare('INSERT INTO changes (type, payload, created_at) VALUES (?, ?, ?)').bind(type, JSON.stringify(payload), now).run();
    const change = { id: result.meta.last_row_id, type, payload };
    const published = await getHub(c.env).fetch('http://hub/publish', { method: 'POST', body: JSON.stringify(change) });
    if (!published.ok) return c.json({ error: 'publish failed', id: change.id }, 502);
    return c.json(change, 201);
  });
}
