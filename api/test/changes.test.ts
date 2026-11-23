import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { commitWithChange } from '../src/lib/changes';
import { migrateTestDb } from './helpers';

const now = '2026-11-24T02:00:00.000Z';
const publish = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
let bindings: Env;

beforeAll(async () => { await migrateTestDb(); });
beforeEach(async () => {
  publish.mockReset();
  bindings = {
    ...env, NOW: now,
    HUB: { idFromName: vi.fn(() => 'main'), get: vi.fn(() => ({ fetch: publish })) } as unknown as Env['HUB'],
  };
  await env.DB.batch([env.DB.prepare('DELETE FROM changes'), env.DB.prepare('DELETE FROM meta')]);
});
afterEach(() => { vi.restoreAllMocks(); });

it('固定 payload は従来通り本体と履歴を 1 batch で保存・配信し、渡した値を返す', async () => {
  const payload = { version: 'fixed' };
  const batch = vi.spyOn(env.DB, 'batch');
  const result = await commitWithChange(bindings, [
    env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('app_version', payload.version),
  ], { type: 'appVersionChanged', payload });

  expect(result).toEqual({ changeId: expect.any(Number), payload });
  expect(result.changeId).toBeGreaterThan(0);
  expect(result.payload).toBe(payload);
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(2);
  expect(await env.DB.prepare("SELECT value FROM meta WHERE key = 'app_version'").first('value')).toBe('fixed');
  expect(await env.DB.prepare('SELECT * FROM changes WHERE id = ?').bind(result.changeId).first()).toEqual({
    id: result.changeId, type: 'appVersionChanged', payload: JSON.stringify(payload), created_at: now,
  });
  expect(bindings.HUB.idFromName).toHaveBeenCalledWith('main');
  expect(publish).toHaveBeenCalledExactlyOnceWith('http://hub/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: result.changeId, type: 'appVersionChanged', payload, createdAt: now }),
  });
});

it('payloadSql は同じ batch の更新後の値を本文にし、保存した JSON を配信・返却する', async () => {
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('app_version', 'old')").run();
  const batch = vi.spyOn(env.DB, 'batch');
  const prepare = vi.spyOn(env.DB, 'prepare');
  const result = await commitWithChange(bindings, [
    env.DB.prepare("UPDATE meta SET value = 'updated' WHERE key = 'app_version'"),
  ], {
    type: 'appVersionChanged',
    payloadSql: {
      sql: "SELECT json_object('version', value, 'source', ?) FROM meta WHERE key = ?",
      params: ['database', 'app_version'],
    },
  });

  const payload = { version: 'updated', source: 'database' };
  expect(result).toEqual({ changeId: expect.any(Number), payload });
  expect(batch).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls[0][0]).toHaveLength(2);
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(prepare).toHaveBeenLastCalledWith(expect.stringContaining('RETURNING payload'));
  const results = await batch.mock.results[0].value;
  expect(results[results.length - 1].results).toEqual([{ payload: JSON.stringify(payload) }]);
  expect(await env.DB.prepare('SELECT * FROM changes WHERE id = ?').bind(result.changeId).first()).toEqual({
    id: result.changeId, type: 'appVersionChanged', payload: JSON.stringify(payload), created_at: now,
  });
  expect(publish).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(publish.mock.calls[0][1]?.body))).toEqual({
    id: result.changeId, type: 'appVersionChanged', payload, createdAt: now,
  });
});

it('payloadSql が NULL を返すと NOT NULL 制約で batch 全体が失敗し、本体の更新もロールバックする', async () => {
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('app_version', 'old')").run();

  await expect(commitWithChange(bindings, [
    env.DB.prepare("UPDATE meta SET value = 'updated' WHERE key = 'app_version'"),
    env.DB.prepare("INSERT INTO meta (key, value) VALUES ('new_key', 'new_value')"),
  ], {
    type: 'appVersionChanged',
    payloadSql: { sql: 'SELECT NULL', params: [] },
  })).rejects.toThrow(/NOT NULL constraint failed: changes\.payload/);

  expect((await env.DB.prepare('SELECT key, value FROM meta').all()).results)
    .toEqual([{ key: 'app_version', value: 'old' }]);
  expect((await env.DB.prepare('SELECT * FROM changes').all()).results).toEqual([]);
  expect(publish).not.toHaveBeenCalled();
});

