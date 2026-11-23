import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { effectScope, isRef, type EffectScope, type Ref } from 'vue';
import { getStorage, type MetaValue } from '../storage';
import { useOrientation, type OrientationStatus, type OrientationStorage } from './orientation';

vi.mock('../storage', () => ({ getStorage: vi.fn() }));

function memoryStorage(initial?: MetaValue) {
  const values = new Map<string, MetaValue>();
  if (initial !== undefined) values.set('orientation.offset', initial);
  return {
    values,
    get: vi.fn<OrientationStorage['get']>(async (key) => values.get(key)),
    save: vi.fn<OrientationStorage['save']>(async (key, value) => { values.set(key, value); }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function emit(type: 'deviceorientation' | 'deviceorientationabsolute', fields: {
  alpha?: number | null;
  webkitCompassHeading?: number;
  absolute?: boolean;
} = {}) {
  window.dispatchEvent(Object.assign(new Event(type), { alpha: null, absolute: false, ...fields }));
}

function androidHeading(degrees: number) {
  emit('deviceorientationabsolute', { alpha: 360 - degrees, absolute: true });
}

function ios(permission: () => Promise<'granted' | 'denied'> = async () => 'granted') {
  const requestPermission = vi.fn(permission);
  const constructor = Object.assign(class {}, { requestPermission });
  vi.stubGlobal('DeviceOrientationEvent', constructor);
  return { requestPermission, constructor };
}

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

function trackListeners(target: EventTarget) {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    if (listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    }
    add(type, listener, options);
  });
  vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, options) => {
    if (listener) listeners.get(type)?.delete(listener);
    remove(type, listener, options);
  });
  return (type: string) => listeners.get(type)?.size ?? 0;
}

const scopes: EffectScope[] = [];
const disposers: (() => void)[] = [];
let storage: ReturnType<typeof memoryStorage>;
let screenOrientation: EventTarget & { angle: number };
let consoleSpies: ReturnType<typeof vi.spyOn>[];
const fetchMock = vi.fn(() => { throw new Error('Unexpected fetch'); });
const beacon = vi.fn(() => { throw new Error('Unexpected beacon'); });
const xhr = vi.fn(() => { throw new Error('Unexpected XMLHttpRequest'); });

function createOrientation(destination: OrientationStorage = storage) {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() => useOrientation(destination))!;
}

