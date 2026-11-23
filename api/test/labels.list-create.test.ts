import { env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { components } from '../src/schema';
import { migrateTestDb, operatorEnv, request, requestAsOperator, requestWithEnv } from './helpers';

type Label = components['schemas']['Label'];

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('External network is disabled in tests'))));
  await migrateTestDb();
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM place_labels'),
    env.DB.prepare('DELETE FROM labels'),
    env.DB.prepare('DELETE FROM changes'),
  ]);
});

afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => { vi.unstubAllGlobals(); });

const post = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function expectProblem(response: Response, status: number, code: string, field?: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toBe('application/problem+json');
  expect(await response.json()).toEqual({
    code, message: expect.any(String), ...(field === undefined ? {} : { field }),
  });
}

it('GET /api/labels は認証なしで空の一覧を返す', async () => {
  const response = await request('/api/labels');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ items: [] });
});

it('GET /api/labels は全件の id と title を返す', async () => {
  const labels: Label[] = [{ id: 'lb_food', title: '飲食' }, { id: 'lb_stage', title: 'ステージ' }];
  await env.DB.batch(labels.map(label =>
    env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?)').bind(label.id, label.title)));

  const response = await request('/api/labels');
  expect(response.status).toBe(200);
  const body = await response.json() as components['schemas']['LabelList'];
  expect(Object.keys(body)).toEqual(['items']);
  expect(body.items).toHaveLength(labels.length);
  expect(body.items).toEqual(expect.arrayContaining(labels));
});

it('運営は種類を作成でき、201 の応答と DB・一覧の値が一致する', async () => {
  const response = await requestAsOperator('/api/labels', post({ title: '飲食' }));
  expect(response.status).toBe(201);
  expect(response.headers.get('content-type')).toContain('application/json');
  const label = await response.json() as Label;
  expect(label).toEqual({ id: expect.any(String), title: '飲食' });
  expect(label.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(await env.DB.prepare('SELECT id, title FROM labels WHERE id = ?').bind(label.id).first()).toEqual(label);
  expect(await (await request('/api/labels')).json()).toEqual({ items: [label] });
  expect(await env.DB.prepare('SELECT COUNT(*) FROM changes').first('COUNT(*)')).toBe(0);
});

it('作成の応答には書き込み後の DB の値を使う', async () => {
  await env.DB.prepare(`CREATE TRIGGER labels_saved_title AFTER INSERT ON labels BEGIN
    UPDATE labels SET title = '保存後の名前' WHERE id = NEW.id;
  END`).run();
  try {
    const response = await requestAsOperator('/api/labels', post({ title: '入力の名前' }));
    expect(response.status).toBe(201);
    const label = await response.json() as Label;
    expect(label.title).toBe('保存後の名前');
    expect(await env.DB.prepare('SELECT id, title FROM labels WHERE id = ?').bind(label.id).first()).toEqual(label);
  } finally {
    await env.DB.prepare('DROP TRIGGER labels_saved_title').run();
  }
});

it.each(['展', 'あ'.repeat(20), '😀'.repeat(20)])('1〜20文字の名前を受け付ける: %s', async title => {
  const response = await requestAsOperator('/api/labels', post({ title }));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ id: expect.any(String), title });
});

it('名前は空白や全角・半角を変換せず保存し、未知の項目は応答に含めない', async () => {
  const title = ' Ｆｏｏｄ ';
  const response = await requestAsOperator('/api/labels', post({ title, id: 'client-id', owner: 'ignored' }));
  expect(response.status).toBe(201);
  const label = await response.json() as Label;
  expect(label).toEqual({ id: expect.any(String), title });
  expect(label.id).not.toBe('client-id');
  expect(await env.DB.prepare('SELECT id, title FROM labels').first()).toEqual(label);
});