it('payloadSql の json_group_array は SQL の ORDER BY 順の配列を本文に保存・配信・返却する', async () => {
  const result = await commitWithChange(bindings, [
    env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('app_version', 'updated'),
    env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('source_first', 'alpha'),
    env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('source_last', 'zulu'),
  ], {
    type: 'appVersionChanged',
    payloadSql: {
      sql: `SELECT json_object('version', value, 'sources', (
        SELECT json_group_array(value) FROM (
          SELECT value FROM meta WHERE key IN (?, ?) ORDER BY value DESC
        )
      )) FROM meta WHERE key = ?`,
      params: ['source_first', 'source_last', 'app_version'],
    },
  });

  const payload = { version: 'updated', sources: ['zulu', 'alpha'] };
  expect(result).toEqual({ changeId: expect.any(Number), payload });
  expect(await env.DB.prepare('SELECT payload FROM changes WHERE id = ?').bind(result.changeId).first('payload'))
    .toBe(JSON.stringify(payload));
  expect(publish).toHaveBeenCalledExactlyOnceWith('http://hub/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: result.changeId, type: 'appVersionChanged', payload, createdAt: now }),
  });
});

it('payloadSql の last_insert_rowid() は同じ batch の最後の本体 INSERT を参照する', async () => {
  const previous = await commitWithChange(bindings, [], { type: 'appVersionChanged', payload: { version: 'previous' } });
  publish.mockClear();
  const result = await commitWithChange(bindings, [
    env.DB.prepare("INSERT INTO meta (rowid, key, value) VALUES (41, 'first', 'earlier')"),
    env.DB.prepare("INSERT INTO meta (rowid, key, value) VALUES (42, 'last', 'latest')"),
  ], {
    type: 'appVersionChanged',
    payloadSql: {
      sql: "SELECT json_object('version', value, 'rowId', rowid) FROM meta WHERE rowid = last_insert_rowid()",
      params: [],
    },
  });

  const payload = { version: 'latest', rowId: 42 };
  expect(result).toEqual({ changeId: previous.changeId + 1, payload });
  expect(result.changeId).not.toBe(42);
  expect(await env.DB.prepare('SELECT payload FROM changes WHERE id = ?').bind(result.changeId).first('payload'))
    .toBe(JSON.stringify(payload));
  expect(JSON.parse(String(publish.mock.calls[0][1]?.body))).toEqual({
    id: result.changeId, type: 'appVersionChanged', payload, createdAt: now,
  });
});

it.each(['fixed', 'sql'] as const)('%s payload は Hub の fetch が throw しても保存・返却に成功する', async mode => {
  publish.mockImplementation(async () => { throw new Error('publish failed'); });
  const payload = { version: 'committed' };
  const change = mode === 'fixed'
    ? { type: 'appVersionChanged' as const, payload }
    : { type: 'appVersionChanged' as const, payloadSql: { sql: 'SELECT ?', params: [JSON.stringify(payload)] } };
  const result = await commitWithChange(bindings, [], change);

  expect(result).toEqual({ changeId: expect.any(Number), payload });
  expect(await env.DB.prepare('SELECT payload FROM changes WHERE id = ?').bind(result.changeId).first('payload'))
    .toBe(JSON.stringify(payload));
  expect(publish).toHaveBeenCalledTimes(1);
});

it.each(['fixed', 'sql'] as const)('%s payload は ctx があれば publish の完了を待たず waitUntil に渡す', async mode => {
  const ctx = createExecutionContext();
  const waitUntil = vi.spyOn(ctx, 'waitUntil');
  let finish!: (response: Response) => void;
  publish.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  const payload = { version: 'background' };
  const change = mode === 'fixed'
    ? { type: 'appVersionChanged' as const, payload }
    : { type: 'appVersionChanged' as const, payloadSql: { sql: 'SELECT ?', params: [JSON.stringify(payload)] } };

  try {
    const result = await commitWithChange(bindings, [], change, ctx);
    expect(result).toEqual({ changeId: expect.any(Number), payload });
    expect(waitUntil).toHaveBeenCalledExactlyOnceWith(expect.any(Promise));
    expect(JSON.parse(String(publish.mock.calls[0][1]?.body))).toEqual({
      id: result.changeId, type: 'appVersionChanged', payload, createdAt: now,
    });
  } finally {
    finish?.(new Response(null, { status: 204 }));
    await waitOnExecutionContext(ctx);
  }
});
