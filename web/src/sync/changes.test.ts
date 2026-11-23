import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectChanges, type ConnectChangesOptions } from './changes';

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  close = vi.fn();

  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }

  emit(type: string, data = '{}', lastEventId = '') {
    // close 済みの接続から遅れて届くイベントも再現できる。
    this.dispatchEvent(new MessageEvent(type, { data, lastEventId }));
  }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

const fetchMock = vi.fn<typeof fetch>();
const random = vi.fn<() => number>();
const onEvent = vi.fn<ConnectChangesOptions['onEvent']>();
const onResync = vi.fn<ConnectChangesOptions['onResync']>();
let visibility: FakeDocument;
let connections: ReturnType<typeof connectChanges>[];

function start(options: Partial<ConnectChangesOptions> = {}) {
  const connection = connectChanges({
    since: '120', onEvent, onResync,
    EventSource: FakeEventSource, fetch: fetchMock, random, document: visibility,
    ...options,
  });
  connections.push(connection);
  return connection;
}

function latest() {
  return FakeEventSource.instances[FakeEventSource.instances.length - 1];
}

async function fail() {
  latest().emit('error');
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  visibility = new FakeDocument();
  connections = [];
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
  random.mockReset().mockReturnValue(0);
  onEvent.mockReset();
  onResync.mockReset();
  // 注入を忘れた場合も実ネットワークに出さない。
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  for (const connection of connections) connection.close();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connectChanges のイベント', () => {
  it('since で接続し、既知の全 type の data を JSON として渡す', () => {
    start();
    expect(latest().url).toBe('/api/changes?since=120');
    expect(fetchMock).not.toHaveBeenCalled();
    const types = [
      'stampPressed', 'stampRetracted', 'placeAdded', 'placeUpdated', 'placeRemoved',
      'appVersionChanged',
    ];
    types.forEach((type, index) => {
      const payload = { id: `item-${index}`, nested: { value: index } };
      latest().emit(type, JSON.stringify(payload), String(121 + index));
      expect(onEvent).toHaveBeenNthCalledWith(index + 1, { id: 121 + index, type, payload });
    });
    expect(onEvent).toHaveBeenCalledTimes(types.length);
  });

  it('未知の type と通常の message は無視し、最後の既知 id で再接続する', async () => {
    start();
    latest().emit('placeAdded', '{"id":"pl_01"}', '121');
    latest().emit('futureChange', '{}', '999');
    latest().emit('message', '{}', '1000');
    await fail();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/changes?since=121');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(latest().url).toBe('/api/changes?since=121');
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      id: 121, type: 'placeAdded', payload: { id: 'pl_01' },
    });
  });

  it('不正な JSON・id は通知せず cursor も進めない', async () => {
    start();
    latest().emit('placeUpdated', 'broken', '121');
    for (const id of ['', 'abc', '-1', '1.5', '9007199254740992']) {
      latest().emit('placeUpdated', '{}', id);
    }
    expect(onEvent).not.toHaveBeenCalled();
    await fail();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(latest().url).toBe('/api/changes?since=120');
  });

  it('resync は接続を閉じてから一度通知し、自動再接続しない', async () => {
    const remove = vi.spyOn(visibility, 'removeEventListener');
    start();
    const source = latest();
    onResync.mockImplementation(() => expect(source.close).toHaveBeenCalledOnce());
    source.emit('resync');
    source.emit('resync');
    source.emit('error');
    source.emit('placeAdded', '{}', '121');
    visibility.setVisibility('hidden');
    visibility.setVisibility('visible');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onResync).toHaveBeenCalledOnce();
    expect(onEvent).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('再接続の待ち', () => {
  it('error で即座に閉じ、指数的な待ちを60秒で頭打ちにする', async () => {
    start();
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000];
    for (const [index, delay] of delays.entries()) {
      const source = latest();
      source.emit('error');
      expect(source.close).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeEventSource.instances).toHaveLength(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeEventSource.instances).toHaveLength(index + 2);
      expect(fetchMock).toHaveBeenCalledTimes(index + 1);
    }
  });

  it.each([0, 0.25, 0.5, 0.9999, 1])('random=%s の揺らぎは0〜10秒の範囲', async (value) => {
    random.mockReturnValue(value);
    start();
    await fail();
    const jitter = value * 10_000;
    expect(jitter).toBeGreaterThanOrEqual(0);
    expect(jitter).toBeLessThanOrEqual(10_000);
    await vi.advanceTimersByTimeAsync(1_000 + jitter - 1);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('上限60秒を適用した後も揺らぎを足す', async () => {
    random.mockReturnValue(0.5);
    start();
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000]) {
      const count = FakeEventSource.instances.length;
      await fail();
      await vi.advanceTimersByTimeAsync(delay + 4_999);
      expect(FakeEventSource.instances).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeEventSource.instances).toHaveLength(count + 1);
    }
  });

  it('open で失敗回数をリセットする', async () => {
    start();
    await fail();
    await vi.advanceTimersByTimeAsync(1_000);
    await fail();
    await vi.advanceTimersByTimeAsync(2_000);
    latest().emit('open');
    await fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it('古い接続の error・open・イベント・resync は無視する', async () => {
    start();
    const old = latest();
    await fail();
    await vi.advanceTimersByTimeAsync(1_000);
    old.emit('error');
    old.emit('open');
    old.emit('placeAdded', '{}', '999');
    old.emit('resync');
    await fail();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(FakeEventSource.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(latest().url).toBe('/api/changes?since=120');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onResync).not.toHaveBeenCalled();
  });
});

