import type { Hub } from './hub/Hub';

export interface Env {
  DB: D1Database;
  HUB: DurableObjectNamespace<Hub>;
  ENABLE_DEV_EMIT?: string;
  ACCESS_BYPASS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  NOW?: string;
}

export interface Actor { email: string }
export type AppEnv = { Bindings: Env; Variables: { actor: Actor } };
