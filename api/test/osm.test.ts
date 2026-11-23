import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchFootprint } from '../src/osm';

const location = { lat: 37.4246, lng: 138.7779 };
const footprint = [
  { lat: 37.42465, lng: 138.77785 }, { lat: 37.42465, lng: 138.77795 },
  { lat: 37.42455, lng: 138.77795 }, { lat: 37.42455, lng: 138.77785 },
];
// Fixed Overpass JSON fixtures. No test falls through to the real fetch.
const way = {
  type: 'way', id: 101, tags: { building: 'yes' },
  geometry: [
    { lat: 37.42465, lon: 138.77785 }, { lat: 37.42465, lon: 138.77795 },
    { lat: 37.42455, lon: 138.77795 }, { lat: 37.42455, lon: 138.77785 },
    { lat: 37.42465, lon: 138.77785 },
  ],
};
const largerWay = {
  type: 'way', id: 102, tags: { building: 'university' },
  geometry: [
    { lat: 37.4248, lon: 138.7776 }, { lat: 37.4248, lon: 138.7782 },
    { lat: 37.4244, lon: 138.7782 }, { lat: 37.4244, lon: 138.7776 },
    { lat: 37.4248, lon: 138.7776 },
  ],
};
const relation = {
  type: 'relation', id: 201, tags: { type: 'multipolygon', building: 'yes' },
  members: [
    { type: 'way', ref: 301, role: 'outer', geometry: [
      { lat: 37.42465, lon: 138.77785 }, { lat: 37.42465, lon: 138.77795 },
      { lat: 37.42455, lon: 138.77795 },
    ] },
    // Reversed: joining the two members must reverse this one.
    { type: 'way', ref: 302, role: 'outer', geometry: [
      { lat: 37.42465, lon: 138.77785 }, { lat: 37.42455, lon: 138.77785 },
      { lat: 37.42455, lon: 138.77795 },
    ] },
  ],
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset().mockRejectedValue(new Error('External network is disabled in tests'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function respond(elements: unknown[]) {
  fetchMock.mockResolvedValueOnce(Response.json({ version: 0.6, elements }));
}

it('位置を含む建物の頂点を3点以上返し、末尾の重複点とlonを除く', async () => {
  respond([way]);
  const result = await fetchFootprint(location);
  expect(result).toEqual(footprint);
  expect(result!.length).toBeGreaterThanOrEqual(3);
  expect(result![0]).not.toEqual(result![result!.length - 1]);
});

it('OverpassへPOSTを1回だけ送り、User-Agent・位置・around・out geom・timeoutを指定する', async () => {
  respond([way]);
  await fetchFootprint(location);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://overpass-api.de/api/interpreter');
  expect(init?.method).toBe('POST');
  expect(init?.redirect).toBe('error');
  const headers = new Headers(init?.headers);
  expect(headers.get('User-Agent')).toBe('NASVI/1.0 (building footprint retrieval)');
  expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
  const query = new URLSearchParams(String(init?.body)).get('data')!;
  expect(query).toContain('way["building"](around:10,37.4246,138.7779)');
  expect(query).toContain('relation["building"](around:10,37.4246,138.7779)');
  expect(query).toContain('out geom;');
  expect(query).toContain('[timeout:8]');
  expect(query).not.toContain('is_in');
  expect(init?.signal?.aborted).toBe(false);
});

it.each([[largerWay, way], [way, largerWay]])('候補の順序によらず位置を含む面積最小の輪郭を選ぶ (%#)', async (...elements) => {
  respond(elements);
  expect(await fetchFootprint(location)).toEqual(footprint);
});

it('近傍にあっても位置を含まない輪郭は選ばない', async () => {
  respond([way]);
  expect(await fetchFootprint({ lat: 37.42466, lng: 138.7779 })).toBeNull();
});

it('辺や頂点に位置が一致する建物も選ぶ', async () => {
  respond([way]);
  expect(await fetchFootprint({ lat: 37.42465, lng: 138.7779 })).toEqual(footprint);
  respond([way]);
  expect(await fetchFootprint(footprint[0])).toEqual(footprint);
});

it('relationの分割されたouterを向きを合わせて結合する', async () => {
  respond([relation]);
  expect(await fetchFootprint(location)).toEqual(footprint);
});

it('relationのinner（中庭）の内部は建物として選ばない', async () => {
  respond([{ ...relation, members: [...relation.members, { type: 'way', ref: 303, role: 'inner', geometry: [
    { lat: 37.42461, lon: 138.77789 }, { lat: 37.42461, lon: 138.77791 },
    { lat: 37.42459, lon: 138.77791 }, { lat: 37.42459, lon: 138.77789 },
    { lat: 37.42461, lon: 138.77789 },
  ] }] }]);
  expect(await fetchFootprint(location)).toBeNull();
});

it('中庭の外側はrelationのouterを返す', async () => {
  respond([{ ...relation, members: [...relation.members, { type: 'way', ref: 303, role: 'inner', geometry: [
    { lat: 37.42461, lon: 138.77789 }, { lat: 37.42461, lon: 138.77791 },
    { lat: 37.42459, lon: 138.77791 }, { lat: 37.42459, lon: 138.77789 },
    { lat: 37.42461, lon: 138.77789 },
  ] }] }]);
  expect(await fetchFootprint({ lat: 37.42463, lng: 138.7779 })).toEqual(footprint);
});

it.each([
  ['結果なし', []],
  ['頂点が3点未満', [{ ...way, geometry: [way.geometry[0], way.geometry[1], way.geometry[0]] }]],
  ['閉じていないway', [{ ...way, geometry: way.geometry.slice(0, -1) }]],
  ['閉じていないrelation', [{ ...relation, members: relation.members.slice(0, 1) }]],
  ['不正な頂点', [{ ...way, geometry: [way.geometry[0], null, ...way.geometry.slice(1)] }]],
  ['緯度が範囲外', [{ ...way, geometry: [{ lat: 91, lon: 138 }, ...way.geometry] }]],
  ['建物以外', [{ ...way, tags: { amenity: 'parking' } }]],
  ['building=no', [{ ...way, tags: { building: 'no' } }]],
] as const)('%sはnullを返す', async (_name, elements) => {
  respond([...elements]);
  expect(await fetchFootprint(location)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([429, 500, 504])('HTTP %iは再試行せずnullを返す', async status => {
  fetchMock.mockResolvedValueOnce(new Response('unavailable', { status }));
  expect(await fetchFootprint(location)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('通信エラーはthrowせず再試行せずnullを返す', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Connection failed'));
  expect(await fetchFootprint(location)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(['invalid json', 'null', '{}', '{"elements":{}}'])('不正な応答 (%s) はnullを返す', async body => {
  fetchMock.mockResolvedValueOnce(new Response(body));
  expect(await fetchFootprint(location)).toBeNull();
});

it('Overpassのruntime errorを含む部分結果はnullを返す', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ elements: [way], remark: 'runtime error: Query timed out' }));
  expect(await fetchFootprint(location)).toBeNull();
});

it('8秒でAbortControllerが通信を中止し、nullを返す', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  }));
  const pending = fetchFootprint(location);
  const signal = fetchMock.mock.calls[0][1]!.signal!;
  await vi.advanceTimersByTimeAsync(7_999);
  expect(signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal.aborted).toBe(true);
  expect(await pending).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('本文の読み取り中にも8秒のtimeoutを適用する', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementationOnce(async (_input, init) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
    }),
  } as unknown as Response));
  const pending = fetchFootprint(location);
  await vi.advanceTimersByTimeAsync(8_000);
  expect(await pending).toBeNull();
  expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('成功と通信エラーのどちらもtimeoutのタイマーを解除する', async () => {
  vi.useFakeTimers();
  respond([way]);
  expect(await fetchFootprint(location)).toEqual(footprint);
  expect(vi.getTimerCount()).toBe(0);
  expect(await fetchFootprint(location)).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it('不正な入力座標では通信しない', async () => {
  expect(await fetchFootprint({ lat: NaN, lng: location.lng })).toBeNull();
  expect(await fetchFootprint({ lat: 91, lng: location.lng })).toBeNull();
  expect(await fetchFootprint({ lat: location.lat, lng: 181 })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