beforeEach(() => {
  vi.useFakeTimers();
  storage = memoryStorage();
  vi.mocked(getStorage).mockReset();
  vi.stubGlobal('DeviceOrientationEvent', class {});
  screenOrientation = Object.assign(new EventTarget(), { angle: 0 });
  vi.stubGlobal('screen', { orientation: screenOrientation });
  vi.stubGlobal('orientation', 0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('fetch', fetchMock.mockClear());
  vi.stubGlobal('XMLHttpRequest', xhr.mockClear());
  vi.stubGlobal('navigator', { sendBeacon: beacon.mockClear() });
  consoleSpies = Object.getOwnPropertyNames(console)
    .filter((key) => typeof Reflect.get(console, key) === 'function')
    .map((key) => vi.spyOn(console, key as 'log').mockImplementation(() => {}));
});

afterEach(() => {
  try {
    scopes.splice(0).forEach((scope) => scope.stop());
    disposers.splice(0).forEach((dispose) => dispose());
    // Every scenario is offline and must never log sensor data.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe('useOrientation', () => {
  it('共有の Ref を返し、allow までは idle で購読・権限要求をしない', async () => {
    const { requestPermission } = ios();
    const add = vi.spyOn(window, 'addEventListener');
    const service = createOrientation();
    expectTypeOf(service.heading).toEqualTypeOf<Ref<number | null>>();
    expectTypeOf(service.offset).toEqualTypeOf<Ref<number>>();
    expectTypeOf(service.status).toEqualTypeOf<Ref<OrientationStatus>>();
    expectTypeOf(service.report).returns.toEqualTypeOf<number | null>();
    expect(isRef(service.heading)).toBe(true);
    expect(isRef(service.status)).toBe(true);
    expect(service.status.value).toBe('idle');
    expect(service.report()).toBeNull();
    await service.ready;
    expect(requestPermission).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(getStorage).not.toHaveBeenCalled();
  });

  it('iOS は allow の同期部分で正しい receiver と共に権限を要求する', async () => {
    const answer = deferred<'granted' | 'denied'>();
    const reading = deferred<MetaValue | undefined>();
    storage.get.mockReturnValue(reading.promise);
    const { requestPermission, constructor } = ios(() => answer.promise);
    const add = vi.spyOn(window, 'addEventListener');
    const service = createOrientation();
    const permission = service.allow();

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(requestPermission.mock.contexts[0]).toBe(constructor);
    expect(service.status.value).toBe('asking');
    expect(add).not.toHaveBeenCalled();
    answer.resolve('granted');
    await permission;
    expect(service.status.value).toBe('asking');
    expect(add).toHaveBeenCalledExactlyOnceWith('deviceorientation', expect.any(Function));

    emit('deviceorientation', { webkitCompassHeading: 45, alpha: 200 });
    expect(service.heading.value).toBeCloseTo(45);
    expect(service.status.value).toBe('granted');
    reading.resolve(5);
    await service.ready;
    expect(service.heading.value).toBeCloseTo(50);
  });

  it.each([[0, 0], [90, 270], [270, 90], [360, 0], [-30, 30], [750, 330]])(
    'Android は absolute イベントの alpha=%s を方位 %s に変換する', async (alpha, expected) => {
      const add = vi.spyOn(window, 'addEventListener');
      const service = createOrientation();
      await service.allow();
      expect(service.status.value).toBe('asking');
      expect(add).toHaveBeenCalledExactlyOnceWith('deviceorientationabsolute', expect.any(Function));
      emit('deviceorientation', { alpha: 180 });
      expect(service.report()).toBeNull();
      emit('deviceorientationabsolute', { alpha, absolute: true });
      expect(service.status.value).toBe('granted');
      expect(service.report()).toBeCloseTo(expected);
    },
  );

  describe.each(['Android', 'iOS'])('%s の画面角度補正', (platform) => {
    function sensorHeading(degrees: number) {
      if (platform === 'iOS') emit('deviceorientation', { webkitCompassHeading: degrees });
      else androidHeading(degrees);
    }

    it.each([0, 90, 180, 270])('screen.orientation.angle=%s を方位と保存補正に足す', async (angle) => {
      if (platform === 'iOS') ios();
      screenOrientation.angle = angle;
      vi.stubGlobal('orientation', 180);
      const service = createOrientation();
      await service.ready;
      await service.setOffset(15);
      await service.allow();
      sensorHeading(350);
      expect(service.report()).toBeCloseTo((5 + angle) % 360);
    });

    it.each([0, 90, 180, 270, -90])('Screen Orientation API がなければ window.orientation=%s を使う', async (angle) => {
      if (platform === 'iOS') ios();
      vi.stubGlobal('screen', {});
      vi.stubGlobal('orientation', angle);
      const service = createOrientation();
      await service.allow();
      sensorHeading(20);
      expect(service.report()).toBeCloseTo((380 + angle) % 360);
    });

    it('change で新たなセンサー値を待たず、平滑化した方位に画面角度を反映する', async () => {
      if (platform === 'iOS') ios();
      const service = createOrientation();
      await service.allow();
      sensorHeading(10);
      sensorHeading(30);
      for (const angle of [90, 180, 270, 0]) {
        screenOrientation.angle = angle;
        screenOrientation.dispatchEvent(new Event('change'));
        expect(service.report()).toBeCloseTo((20 + angle) % 360);
      }
      sensorHeading(20);
      expect(service.report()).toBeCloseTo(20);
    });
  });

  it('iOS の webkitCompassHeading がないイベントや非数を無視する', async () => {
    ios();
    const service = createOrientation();
    await service.allow();
    emit('deviceorientation', { alpha: 90, absolute: true });
    emit('deviceorientation', { webkitCompassHeading: NaN });
    emit('deviceorientation', { webkitCompassHeading: Infinity });
    expect(service.report()).toBeNull();
    expect(service.status.value).toBe('asking');
    emit('deviceorientation', { webkitCompassHeading: 0 });
    expect(service.report()).toBe(0);
  });

  it('null・未定義・非数の alpha はタイムアウトを延長しない', async () => {
    const service = createOrientation();
    await service.allow();
    vi.advanceTimersByTime(14_999);
    for (const alpha of [null, undefined, NaN, Infinity]) emit('deviceorientationabsolute', { alpha });
    expect(service.report()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(service.status.value).toBe('timeout');
  });

  it('イベントが15秒届かないと timeout、同じ購読のイベントで回復する', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const service = createOrientation();
    await service.allow();
    vi.advanceTimersByTime(14_999);
    expect(service.status.value).toBe('asking');
    vi.advanceTimersByTime(1);
    expect(service.status.value).toBe('timeout');
    androidHeading(30);
    expect(service.status.value).toBe('granted');
    expect(service.report()).toBeCloseTo(30);
    vi.advanceTimersByTime(14_000);
    androidHeading(40);
    vi.advanceTimersByTime(14_999);
    expect(service.status.value).toBe('granted');
    vi.advanceTimersByTime(1);
    expect(service.status.value).toBe('timeout');
    expect(service.report()).toBeNull();
    androidHeading(120);
    expect(service.report()).toBeCloseTo(120);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('API がない環境と window がない環境は unavailable', async () => {
    const service = createOrientation();
    vi.stubGlobal('DeviceOrientationEvent', undefined);
    await service.allow();
    expect(service.status.value).toBe('unavailable');
    vi.stubGlobal('window', undefined);
    await service.allow();
    expect(service.status.value).toBe('unavailable');
    expect(service.report()).toBeNull();
  });

  it('購読が例外を投げたら unavailable にしてタイマーを残さない', async () => {
    vi.spyOn(window, 'addEventListener').mockImplementation(() => { throw new Error('Unavailable'); });
    const service = createOrientation();
    await service.allow();
    expect(service.status.value).toBe('unavailable');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('iOS の拒否は denied、リスナーを追加せず再許可できる', async () => {
    const { requestPermission } = ios(async () => 'denied');
    const add = vi.spyOn(window, 'addEventListener');
    const service = createOrientation();
    await service.allow();
    expect(service.status.value).toBe('denied');
    expect(add).not.toHaveBeenCalled();
    expect(service.report()).toBeNull();
    requestPermission.mockResolvedValue('granted');
    await service.allow();
    emit('deviceorientation', { webkitCompassHeading: 12 });
    expect(service.status.value).toBe('granted');
  });

  it.each([true, false])('iOS 権限要求の例外を処理する (同期=%s)', async (synchronous) => {
    const { requestPermission } = ios();
    const service = createOrientation();
    for (const [name, expected] of [['NotAllowedError', 'denied'], ['NotReadableError', 'unavailable']]) {
      const error = new DOMException('Mock permission failure', name);
      requestPermission.mockImplementation(() => {
        if (synchronous) throw error;
        return Promise.reject(error);
      });
      await service.allow();
      expect(service.status.value).toBe(expected);
      expect(service.report()).toBeNull();
    }
  });

  it('refuse は許可前にも使え、共有の購読と値を停止する', async () => {
    const first = createOrientation();
    const second = createOrientation();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    first.refuse();
    expect(first.status.value).toBe('denied');
    expect(add).not.toHaveBeenCalled();
    await first.allow();
    androidHeading(100);
    const [event, listener] = add.mock.calls[0];
    second.refuse();
    expect(remove).toHaveBeenCalledExactlyOnceWith(event, listener);
    expect(first.status.value).toBe('denied');
    expect(first.report()).toBeNull();
    (listener as EventListener)(Object.assign(new Event(event), { alpha: 0 }));
    vi.advanceTimersByTime(30_000);
    expect(first.status.value).toBe('denied');
    expect(first.report()).toBeNull();
    await second.allow();
    androidHeading(210);
    expect(first.report()).toBeCloseTo(210);
  });

  it('複数コンポーネントで Ref と1つのリスナーを共有し、最後の dispose で解除する', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const screenAdd = vi.spyOn(screenOrientation, 'addEventListener');
    const screenRemove = vi.spyOn(screenOrientation, 'removeEventListener');
    const visibilityAdd = vi.spyOn(document, 'addEventListener');
    const visibilityRemove = vi.spyOn(document, 'removeEventListener');
    const first = createOrientation();
    const second = createOrientation();
    await Promise.all([first.allow(), second.allow(), second.allow()]);
    const third = createOrientation();
    await third.allow();
    expect(second.heading).toBe(first.heading);
    expect(third.status).toBe(first.status);
    expect(third.offset).toBe(first.offset);
    expect(add).toHaveBeenCalledTimes(1);
    expect(screenAdd).toHaveBeenCalledExactlyOnceWith('change', expect.any(Function));
    expect(visibilityAdd).toHaveBeenCalledExactlyOnceWith('visibilitychange', expect.any(Function));
    androidHeading(60);
    scopes[0].stop();
    first.dispose();
    second.dispose();
    scopes[1].stop();
    expect(remove).not.toHaveBeenCalled();
    expect(screenRemove).not.toHaveBeenCalled();
    expect(visibilityRemove).not.toHaveBeenCalled();
    expect(third.report()).toBeCloseTo(60);
    scopes[2].stop();
    expect(remove).toHaveBeenCalledExactlyOnceWith(...add.mock.calls[0]);
    expect(screenRemove).toHaveBeenCalledExactlyOnceWith(...screenAdd.mock.calls[0]);
    expect(visibilityRemove).toHaveBeenCalledExactlyOnceWith(...visibilityAdd.mock.calls[0]);
    expect(third.status.value).toBe('idle');
    expect(third.report()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['Android', 'iOS'])('%s は非表示中の購読とタイマーを止め、表示時に1つだけ再開する', async (platform) => {
    const requestPermission = platform === 'iOS' ? ios().requestPermission : null;
    const event = platform === 'iOS' ? 'deviceorientation' : 'deviceorientationabsolute';
    const sensorListeners = trackListeners(window);
    const screenListeners = trackListeners(screenOrientation);
    const visibilityListeners = trackListeners(document);
    const first = createOrientation();
    const second = createOrientation();
    await Promise.all([first.allow(), second.allow()]);
    emit(event, { alpha: 300, webkitCompassHeading: 60 });
    expect(first.report()).toBeCloseTo(60);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      vi.advanceTimersByTime(14_000);
      setVisibility('hidden');
      setVisibility('hidden');
      expect(sensorListeners(event)).toBe(0);
      expect(screenListeners('change')).toBe(0);
      expect(visibilityListeners('visibilitychange')).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      emit(event, { alpha: 180, webkitCompassHeading: 180 });
      screenOrientation.angle = 90;
      screenOrientation.dispatchEvent(new Event('change'));
      vi.advanceTimersByTime(30_000);
      expect(first.status.value).toBe('granted');
      expect(first.report()).toBeNull();
      await second.allow();
      expect(sensorListeners(event)).toBe(0);

      setVisibility('visible');
      setVisibility('visible');
      expect(sensorListeners(event)).toBe(1);
      expect(screenListeners('change')).toBe(1);
      expect(visibilityListeners('visibilitychange')).toBe(1);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(14_999);
      expect(first.status.value).toBe('asking');
      emit(event, { alpha: 240, webkitCompassHeading: 120 });
      expect(first.report()).toBeCloseTo(210);
      expect(first.status.value).toBe('granted');
    }
    if (requestPermission) expect(requestPermission).toHaveBeenCalledTimes(1);
    first.dispose();
    expect(sensorListeners(event)).toBe(1);
    expect(screenListeners('change')).toBe(1);
    second.dispose();
    expect(sensorListeners(event)).toBe(0);
    expect(screenListeners('change')).toBe(0);
    expect(visibilityListeners('visibilitychange')).toBe(0);
    setVisibility('hidden');
    setVisibility('visible');
    expect(sensorListeners(event)).toBe(0);
    expect(screenListeners('change')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['dispose', 'refuse'])('非表示中の %s で復帰監視も解除し、表示に戻っても再開しない', async (stop) => {
    const sensorListeners = trackListeners(window);
    const screenListeners = trackListeners(screenOrientation);
    const visibilityListeners = trackListeners(document);
    const service = createOrientation();
    await service.allow();
    androidHeading(50);
    setVisibility('hidden');
    if (stop === 'dispose') service.dispose();
    else service.refuse();
    expect(visibilityListeners('visibilitychange')).toBe(0);
    setVisibility('visible');
    screenOrientation.dispatchEvent(new Event('change'));
    androidHeading(100);
    vi.advanceTimersByTime(30_000);
    expect(sensorListeners('deviceorientationabsolute')).toBe(0);
    expect(screenListeners('change')).toBe(0);
    expect(service.status.value).toBe(stop === 'dispose' ? 'idle' : 'denied');
    expect(service.report()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('非表示中に許可されても、表示に戻るまで購読やタイマーを開始しない (iOS=%s)', async (isIOS) => {
    const answer = deferred<'granted' | 'denied'>();
    if (isIOS) ios(() => answer.promise);
    const add = vi.spyOn(window, 'addEventListener');
    const screenAdd = vi.spyOn(screenOrientation, 'addEventListener');
    const service = createOrientation();
    if (!isIOS) setVisibility('hidden');
    const permission = service.allow();
    if (isIOS) {
      setVisibility('hidden');
      answer.resolve('granted');
    }
    await permission;
    vi.advanceTimersByTime(30_000);
    expect(add).not.toHaveBeenCalled();
    expect(screenAdd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(service.status.value).toBe('asking');
    setVisibility('visible');
    expect(add).toHaveBeenCalledTimes(1);
    expect(screenAdd).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('同じ scope の複数呼び出しも一度ずつ解放し、scope 外も dispose できる', async () => {
    const scope = effectScope();
    scopes.push(scope);
    const [first, second] = scope.run(() => [useOrientation(storage), useOrientation(storage)])!;
    const outside = useOrientation(storage);
    disposers.push(outside.dispose);
    const remove = vi.spyOn(window, 'removeEventListener');
    await first.allow();
    first.dispose();
    first.dispose();
    scope.stop();
    second.dispose();
    expect(remove).not.toHaveBeenCalled();
    outside.dispose();
    outside.dispose();
    await outside.allow();
    outside.refuse();
    expect(await outside.setOffset(30)).toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(outside.status.value).toBe('idle');
    const next = createOrientation();
    await next.allow();
    outside.dispose();
    androidHeading(75);
    expect(next.report()).toBeCloseTo(75);
  });

  it('権限要求中の allow を共有し、refuse 後の古い権限応答を無視する', async () => {
    const answer = deferred<'granted' | 'denied'>();
    const { requestPermission } = ios(() => answer.promise);
    const first = createOrientation();
    const second = createOrientation();
    const add = vi.spyOn(window, 'addEventListener');
    const pending = first.allow();
    expect(second.allow()).toBe(pending);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    second.refuse();
    requestPermission.mockResolvedValue('granted');
    await second.allow();
    emit('deviceorientation', { webkitCompassHeading: 20 });
    answer.resolve('denied');
    await pending;
    expect(first.status.value).toBe('granted');
    expect(first.report()).toBeCloseTo(20);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('最後の dispose 後の権限応答が新しい利用者の状態を変えない', async () => {
    const answer = deferred<'granted' | 'denied'>();
    const { requestPermission } = ios(() => answer.promise);
    const first = createOrientation();
    const old = first.allow();
    first.dispose();
    const next = createOrientation();
    requestPermission.mockResolvedValue('granted');
    await next.allow();
    emit('deviceorientation', { webkitCompassHeading: 90 });
    answer.resolve('granted');
    await old;
    expect(next.report()).toBeCloseTo(90);
    expect(next.status.value).toBe('granted');
  });

  it.each([[359, 1, 0], [350, 30, 10], [20, 40, 30]])(
    '円周上で %s° と %s° の平均を %s° に平滑化する', async (first, second, expected) => {
      const service = createOrientation();
      await service.allow();
      androidHeading(first);
      androidHeading(second);
      expect(service.report()).toBeCloseTo(expected);
      expect(service.report()).toBeGreaterThanOrEqual(0);
      expect(service.report()).toBeLessThan(360);
    },
  );

  it('平滑化は直近5件に限定し、正反対の標本でも有限の方位を保つ', async () => {
    const service = createOrientation();
    await service.allow();
    androidHeading(10);
    androidHeading(190);
    expect(service.report()).toBeCloseTo(10);
    for (let index = 0; index < 5; index += 1) androidHeading(100);
    expect(service.report()).toBeCloseTo(100);
  });

  it('補正を即時反映し meta に保存、最後の dispose 後に同じ保存先から復元する', async () => {
    const first = createOrientation();
    await first.ready;
    await first.allow();
    androidHeading(350);
    const saving = first.setOffset(25);
    expect(first.report()).toBeCloseTo(15);
    expect(await saving).toBe(true);
    expect(storage.save).toHaveBeenCalledExactlyOnceWith('orientation.offset', 25);
    first.dispose();
    expect(first.offset.value).toBe(0);
    const second = createOrientation();
    await second.ready;
    expect(second.offset.value).toBe(25);
    await second.allow();
    androidHeading(350);
    expect(second.report()).toBeCloseTo(15);
    expect(await second.setOffset(-725)).toBe(true);
    expect(second.report()).toBeCloseTo(345);
    expect(storage.values.get('orientation.offset')).toBe(-725);
  });

  it('補正値は利用者間で共有し、最初の利用者が選んだ保存先だけを使う', async () => {
    const otherStorage = memoryStorage(180);
    const first = createOrientation();
    const second = createOrientation(otherStorage);
    await Promise.all([first.ready, second.ready]);
    await second.setOffset(15);
    expect(first.offset.value).toBe(15);
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(storage.save).toHaveBeenCalledWith('orientation.offset', 15);
    expect(otherStorage.get).not.toHaveBeenCalled();
    expect(otherStorage.save).not.toHaveBeenCalled();
  });

  it.each(['20', null, false, { degrees: 20 }, [20], NaN, Infinity])(
    '不正な保存値 %s は復元しない', async (initial) => {
      const service = createOrientation(memoryStorage(initial));
      await service.ready;
      expect(service.offset.value).toBe(0);
    },
  );

  it('非数の補正は現在値を変更せず保存もしない', async () => {
    const service = createOrientation();
    await service.ready;
    await service.allow();
    androidHeading(30);
    for (const invalid of [NaN, Infinity, -Infinity]) expect(await service.setOffset(invalid)).toBe(false);
    expect(service.offset.value).toBe(0);
    expect(service.report()).toBeCloseTo(30);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('遅い復元が利用者の新しい補正や次の session を上書きしない', async () => {
    const reading = deferred<MetaValue | undefined>();
    storage.get.mockReturnValue(reading.promise);
    const first = createOrientation();
    await first.setOffset(30);
    reading.resolve(90);
    await first.ready;
    expect(first.offset.value).toBe(30);
    first.dispose();

    const lateReading = deferred<MetaValue | undefined>();
    storage.get.mockReturnValue(lateReading.promise);
    const old = createOrientation();
    await Promise.resolve();
    old.dispose();
    const next = createOrientation(memoryStorage(10));
    await next.ready;
    lateReading.resolve(180);
    await old.ready;
    expect(next.offset.value).toBe(10);
  });

  it('既定の保存先は getStorage を遅延利用し、meta のみを読み書きする', async () => {
    vi.mocked(getStorage).mockResolvedValue({ meta: storage } as unknown as Awaited<ReturnType<typeof getStorage>>);
    expect(getStorage).not.toHaveBeenCalled();
    const service = useOrientation();
    disposers.push(service.dispose);
    expect(getStorage).not.toHaveBeenCalled();
    await service.ready;
    expect(getStorage).toHaveBeenCalledTimes(1);
    expect(storage.get).toHaveBeenCalledExactlyOnceWith('orientation.offset');
    await service.allow();
    androidHeading(42);
    service.report();
    await service.setOffset(8);
    service.refuse();
    expect(storage.save).toHaveBeenCalledExactlyOnceWith('orientation.offset', 8);
    expect(service.report()).toBeNull();
  });

  it.each([true, false])('保存先の読み書きの失敗時も端末内で動作する (同期=%s)', async (synchronous) => {
    storage.get.mockImplementation(() => {
      if (synchronous) throw new Error('Read failed');
      return Promise.reject(new Error('Read failed'));
    });
    storage.save.mockImplementation(() => {
      if (synchronous) throw new Error('Write failed');
      return Promise.reject(new Error('Write failed'));
    });
    const service = createOrientation();
    await service.ready;
    expect(service.offset.value).toBe(0);
    await service.allow();
    androidHeading(10);
    expect(await service.setOffset(20)).toBe(false);
    expect(service.report()).toBeCloseTo(30);
    expect(service.status.value).toBe('granted');
  });

  it('補正の保存を直列化し、失敗後も次の補正を保存できる', async () => {
    const write = deferred<void>();
    storage.save.mockReturnValueOnce(write.promise);
    const service = createOrientation();
    const first = service.setOffset(10);
    const second = service.setOffset(20);
    await Promise.resolve();
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(service.offset.value).toBe(20);
    write.reject(new Error('Save failed'));
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(storage.save.mock.calls).toEqual([['orientation.offset', 10], ['orientation.offset', 20]]);
    expect(storage.values.get('orientation.offset')).toBe(20);
  });
});
