import { env, SELF, applyD1Migrations, type D1Migration } from 'cloudflare:test';
import type { Vite } from 'vitest/node';
import app from '../src/app';
import type { Env } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends TestEnv {}
  }
  interface ImportMeta { glob: Vite.ImportGlobFunction }
}

export interface TestEnv extends Env { TEST_MIGRATIONS: D1Migration[] }

export async function migrateTestDb(bindings: TestEnv = env): Promise<void> {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
}

let requestSequence = 0;

function createTestRequest(path: string, init: RequestInit = {}): Request {
  const sequence = ++requestSequence;
  const headers = new Headers(init.headers);
  // Isolate requests from rate limits unless a test explicitly shares an IP.
  if (!headers.has('cf-connecting-ip')) {
    headers.set('cf-connecting-ip', `10.${(sequence >>> 16) & 255}.${(sequence >>> 8) & 255}.${sequence & 255}`);
  }
  return new Request(new URL(path, 'http://local'), { ...init, headers });
}

/** SELF is a local service binding; these requests never use the public network. */
export function request(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(createTestRequest(path, init));
}

/** Use per-request bindings so bypass cannot leak into another test. */
export function operatorEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, ...overrides, ACCESS_BYPASS: 'true' };
}

export function requestWithEnv(path: string, init: RequestInit = {}, bindings: Env = env): Promise<Response> {
  return Promise.resolve(app.fetch(createTestRequest(path, init), bindings));
}

export function requestAsOperator(path: string, init?: RequestInit): Promise<Response> {
  return requestWithEnv(path, init, operatorEnv());
}
