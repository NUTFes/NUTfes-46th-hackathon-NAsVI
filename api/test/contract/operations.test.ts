import { env } from 'cloudflare:test';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { listOperations } from '../../../tools/contract/openapi';
import { reportCoverage, type CoverageResult } from '../../../tools/contract/report';
import { validateResponse } from '../../../tools/contract/validate';
import type { Env } from '../../src/env';
import { migrateTestDb, operatorEnv, requestWithEnv } from '../helpers';
import { spec } from './spec';

const now = '2026-11-24T02:00:00.000Z';
const json = { 'Content-Type': 'application/json' };
const placeBody = {
  name: '屋台', kind: 'event', location: { lat: 37.4249, lng: 138.7781 }, description: '',
  hours: [{ start: '2026-11-28T02:00:00.000Z', end: '2026-11-28T06:00:00.000Z' }],
};
// 実装済みの操作には意味のある要求を送る。ここにない操作は、パスの引数を埋めた要求を送る(501 なら未実装として数える)。
const requests: Record<string, { path: string; init?: RequestInit }> = {
  showPlaces: { path: '/api/places' },
  search: { path: '/api/places/search?q=屋台' },
  registerPlace: { path: '/api/places', init: { method: 'POST', headers: json, body: JSON.stringify(placeBody) } },
  updatePlace: { path: '/api/places/pl_01', init: { method: 'PATCH', headers: json, body: JSON.stringify({ name: '屋台 2' }) } },
  removePlace: { path: '/api/places/pl_01', init: { method: 'DELETE' } },
};
// SSE は JSON スキーマで検証できないので対象外にする。
const skipped = new Set(['watchChanges']);
let bindings: Env;

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
  await migrateTestDb();
});
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(async () => {
  bindings = operatorEnv({
    NOW: now,
    HUB: { idFromName: vi.fn(() => 'main'), get: vi.fn(() => ({ fetch: async () => new Response(null, { status: 204 }) })) } as unknown as Env['HUB'],
  });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM places'), env.DB.prepare('DELETE FROM labels'),
    env.DB.prepare('DELETE FROM stamps'), env.DB.prepare('DELETE FROM changes'),
    env.DB.prepare(`INSERT INTO places (id, name, kind, lat, lng, description, search_text, updated_at)
      VALUES ('pl_01', '屋台', 'event', 37.425, 138.778, '', '屋台', ?)`).bind(now),
    env.DB.prepare("INSERT INTO place_hours (place_id, start_at, end_at) VALUES ('pl_01', '2026-11-28T01:00:00.000Z', '2026-11-28T03:00:00.000Z')"),
  ]);
});

it('実装済みの全操作の応答が openapi に一致し、未実装(501)の件数を出力する', async () => {
  const results: CoverageResult[] = [];
  const failures: string[] = [];
  for (const operation of listOperations(spec)) {
    if (skipped.has(operation.operationId)) { results.push({ operationId: operation.operationId, outcome: 'skipped' }); continue; }
    const planned = requests[operation.operationId];
    const path = planned?.path ?? `/api${operation.path.replace(/\{([^}]+)\}/g, (_, name) => (name === 'floor' ? '1' : 'x'))}`;
    const init = planned?.init ?? { method: operation.method, headers: json, body: operation.method === 'GET' || operation.method === 'DELETE' ? undefined : '{}' };
    const response = await requestWithEnv(path, init, bindings);
    if (response.status === 501) { results.push({ operationId: operation.operationId, outcome: 'unimplemented' }); continue; }
    const text = await response.text();
    const contentType = response.headers.get('content-type');
    const body = text === '' ? undefined : contentType?.includes('json') ? JSON.parse(text) : text;
    const violations = validateResponse(spec, { method: operation.method, path, status: response.status, contentType, body });
    if (violations.length > 0) failures.push(`${operation.operationId} ${response.status}: ${JSON.stringify(violations)}`);
    results.push({ operationId: operation.operationId, outcome: 'validated' });
  }
  const summary = reportCoverage(results);
  expect(failures).toEqual([]);
  expect(summary.validated).toBeGreaterThanOrEqual(5);
  expect(summary.skipped).toEqual(['watchChanges']);
  expect(summary.validated + summary.unimplemented.length + summary.skipped.length).toBe(listOperations(spec).length);
});
