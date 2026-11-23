import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { effectScope, isRef, type EffectScope, type Ref } from 'vue';
import type { Position } from '../types';
import { usePosition } from './position';

function fakeGeolocation() {
  const callbacks: { success: PositionCallback; error: PositionErrorCallback | null }[] = [];
  const active = new Set<number>();
  const watchPosition = vi.fn<Geolocation['watchPosition']>((success, error) => {
    const id = callbacks.length; // Include 0 as a valid watch ID.
    callbacks.push({ success, error: error ?? null });
    active.add(id);
    return id;
  });
  const clearWatch = vi.fn<Geolocation['clearWatch']>((id) => { active.delete(id); });
  const geolocation: Geolocation = {
    watchPosition, clearWatch, getCurrentPosition: vi.fn<Geolocation['getCurrentPosition']>(),
  };

  return {
    geolocation, watchPosition, clearWatch, active,
    succeed(id = callbacks.length - 1, accuracy = 12.5, timestamp = 1_700_000_000_123) {
      callbacks[id].success({
        coords: {
          latitude: 37.4252, longitude: 138.7788, accuracy,
          altitude: null, altitudeAccuracy: null, heading: null, speed: null,
          toJSON: () => ({}),
        },
        timestamp,
        toJSON: () => ({}),
      });
    },
    fail(code: 1 | 2 | 3, id = callbacks.length - 1) {
      callbacks[id].error?.({
        code, message: 'fake geolocation error',
        PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
      });
    },
  };
}

let geo: ReturnType<typeof fakeGeolocation>;
const scopes: EffectScope[] = [];
const fetchMock = vi.fn<typeof fetch>(() => { throw new Error('Unexpected fetch'); });

