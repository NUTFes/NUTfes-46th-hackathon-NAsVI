import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrap, loadCachedOrFetch } from './bootstrap';
import { loadSnapshot, saveSnapshot, setCacheStore, type Snapshot } from './cache';

const fetchMock = vi.fn<typeof fetch>();
const snapshot: Snapshot = {
  places: [{
    id: 'pl_food', name: '焼きそば屋台', kind: 'event',
    location: { lat: 37.4252, lng: 138.7788 }, description: '模擬店',
    landmarkId: null, floor: null, hours: [], labelIds: ['lb_food'],
  }],
  stamps: [{
    id: 'st_fun', kind: 'fun', at: { lat: 37.4252, lng: 138.7788 },
    pressedAt: '2026-11-28T01:00:00Z', expiresAt: '2026-11-28T07:00:00Z',
  }],
  landmarks: [{
    id: 'lm_a', name: 'A 棟', location: { lat: 37.4252, lng: 138.7788 },
    footprint: null, floors: [],
  }],
  labels: [{ id: 'lb_food', title: '飲食' }],
  cursor: '9',
};

function responseFor(url: RequestInfo | URL, placesCursor?: string, stampsCursor?: string) {
  switch (url) {
    case '/api/places': return Response.json({ items: snapshot.places, cursor: placesCursor });
    case '/api/stamps': return Response.json({ items: snapshot.stamps, cursor: stampsCursor });
    case '/api/landmarks': return Response.json({ items: snapshot.landmarks });
    case '/api/labels': return Response.json({ items: snapshot.labels });
    default: throw new Error(`Unexpected request: ${url}`);
  }
}

beforeEach(() => {
  setCacheStore();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url) => responseFor(url, '10', '9'));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_API_BASE', '');
});

afterEach(() => {
  setCacheStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('loadCachedOrFetch', () => {
  it('初回は全件を GET し、古い cursor と一緒に保存して返す', async () => {
    await expect(loadSnapshot()).resolves.toBeNull();
    await expect(loadCachedOrFetch()).resolves.toEqual(snapshot);
    await expect(loadSnapshot()).resolves.toEqual(snapshot);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const path of ['/places', '/stamps', '/landmarks', '/labels']) {
      expect(fetchMock).toHaveBeenCalledWith(`/api${path}`, {
        method: 'GET', headers: expect.any(Headers), body: undefined,
      });
    }
  });

  it.each(['9', null])('キャッシュ有りなら cursor=%s の一覧を取得せず返す', async (cursor) => {
    const cached = { ...snapshot, cursor };
    await saveSnapshot(cached);
    await expect(loadCachedOrFetch()).resolves.toEqual(cached);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('初回の取得に失敗したら、保存せずにエラーを返す', async () => {
    const error = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(error);
    await expect(loadCachedOrFetch()).rejects.toBe(error);
    await expect(loadSnapshot()).resolves.toBeNull();
  });
});

describe('bootstrap', () => {
  it('4 つの GET を応答を待たずに並列で開始する', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async (url) => {
      await gate;
      return responseFor(url, '9', '10');
    });

    const pending = bootstrap();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await expect(loadSnapshot()).resolves.toBeNull();
    release();
    await expect(pending).resolves.toEqual(snapshot);
    await expect(loadSnapshot()).resolves.toEqual(snapshot);
  });

  it('resync では既存キャッシュを取り直して上書きする', async () => {
    await saveSnapshot({ places: [], stamps: [], landmarks: [], labels: [], cursor: '1' });
    await expect(bootstrap()).resolves.toEqual(snapshot);
    await expect(loadSnapshot()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['9', '10', '9'],
    ['10', '9', '9'],
    ['9007199254740993', '9007199254740992', '9007199254740992'],
    [undefined, '10', null],
    ['10', undefined, null],
    [undefined, undefined, null],
  ])('応答の cursor: places=%s, stamps=%s → %s', async (places, stamps, cursor) => {
    fetchMock.mockImplementation(async (url) => responseFor(url, places, stamps));
    const expected = { ...snapshot, cursor };
    await expect(bootstrap()).resolves.toEqual(expected);
    await expect(loadSnapshot()).resolves.toEqual(expected);
  });

  it('一部の取得が失敗したら、キャッシュに戻らずエラーを返し、保存済みの値を保つ', async () => {
    const cached = { ...snapshot, cursor: '1' };
    await saveSnapshot(cached);
    const error = new TypeError('Failed to fetch');
    fetchMock.mockImplementation(async (url) => {
      if (url === '/api/labels') throw error;
      return responseFor(url, '10', '9');
    });
    await expect(bootstrap()).rejects.toBe(error);
    await expect(loadSnapshot()).resolves.toEqual(cached);
  });
});
