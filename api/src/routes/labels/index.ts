import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { register as list } from './list';
import { register as create } from './create';
import { register as remove } from './delete';
import { register as attach } from './attach';

export function register(app: Hono<AppEnv>) {
  list(app);
  create(app);
  remove(app);
  attach(app);
}
