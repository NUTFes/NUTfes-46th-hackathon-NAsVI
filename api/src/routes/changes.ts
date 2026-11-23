import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { getHub } from '../lib/changes';

export function register(app: Hono<AppEnv>) {
  app.get('/changes', c => {
    const url = new URL(c.req.url);
    url.pathname = '/changes';
    return getHub(c.env).fetch(new Request(url, c.req.raw));
  });
}
