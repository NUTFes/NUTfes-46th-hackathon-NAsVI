import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { apiGet, apiSend } from '../api/client';
import { adminGet, adminSend, ApiError } from './client';

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200, contentType = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_API_BASE', '');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('運営用クライアント', () => {
  it('GET に cookie を付け、既存のクエリー・ヘッダー・signal を維持する', async () => {
    const controller = new AbortController();
    const data = { items: [] };
    fetchMock.mockResolvedValue(json(data));

    await expect(adminGet('/places/search', {
      query: { q: '屋台 & 展示' }, signal: controller.signal,
      headers: { 'X-Request-ID': 'test-request' }, credentials: 'omit',
    })).resolves.toEqual(data);

    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(String(url), 'https://test.invalid').searchParams.get('q')).toBe('屋台 & 展示');
    expect(options).toMatchObject({ method: 'GET', credentials: 'include', signal: controller.signal });
    const headers = new Headers(options?.headers);
    expect(headers.get('X-Request-ID')).toBe('test-request');
    expect(headers.has('Cf-Access-Jwt-Assertion')).toBe(false);
    expect(headers.has('Authorization')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('オプションを省略しても GET に cookie を付ける', async () => {
    fetchMock.mockResolvedValue(json({ items: [] }));
    await adminGet('/labels');
    expect(fetchMock).toHaveBeenCalledWith('/api/labels', expect.objectContaining({ credentials: 'include' }));
  });

  it('POST の本文を既存クライアントへ渡し、cookie を付ける', async () => {
    const label = { id: 'label-test', title: '飲食' };
    fetchMock.mockResolvedValue(json(label, 201));
    await expect(adminSend('POST', '/labels', { body: { title: '飲食' } })).resolves.toEqual(label);
    expect(fetchMock).toHaveBeenCalledWith('/api/labels', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify({ title: '飲食' }),
    }));
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.has('Cf-Access-Jwt-Assertion')).toBe(false);
  });

  it('パス変数と本文のない DELETE / 204 を引き継ぐ', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(adminSend('DELETE', '/labels/{labelId}', {
      params: { labelId: '種類/a' }, credentials: 'same-origin',
    })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`/api/labels/${encodeURIComponent('種類/a')}`,
      expect.objectContaining({ method: 'DELETE', credentials: 'include', body: undefined }));
  });

  it('経路・メソッド・必須入力・戻り値の型を既存クライアントと同じに保つ', () => {
    expectTypeOf(adminGet).toEqualTypeOf<typeof apiGet>();
    expectTypeOf(adminSend).toEqualTypeOf<typeof apiSend>();
    const invalidCalls = () => {
      // @ts-expect-error 未定義の経路は増やさない
      adminGet('/admin/places');
      // @ts-expect-error POST の必須本文を省略できない
      adminSend('POST', '/labels');
      // @ts-expect-error API で決まった入力型を使う
      adminSend('POST', '/labels', { body: { title: 123 } });
    };
    expectTypeOf(invalidCalls).toBeFunction();
  });
});

describe.each([
  ['GET', () => adminGet('/labels')],
  ['POST', () => adminSend('POST', '/labels', { body: { title: '飲食' } })],
] as const)('%s の失敗', (_method, request) => {
  it.each([
    [401, { code: 'unauthorized', message: '運営としてログインしてください' }],
    [400, { code: 'invalid_input', message: '種類を入力してください', field: 'title' }],
    [409, { code: 'label_title_taken', message: '同じ名前の種類があります' }],
  ] as const)('%i の problem+json を ApiError のまま呼び出し元へ返す', async (status, problem) => {
    fetchMock.mockResolvedValue(json(problem, status, 'application/problem+json; charset=utf-8'));
    const error: unknown = await request().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ ...problem, status });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 認証や更新を自動再試行しない
  });

  it('HTML の 401 でも ApiError のステータスを失わない', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Access</html>', {
      status: 401, headers: { 'Content-Type': 'text/html' },
    }));
    await expect(request()).rejects.toMatchObject({ status: 401, code: 'internal_error' });
  });

  it.each([new TypeError('Failed to fetch'), new DOMException('Aborted', 'AbortError')])(
    '通信失敗・中断は変換せず返す: %s', async (error) => {
      fetchMock.mockRejectedValue(error);
      await expect(request()).rejects.toBe(error);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
