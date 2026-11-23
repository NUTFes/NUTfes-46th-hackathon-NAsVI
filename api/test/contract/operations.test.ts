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
interface Case { operationId: string; name: string; path: string; init?: RequestInit; status: number; bypass?: boolean; ip?: string; repeat?: number }
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: json, body: JSON.stringify(body) });
// 実装済みの操作は、成功とエラー(401・400・404・409・429)を意図して要求し、期待ステータスを固定する。
// ここにない操作は、パスの引数を埋めた汎用の要求を送り、501 なら「未実装」として数える。
const cases: Case[] = [
  { operationId: 'showPlaces', name: '一覧', path: '/api/places', status: 200 },
  { operationId: 'showPlaces', name: '読み取りの上限', path: '/api/places', status: 429, ip: '192.0.2.61', repeat: 61 },
  { operationId: 'search', name: '検索', path: '/api/places/search?q=屋台', status: 200 },
  { operationId: 'search', name: 'q なし', path: '/api/places/search', status: 400 },
  { operationId: 'registerPlace', name: '登録', path: '/api/places', init: post(placeBody), status: 201 },
  { operationId: 'registerPlace', name: '不正な入力', path: '/api/places', init: post({}), status: 400 },
  { operationId: 'registerPlace', name: '運営でない', path: '/api/places', init: post(placeBody), status: 401, bypass: false },
  { operationId: 'updatePlace', name: '更新', path: '/api/places/pl_01', init: { method: 'PATCH', headers: json, body: JSON.stringify({ name: '屋台 2' }) }, status: 200 },
  { operationId: 'updatePlace', name: '存在しない', path: '/api/places/none', init: { method: 'PATCH', headers: json, body: JSON.stringify({ name: 'x' }) }, status: 404 },
  { operationId: 'updatePlace', name: '運営でない', path: '/api/places/pl_01', init: { method: 'PATCH', headers: json, body: '{}' }, status: 401, bypass: false },
  { operationId: 'removePlace', name: '削除', path: '/api/places/pl_01', init: { method: 'DELETE' }, status: 204 },
  { operationId: 'removePlace', name: '存在しない', path: '/api/places/none', init: { method: 'DELETE' }, status: 404 },
  { operationId: 'removePlace', name: '運営でない', path: '/api/places/pl_01', init: { method: 'DELETE' }, status: 401, bypass: false },
  { operationId: 'showLabels', name: '一覧', path: '/api/labels', status: 200 },
  { operationId: 'defineLabel', name: '定義', path: '/api/labels', init: post({ title: '展示' }), status: 201 },
  { operationId: 'defineLabel', name: '名前の重複', path: '/api/labels', init: post({ title: '飲食' }), status: 409 },
  { operationId: 'defineLabel', name: '運営でない', path: '/api/labels', init: post({ title: '展示' }), status: 401, bypass: false },
];
// SSE は JSON スキーマで検証できないので対象外にする。
const skipped = new Set(['watchChanges']);
let bindings: Env;

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
  await migrateTestDb();
});
afterAll(() => { vi.unstubAllGlobals(); });
async function seed() {
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
    env.DB.prepare("INSERT INTO labels (id, title) VALUES ('lb_food', '飲食')"),
  ]);
}

it('実装済みの全操作の成功・エラー応答が openapi に一致し、期待ステータスが固定され、未実装(501)の件数を出力する', async () => {
  const results: CoverageResult[] = [];
  const failures: string[] = [];
  const unchecked = new Set<string>();
  const check = async (operation: { operationId: string; method: string }, path: string, init: RequestInit, expected: number | null, ip: string, repeat = 1) => {
    let response!: Response;
    for (let i = 0; i < repeat; i++) {
      response = await requestWithEnv(path, { ...init, headers: { ...(init.headers as Record<string, string>), 'cf-connecting-ip': ip } }, bindings);
      if (i < repeat - 1) await response.arrayBuffer();
    }
    if (expected === null && response.status === 501) return 'unimplemented' as const;
    const text = await response.text();
    const contentType = response.headers.get('content-type');
    const body = text === '' ? undefined : contentType?.includes('json') ? JSON.parse(text) : text;
    const label = `${operation.operationId} ${path}`;
    if (expected !== null && response.status !== expected) failures.push(`${label}: 期待 ${expected}, 実際 ${response.status}`);
    const violations = validateResponse(spec, { method: operation.method, path, status: response.status, contentType, body, unchecked });
    if (violations.length > 0) failures.push(`${label} ${response.status}: ${JSON.stringify(violations)}`);
    return 'validated' as const;
  };
  let n = 0;
  for (const operation of listOperations(spec)) {
    if (skipped.has(operation.operationId)) { results.push({ operationId: operation.operationId, outcome: 'skipped' }); continue; }
    const planned = cases.filter(item => item.operationId === operation.operationId);
    let outcome: 'validated' | 'unimplemented' = 'validated';
    if (planned.length > 0) {
      for (const item of planned) {
        await seed();
        if (item.bypass === false) bindings = { ...bindings, ACCESS_BYPASS: 'false' };
        await check(operation, item.path, item.init ?? { method: operation.method }, item.status, item.ip ?? `192.0.2.${++n}`, item.repeat);
      }
    } else {
      await seed();
      const path = `/api${operation.path.replace(/\{([^}]+)\}/g, (_, name) => (name === 'floor' ? '1' : 'x'))}`;
      const body = operation.method === 'GET' || operation.method === 'DELETE' ? undefined : '{}';
      outcome = await check(operation, path, { method: operation.method, headers: json, body }, null, `192.0.2.${++n}`);
    }
    results.push({ operationId: operation.operationId, outcome });
  }
  const summary = reportCoverage(results, unchecked);
  expect(failures).toEqual([]);
  expect(new Set(cases.map(item => item.operationId)).size).toBe(7);
  expect(summary.validated).toBeGreaterThanOrEqual(7);
  expect(summary.skipped).toEqual(['watchChanges']);
  expect(summary.validated + summary.unimplemented.length + summary.skipped.length).toBe(listOperations(spec).length);
});