function createPosition() {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(usePosition)!;
}

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  geo = fakeGeolocation();
  vi.stubGlobal('navigator', { geolocation: geo.geolocation, sendBeacon: vi.fn() });
  vi.stubGlobal('fetch', fetchMock.mockClear());
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('usePosition', () => {
  it('Ref を返し、allow までは位置の取得を始めない', () => {
    const service = createPosition();

    expectTypeOf(service.position).toEqualTypeOf<Ref<Position | null>>();
    expectTypeOf(service.status).toEqualTypeOf<
      Ref<'idle' | 'asking' | 'granted' | 'denied' | 'unavailable'>
    >();
    expectTypeOf(service.report).returns.toEqualTypeOf<Position | null>();
    expect(isRef(service.position)).toBe(true);
    expect(isRef(service.status)).toBe(true);
    expect(service.status.value).toBe('idle');
    expect(service.report()).toBeNull();
    setVisibility('hidden');
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it('allow で高精度の監視を始め、許可後に精度と取得時刻 ms を反映する', () => {
    const service = createPosition();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    service.allow();

    expect(service.status.value).toBe('asking');
    expect(service.report()).toBeNull();
    expect(geo.watchPosition).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function), expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0 },
    );

    geo.succeed();
    expect(service.status.value).toBe('granted');
    expect(service.position.value).toEqual({
      lat: 37.4252, lng: 138.7788, accuracy: 12.5, takenAt: 1_700_000_000_123,
    });
    expect(service.report()).toBe(service.position.value);

    geo.succeed(0, 3, 1_700_000_001_000);
    expect(service.report()).toMatchObject({ accuracy: 3, takenAt: 1_700_000_001_000 });
  });

  it('refuse で ID 0 の監視も停止し、遅れて届いた位置やエラーを無視する', () => {
    const service = createPosition();
    service.allow();
    geo.succeed();
    service.refuse();

    expect(geo.clearWatch).toHaveBeenCalledExactlyOnceWith(0);
    expect(service.position.value).toBeNull();
    expect(service.report()).toBeNull();
    expect(service.status.value).toBe('denied');
    geo.succeed();
    geo.fail(2);
    setVisibility('hidden');
    setVisibility('visible');
    expect(service.report()).toBeNull();
    expect(service.status.value).toBe('denied');
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('許可前の refuse では geolocation を呼ばない', () => {
    const service = createPosition();
    service.refuse();
    expect(service.status.value).toBe('denied');
    expect(service.report()).toBeNull();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(geo.clearWatch).not.toHaveBeenCalled();
  });

  it('PERMISSION_DENIED で現在地を消して監視を停止し、再許可できる', () => {
    const service = createPosition();
    service.allow();
    geo.succeed();
    geo.fail(1);

    expect(service.status.value).toBe('denied');
    expect(service.report()).toBeNull();
    expect(geo.active.size).toBe(0);
    setVisibility('hidden');
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);

    service.allow();
    expect(service.status.value).toBe('asking');
    geo.succeed();
    expect(service.status.value).toBe('granted');
  });

  it.each([2, 3] as const)('エラー %s は unavailable になり、次の位置取得で回復する', (code) => {
    const service = createPosition();
    service.allow();
    geo.succeed();
    geo.fail(code);
    expect(service.status.value).toBe('unavailable');
    expect(service.report()).toBeNull();

    geo.succeed();
    expect(service.status.value).toBe('granted');
    expect(service.report()).not.toBeNull();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('呼び出し時に geolocation がない場合は unavailable にする', () => {
    const service = createPosition();
    vi.stubGlobal('navigator', {});
    service.allow();
    expect(service.status.value).toBe('unavailable');
    expect(service.report()).toBeNull();
    setVisibility('hidden');
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it('watchPosition が例外を投げても unavailable にする', () => {
    geo.watchPosition.mockImplementation(() => { throw new Error('Unavailable'); });
    const service = createPosition();
    service.allow();
    expect(service.status.value).toBe('unavailable');
    expect(service.report()).toBeNull();
    setVisibility('hidden');
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('生成後に差し替えた geolocation を allow 時に参照する', () => {
    const service = createPosition();
    const replacement = fakeGeolocation();
    vi.stubGlobal('navigator', { geolocation: replacement.geolocation });
    service.allow();
    replacement.succeed();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(service.status.value).toBe('granted');
    service.refuse();
    expect(replacement.clearWatch).toHaveBeenCalledWith(0);
  });

  it('hidden では低精度と長いキャッシュに切り替え、visible で高精度に戻す', () => {
    const service = createPosition();
    service.allow();
    geo.succeed();
    const previousPosition = service.report();
    setVisibility('hidden');
    const foreground = geo.watchPosition.mock.calls[0][2]!;
    const background = geo.watchPosition.mock.calls[1][2]!;

    expect(geo.clearWatch).toHaveBeenNthCalledWith(1, 0);
    expect(background.enableHighAccuracy).toBe(false);
    expect(background.maximumAge).toBeGreaterThan(foreground.maximumAge!);
    expect(background.maximumAge).toBeGreaterThanOrEqual(60_000);
    expect(service.report()).toBe(previousPosition);
    expect(geo.active.size).toBe(1);
    geo.succeed(0, 999);
    geo.fail(1, 0);
    expect(service.report()).toBe(previousPosition);
    expect(service.status.value).toBe('granted');

    setVisibility('visible');
    expect(geo.clearWatch).toHaveBeenNthCalledWith(2, 1);
    expect(geo.watchPosition.mock.calls[2][2]).toEqual(foreground);
    expect(geo.active.size).toBe(1);
    geo.succeed(2, 5);
    expect(service.report()?.accuracy).toBe(5);
  });

  it('hidden のまま許可すると最初から低精度で監視する', () => {
    setVisibility('hidden');
    const service = createPosition();
    service.allow();
    expect(geo.watchPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: false, maximumAge: 60_000,
    });
  });

  it('allow を繰り返しても監視を重複させない', () => {
    const service = createPosition();
    service.allow();
    service.allow();
    expect(geo.clearWatch).toHaveBeenCalledWith(0);
    expect(geo.active.size).toBe(1);
    geo.succeed(0);
    expect(service.status.value).toBe('asking');
    expect(service.report()).toBeNull();
    setVisibility('hidden');
    expect(geo.watchPosition).toHaveBeenCalledTimes(3);
    expect(geo.active.size).toBe(1);
  });

  it('手入力は監視を停止し、指定された位置・精度と入力時刻を使う', () => {
    const service = createPosition();
    service.allow();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_123);
    service.setManually(37.426, 138.779, 25);
    expect(service.report()).toEqual({
      lat: 37.426, lng: 138.779, accuracy: 25, takenAt: 1_800_000_000_123,
    });
    expect(service.status.value).toBe('granted');
    expect(geo.active.size).toBe(0);
    geo.succeed();
    setVisibility('hidden');
    expect(service.report()?.lat).toBe(37.426);
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);

    service.refuse();
    expect(service.report()).toBeNull();
  });

  it('精度を省略した手入力は不明な精度として扱い、許可を求めない', () => {
    const service = createPosition();
    service.setManually(37.426, 138.779);
    expect(service.report()?.accuracy).toBe(Infinity);
    expect(service.status.value).toBe('granted');
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it('Vue のスコープ破棄時には監視と visibilitychange の購読を解除する', () => {
    const service = createPosition();
    service.allow();
    scopes[0].stop();
    expect(geo.active.size).toBe(0);
    geo.succeed();
    setVisibility('hidden');
    expect(service.report()).toBeNull();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('位置の取得・切り替え・報告・手入力・拒否で外部送信も保存もしない', () => {
    const xhr = vi.fn();
    const openDatabase = vi.fn();
    const save = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('indexedDB', { open: openDatabase });
    const beacon = vi.spyOn(navigator, 'sendBeacon');
    const service = createPosition();

    service.allow();
    geo.succeed();
    service.report();
    setVisibility('hidden');
    geo.succeed();
    setVisibility('visible');
    geo.fail(1);
    service.setManually(37.426, 138.779, 10);
    service.report();
    service.refuse();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(openDatabase).not.toHaveBeenCalled();
  });
});
