import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { register as crud } from './crud';
import { register as footprint } from './footprint';
import { register as floors } from './floors';
import { register as places } from './places';

export function register(app: Hono<AppEnv>) {
  crud(app);
  footprint(app);
  floors(app);
  places(app);
}
