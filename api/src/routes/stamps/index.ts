import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { register as press } from './press';
import { register as list } from './list';
import { register as retract } from './retract';

export function register(app: Hono<AppEnv>) {
  press(app);
  list(app);
  retract(app);
}