it('同名の作成は 409 label_title_taken で、既存の種類を変更しない', async () => {
  await env.DB.prepare('INSERT INTO labels (id, title) VALUES (?, ?)').bind('existing', '飲食').run();
  const response = await requestAsOperator('/api/labels', post({ title: '飲食' }));
  await expectProblem(response, 409, 'label_title_taken');
  expect((await env.DB.prepare('SELECT id, title FROM labels').all()).results).toEqual([{ id: 'existing', title: '飲食' }]);
});

it('同名を同時に作成しても成功は1件で、もう1件は409になる', async () => {
  const responses = await Promise.all([
    requestAsOperator('/api/labels', post({ title: '展示' })),
    requestAsOperator('/api/labels', post({ title: '展示' })),
  ]);
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
  const success = await responses.find(response => response.status === 201)!.json() as Label;
  await expectProblem(responses.find(response => response.status === 409)!, 409, 'label_title_taken');
  expect((await env.DB.prepare('SELECT id, title FROM labels').all()).results).toEqual([success]);
});

it('引用符を含む名前をそのまま保存し、重複も検出する', async () => {
  const title = "food');--";
  const response = await requestAsOperator('/api/labels', post({ title }));
  expect(response.status).toBe(201);
  const label = await response.json() as Label;
  expect(label.title).toBe(title);
  await expectProblem(await requestAsOperator('/api/labels', post({ title })), 409, 'label_title_taken');
  expect((await env.DB.prepare('SELECT id, title FROM labels').all()).results).toEqual([label]);
});

it.each([
  { name: 'title がない', body: {} },
  { name: '未知の項目だけ', body: { unknown: '飲食' } },
  { name: '空文字', body: { title: '' } },
  { name: '21文字', body: { title: 'あ'.repeat(21) } },
  { name: '21コードポイント', body: { title: '😀'.repeat(21) } },
  { name: 'null の title', body: { title: null } },
  { name: '数値の title', body: { title: 1 } },
  { name: '真偽値の title', body: { title: true } },
  { name: '配列の title', body: { title: ['飲食'] } },
  { name: 'オブジェクトの title', body: { title: {} } },
  { name: 'null の本文', body: null },
  { name: '文字列の本文', body: '飲食' },
  { name: '数値の本文', body: 1 },
  { name: '真偽値の本文', body: false },
  { name: '配列の本文', body: [{ title: '飲食' }] },
])('$name は 400 invalid_input', async ({ body }) => {
  await expectProblem(await requestAsOperator('/api/labels', post(body)), 400, 'invalid_input', 'title');
  expect(await env.DB.prepare('SELECT COUNT(*) FROM labels').first('COUNT(*)')).toBe(0);
});

it.each(['', '{', '{"title":'])('欠落または不正な JSON は 400: %j', async body => {
  const response = await requestAsOperator('/api/labels', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  await expectProblem(response, 400, 'invalid_input');
  expect(await env.DB.prepare('SELECT COUNT(*) FROM labels').first('COUNT(*)')).toBe(0);
});

it.each([undefined, 'false', 'TRUE', '1'])('運営の迂回が %s のとき、未認証の作成は401', async bypass => {
  const bindings = { ...env, ACCESS_BYPASS: bypass };
  const response = await requestWithEnv('/api/labels', post({ title: '飲食' }), bindings);
  await expectProblem(response, 401, 'unauthorized');
  expect(await env.DB.prepare('SELECT COUNT(*) FROM labels').first('COUNT(*)')).toBe(0);
});

it('未認証なら不正な本文も検査せず401を返す', async () => {
  const response = await requestWithEnv('/api/labels', { method: 'POST', body: '{' }, { ...env, ACCESS_BYPASS: undefined });
  await expectProblem(response, 401, 'unauthorized');
});

it.each(['GET', 'POST'])('%s の DB 障害は 500 internal_error', async method => {
  vi.spyOn(env.DB, 'prepare').mockImplementationOnce(() => { throw new Error('database unavailable'); });
  const response = await requestWithEnv('/api/labels', method === 'POST' ? post({ title: '飲食' }) : {}, operatorEnv());
  await expectProblem(response, 500, 'internal_error');
});
