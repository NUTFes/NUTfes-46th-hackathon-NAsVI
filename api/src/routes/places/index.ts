import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { register as search } from './search';
import { register as list } from './list';
import { register as create } from './create';
import { register as update } from './update';
import { register as remove } from './delete';

export function register(app: Hono<AppEnv>) {
  search(app);
  list(app);
  create(app);
  update(app);
  remove(app);
}
