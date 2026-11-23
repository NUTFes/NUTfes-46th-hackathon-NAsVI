import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { components } from './generated/schema';
import { ApiError, apiGet, apiSend } from './client';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_API_BASE', '');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('apiGet', () => {
  it('既定の /api から JSON と cursor を受け取る', async () => {
    const data: components['schemas']['PlaceList'] = { items: [], cursor: '120' };
    fetchMock.mockResolvedValue(jsonResponse(data));

    const result = await apiGet('/places');

    expectTypeOf(result).toEqualTypeOf<components['schemas']['PlaceList']>();
    expect(result).toEqual(data);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/places', {
      method: 'GET',
      headers: expect.any(Headers),
      body: undefined,
    });
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('Accept')).toBe('application/json, application/problem+json');
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('検索語の日本語と予約文字をクエリーとして符号化する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));
    await apiGet('/places/search', { query: { q: '焼きそば & +?' } });

    const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://web.example');
    expect(url.pathname).toBe('/api/places/search');
    expect(url.searchParams.get('q')).toBe('焼きそば & +?');
    expect([...url.searchParams.keys()]).toEqual(['q']);
  });

  it('パス変数を符号化する', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ landmark: {}, items: [] }));
    await apiGet('/landmarks/{landmarkId}/places', { params: { landmarkId: '棟/a?#' } });

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/landmarks/${encodeURIComponent('棟/a?#')}/places`);
  });

  it.each(['/custom/api', 'https://api.example/api', 'https://api.example/api/'])(
    'VITE_API_BASE=%s を使う',
    async (base) => {
      vi.stubEnv('VITE_API_BASE', base);
      fetchMock.mockResolvedValue(jsonResponse({ items: [] }));
      await apiGet('/labels');

      expect(fetchMock.mock.calls[0][0]).toBe(`${base.replace(/\/+$/, '')}/labels`);
    },
  );

  it('ヘッダー、credentials、AbortSignal を fetch に渡す', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));
    await apiGet('/labels', {
      headers: new Headers({ 'X-Request-ID': 'test-request', Accept: 'application/json' }),
      credentials: 'include',
      signal: controller.signal,
    });

    const init = fetchMock.mock.calls[0][1]!;
    expect(new Headers(init.headers).get('X-Request-ID')).toBe('test-request');
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
    expect(init.credentials).toBe('include');
    expect(init.signal).toBe(controller.signal);
  });
});

describe('apiSend', () => {
  it('生成型の入力を JSON で POST し、201 の proof を受け取る', async () => {
    const body: components['schemas']['StampInput'] = {
      kind: 'fun', at: { lat: 37.4252, lng: 138.7788 },
    };
    const pressed: components['schemas']['PressedStamp'] = {
      ...body,
      id: 'st_test',
      pressedAt: '2026-11-28T01:00:00Z',
      expiresAt: '2026-11-28T07:00:00Z',
      proof: 'test-proof',
    };
    fetchMock.mockResolvedValue(jsonResponse(pressed, 201));

    const result = await apiSend('POST', '/stamps', { body });

    expectTypeOf(result).toEqualTypeOf<components['schemas']['PressedStamp']>();
    expect(result).toEqual(pressed);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/stamps');
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(body));
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('PATCH で渡した項目だけを送る', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'pl_test', name: '更新後' }));
    await apiSend('PATCH', '/places/{placeId}', {
      params: { placeId: 'pl_test' }, body: { name: '更新後' },
    });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/places/pl_test');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH');
    expect(fetchMock.mock.calls[0][1]?.body).toBe('{"name":"更新後"}');
  });

  it('本文のない PUT と複数のパス変数を扱う', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiSend('PUT', '/places/{placeId}/labels/{labelId}', {
      params: { placeId: 'pl_test', labelId: 'lb_test' },
    })).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/places/pl_test/labels/lb_test');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT');
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  });

  it.each<HeadersInit>([
    { 'X-Stamp-Proof': 'test-proof' },
    [['X-Stamp-Proof', 'test-proof']],
    new Headers({ 'X-Stamp-Proof': 'test-proof' }),
  ])('X-Stamp-Proof を渡し、204 は JSON として読まない: %o', async (headers) => {
    const response = new Response(null, { status: 204 });
    const json = vi.spyOn(response, 'json');
    fetchMock.mockResolvedValue(response);

    const result = await apiSend('DELETE', '/stamps/{stampId}', {
      params: { stampId: 'st_test' }, headers,
    });

    expectTypeOf(result).toEqualTypeOf<void>();
    expect(result).toBeUndefined();
    expect(json).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/stamps/st_test');
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get('X-Stamp-Proof')).toBe('test-proof');
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('本文のない POST でも JSON 応答を受け取れる', async () => {
    const data = { id: 'lm_test', name: 'A 棟', location: { lat: 37.4252, lng: 138.7788 }, footprint: null, floors: [] };
    fetchMock.mockResolvedValue(jsonResponse(data));
    await expect(apiSend('POST', '/landmarks/{landmarkId}/footprint', {
      params: { landmarkId: 'lm_test' },
    })).resolves.toEqual(data);
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  });
});

describe.each([
  ['apiGet', () => apiGet('/labels')],
  ['apiSend', () => apiSend('POST', '/labels', { body: { title: '飲食' } })],
] as const)('%s のエラー', (_name, invoke) => {
  it.each([
    [400, { code: 'invalid_input', message: '名前を入れてください', field: 'name' }],
    [403, { code: 'not_stamp_owner', message: 'このスタンプは取り消せません' }],
    [429, { code: 'too_many_requests', message: 'しばらく待ってください' }],
  ] as const)('problem+json を ApiError にする: %s', async (status, problem) => {
    fetchMock.mockResolvedValue(jsonResponse(problem, status, 'application/problem+json; charset=utf-8'));
    const error = await invoke().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'ApiError', ...problem, status });
    expect((error as ApiError).field).toBe('field' in problem ? problem.field : undefined);
  });

  it.each([
    ['text/html', '<html>Bad Gateway</html>'],
    ['application/problem+json', '{invalid json'],
    ['application/problem+json', '{"code":"invalid_input"}'],
    ['application/problem+json', '{"code":123,"message":"不正"}'],
    ['application/problem+json', 'null'],
    ['application/problem+json', ''],
  ])('契約外の応答でも HTTP ステータスを残す: %s %s', async (contentType, body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 502, headers: { 'Content-Type': contentType } }));
    const error = await invoke().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'internal_error', status: 502 });
    expect((error as ApiError).message).toBe('時間をおいて、もう一度試してください');
  });

  it('ネットワークエラーは同じエラーをそのまま返す', async () => {
    const error = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(error);
    await expect(invoke()).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('通信の中断は AbortError のまま返す', async () => {
    const error = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValue(error);
    await expect(invoke()).rejects.toBe(error);
  });
});

it('経路・メソッド・入力・戻り値の型を生成型で制約する', () => {
  expectTypeOf(apiGet<'/labels'>).returns.toEqualTypeOf<Promise<components['schemas']['LabelList']>>();
  expectTypeOf(apiSend<'PUT', '/landmarks/{landmarkId}/floors/{floor}/plan'>)
    .returns.toEqualTypeOf<Promise<components['schemas']['FloorPlan']>>();

  // 実行しない。vue-tsc によって不正な呼び出しが拒否されることを検査する。
  const invalidCalls = () => {
    // @ts-expect-error 未定義の経路
    apiGet('/missing');
    // @ts-expect-error SSE は JSON ではない
    apiGet('/changes');
    // @ts-expect-error この経路に GET はない
    apiGet('/places/{placeId}', { params: { placeId: 'pl_test' } });
    // @ts-expect-error 検索の必須クエリーがない
    apiGet('/places/search');
    // @ts-expect-error 必須の本文がない
    apiSend('POST', '/labels');
    // @ts-expect-error title は文字列
    apiSend('POST', '/labels', { body: { title: 1 } });
    // @ts-expect-error StampInput にない種類
    apiSend('POST', '/stamps', { body: { kind: 'unknown', at: { lat: 0, lng: 0 } } });
    // @ts-expect-error パス変数がない
    apiSend('DELETE', '/stamps/{stampId}');
    // @ts-expect-error この経路に PUT はない
    apiSend('PUT', '/labels', { body: { title: '飲食' } });
    // @ts-expect-error GET に本文は渡せない
    apiGet('/labels', { body: {} });
    // @ts-expect-error DELETE に本文はない
    apiSend('DELETE', '/labels/{labelId}', { params: { labelId: 'lb_test' }, body: {} });
  };
  expectTypeOf(invalidCalls).toBeFunction();
});