describe('429 のプローブ', () => {
  it.each([
    ['20', 20_000],
    ['1', 6_000],
  ])('Retry-After=%s 秒を通常の待ちの下限とする', async (seconds, delay) => {
    random.mockReturnValue(0.5);
    fetchMock.mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': seconds } }));
    start();
    await fail();
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it.each([null, '', '-1', 'invalid'])('429 の Retry-After=%s が使えなければ通常の待ち', async (seconds) => {
    const headers = new Headers();
    if (seconds !== null) headers.set('Retry-After', seconds);
    fetchMock.mockResolvedValue(new Response(null, { status: 429, headers }));
    start();
    await fail();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it.each([200, 500])('%s のヘッダーを得たら本文を読まず中断し、Retry-After は使わない', async (status) => {
    const response = new Response('unread', { status, headers: { 'Retry-After': '90' } });
    fetchMock.mockResolvedValue(response);
    start();
    latest().emit('error');
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.signal?.aborted).toBe(false);
    expect(new Headers(init.headers).get('Accept')).toBe('text/event-stream');
    await vi.advanceTimersByTimeAsync(0);
    expect(init.signal?.aborted).toBe(true);
    expect(response.bodyUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('fetch の失敗でも通常の待ちで再接続する', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    start();
    await fail();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});

describe('visibility と close', () => {
  it('hidden で閉じ、visible で最後の id から一度だけ接続する', () => {
    start();
    const source = latest();
    source.emit('placeUpdated', '{}', '123');
    visibility.setVisibility('hidden');
    expect(source.close).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    source.emit('placeUpdated', '{}', '999');
    visibility.setVisibility('visible');
    visibility.setVisibility('visible');
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(latest().url).toBe('/api/changes?since=123');
  });

  it('最初から hidden なら接続せず、visible で初期 since を使う', () => {
    visibility.setVisibility('hidden');
    start({ since: 0 });
    expect(FakeEventSource.instances).toHaveLength(0);
    visibility.setVisibility('visible');
    expect(latest().url).toBe('/api/changes?since=0');
  });

  it('hidden で待機中の再接続タイマーを解除する', async () => {
    start();
    await fail();
    expect(vi.getTimerCount()).toBe(1);
    visibility.setVisibility('hidden');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    visibility.setVisibility('visible');
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(latest().url).toBe('/api/changes?since=120');
  });

  it.each(['hidden', 'close'] as const)('%s で未完了のプローブを中断し、遅い応答から再接続しない', async (action) => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    const connection = start();
    latest().emit('error');
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    if (action === 'hidden') visibility.setVisibility('hidden');
    else connection.close();
    expect(signal?.aborted).toBe(true);
    // AbortSignal を無視するモックでも古い応答が状態を上書きしない。
    visibility.setVisibility('visible');
    resolve(new Response(null, { status: 429, headers: { 'Retry-After': '20' } }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeEventSource.instances).toHaveLength(action === 'hidden' ? 2 : 1);
  });

  it('close は接続・visibility リスナーを解除し、何度呼んでも再開しない', async () => {
    const add = vi.spyOn(visibility, 'addEventListener');
    const remove = vi.spyOn(visibility, 'removeEventListener');
    const connection = start();
    const source = latest();
    connection.close();
    connection.close();
    expect(source.close).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledExactlyOnceWith('visibilitychange', add.mock.calls[0][1]);
    source.emit('error');
    source.emit('resync');
    source.emit('placeAdded', '{}', '121');
    visibility.setVisibility('hidden');
    visibility.setVisibility('visible');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onResync).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('close は待機中の再接続タイマーも解除する', async () => {
    const connection = start();
    await fail();
    connection.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('注入なしでもブラウザの EventSource・document・fetch を使える', async () => {
    vi.stubGlobal('document', visibility);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    connections.push(connectChanges({ since: '120', onEvent, onResync }));
    expect(latest().url).toBe('/api/changes?since=120');
    await fail();
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });
});
