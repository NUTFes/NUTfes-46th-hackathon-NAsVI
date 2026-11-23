import type { Env } from '../env';

export function nowIso(env: Env): string {
  return env.NOW ?? new Date().toISOString();
}
