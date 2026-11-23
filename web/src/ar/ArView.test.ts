import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { fromXY } from '../domain/geo';
import { useLandmarksStore, usePlacesStore } from '../stores';
import type { Position } from '../types';
import ArView from './ArView.vue';
import CameraView from '../views/CameraView.vue';
import { buildings, places } from './fixtures/buildings';

const mocks = vi.hoisted(() => ({
  position: null as unknown as ReturnType<typeof ref<Position | null>>,
  heading: null as unknown as ReturnType<typeof ref<number | null>>,
  offset: null as unknown as ReturnType<typeof ref<number>>,
  status: null as unknown as ReturnType<typeof ref<string>>,
  orientationStatus: null as unknown as ReturnType<typeof ref<string>>,
  allowPosition: vi.fn(), allowOrientation: vi.fn(), setOffset: vi.fn(),
  refuseOrientation: vi.fn(),
  getDestination: vi.fn(), clearDestination: vi.fn(),
}));
vi.mock('../services/position', () => ({ usePosition: () => ({
  position: mocks.position, status: mocks.status, report: () => mocks.position.value, allow: mocks.allowPosition,
}) }));
vi.mock('../services/orientation', () => ({ useOrientation: () => ({
  heading: mocks.heading, offset: mocks.offset, report: () => mocks.heading.value,
  status: mocks.orientationStatus, allow: mocks.allowOrientation, refuse: mocks.refuseOrientation, setOffset: mocks.setOffset,
}) }));
vi.mock('../storage', () => ({ getStorage: async () => ({ destination: {
  get: mocks.getDestination, clear: mocks.clearDestination,
} }) }));

enableAutoUnmount(afterEach);
let frames: Map<number, FrameRequestCallback>;
let hidden: boolean;
let intersect: IntersectionObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let stop: ReturnType<typeof vi.fn>;
let stream: MediaStream;
let ctx: CanvasRenderingContext2D;
let network: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.position = ref({ ...fromXY(0, 0), accuracy: 5, takenAt: 0 });
  mocks.heading = ref(0);
  mocks.offset = ref(0);
  mocks.status = ref('granted');
  mocks.orientationStatus = ref('granted');
  window.history.replaceState(null, '', '/');
  mocks.getDestination.mockResolvedValue(null);
  mocks.clearDestination.mockResolvedValue(undefined);
  mocks.setOffset.mockResolvedValue(true);
  frames = new Map();
  hidden = false;
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800));
  disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', vi.fn(function (callback: IntersectionObserverCallback) {
    intersect = callback;
    return { observe: vi.fn(), disconnect };
  }));
  ctx = Object.fromEntries([
    'clearRect', 'save', 'restore', 'beginPath', 'arc', 'clip', 'fillRect', 'moveTo',
    'lineTo', 'closePath', 'fill', 'stroke', 'setLineDash',
  ].map(key => [key, vi.fn()])) as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  stop = vi.fn();
  // happy-dom の MediaStream は getTracks を持たないため、端末の track を補う。
  stream = Object.assign(new MediaStream(), { getTracks: () => [{ stop } as unknown as MediaStreamTrack] });
  getUserMedia = vi.fn().mockResolvedValue(stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  network = vi.fn(() => { throw new Error('R-02 テストでは外部通信禁止'); });
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function tick() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(100));
}
const props = () => ({ places: [...places], landmarks: [...buildings], destination: null });
async function start(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('.ar-start button').trigger('click');
  await flushPromises();
  tick();
}
function viewport(isIntersecting: boolean) {
  intersect([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
}
function pointer(element: Element, type: string, x: number) {
  element.dispatchEvent(new PointerEvent(type, { clientX: x, pointerId: 1, bubbles: true }));
}

describe('R-02 モックの位置・向きによるコンポーネント表示', () => {
  it('操作を起点に既存サービスと背面カメラを開始し、video と円形 canvas を持つ', async () => {
    const wrapper = mount(ArView, { props: props() });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    await start(wrapper);
    expect(mocks.allowOrientation).toHaveBeenCalledOnce();
    expect(mocks.allowPosition).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: {
      facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 },
    } });
    const video = wrapper.get('video').element;
    expect(video.srcObject).toBe(stream);
    expect(video.hasAttribute('playsinline')).toBe(true);
    expect(video.hasAttribute('muted')).toBe(true);
    expect(wrapper.get('canvas').attributes('width')).toBe('240');
    expect(ctx.arc).toHaveBeenCalledWith(120, 120, 120, 0, Math.PI * 2);
    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it('北向きは北棟とその企画、東向きは東棟の企画なし、建物のない向きは次の操作を表示する', async () => {
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    expect(wrapper.get('.ar-front').text()).toContain('北棟');
    expect(wrapper.get('.ar-front').text()).toContain('北棟の企画');
    expect(wrapper.get('.ar-front').text()).not.toContain('北棟の奥の企画');
    await wrapper.get('.ar-front').trigger('click');
    expect(wrapper.emitted('building')).toEqual([['north']]);
    mocks.heading.value = 90;
    tick();
    expect(wrapper.get('.ar-front').text()).toContain('東棟');
    expect(wrapper.get('.ar-front').text()).toContain('この建物には企画がありません');
    mocks.heading.value = 180;
    tick();
    expect(wrapper.get('.ar-front').text()).toContain('周囲の建物へカメラを向けてください');
    expect(wrapper.get('.ar-front').attributes()).toHaveProperty('disabled');
  });

  it('距離・遮蔽をラベルで区別し、タップで企画を選べる', async () => {
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    const label = wrapper.get('[data-place-id="north-event"]');
    expect(label.element.hasAttribute('hidden')).toBe(false);
    expect(label.text()).toContain('11 m');
    const obscured = wrapper.get('[data-place-id="hidden-event"]');
    expect(obscured.text()).toContain('建物の奥');
    expect(obscured.classes()).toContain('ar-label--far');
    expect(wrapper.get('[data-place-id="outdoor-event"]').element.hasAttribute('hidden')).toBe(true);
    await label.trigger('click');
    expect(wrapper.emitted('select')).toEqual([['north-event']]);
  });

  it('案内中だけ黄色のバーと方角・直線距離を表示し、やめるを通知する', async () => {
    const wrapper = mount(ArView, { props: { ...props(), destination: { placeId: 'hidden-event' } } });
    await start(wrapper);
    expect(wrapper.get('.ar-guide').element.hasAttribute('hidden')).toBe(false);
    expect(wrapper.get('.ar-guide').text()).toContain('北棟の奥の企画まで 30 m');
    expect(wrapper.get('.ar-guide span').attributes('style')).toContain('rotate(0deg)');
    expect(wrapper.get('[data-place-id="hidden-event"]').classes()).toContain('ar-label--destination');
    expect(wrapper.get('[data-place-id="hidden-event"]').classes()).not.toContain('ar-label--far');
    mocks.heading.value = 90;
    tick();
    expect(wrapper.get('.ar-guide span').attributes('style')).toContain('rotate(-90deg)');
    await wrapper.get('.ar-guide button').trigger('click');
    expect(wrapper.emitted('stop')).toEqual([[]]);
    await wrapper.setProps({ destination: null });
    tick();
    expect(wrapper.get('.ar-guide').element.hasAttribute('hidden')).toBe(true);
  });

  it('位置が取れなくなると古いラベルと案内を消し、位置誤差や方位不明を案内する', async () => {
    const wrapper = mount(ArView, { props: { ...props(), destination: { placeId: 'north-event' } } });
    await start(wrapper);
    mocks.position.value = { ...fromXY(0, 0), accuracy: 50, takenAt: 1 };
    mocks.heading.value = null;
    tick();
    expect(wrapper.get('.ar-warning').text()).toContain('位置の誤差が大きい');
    expect(wrapper.get('.ar-top').text()).toContain('左右にドラッグ');
    mocks.position.value = null;
    mocks.status.value = 'denied';
    tick();
    expect(wrapper.get('.ar-top').text()).toContain('位置情報を許可してください');
    expect(wrapper.findAll('.ar-label').every(node => node.element.hasAttribute('hidden'))).toBe(true);
    expect(wrapper.get('.ar-guide').element.hasAttribute('hidden')).toBe(true);
    expect(wrapper.get('.ar-front').text()).toContain('現在地を確認');
  });

  it('カメラ拒否でも方向表示が動き、向きがなくても左右ドラッグで方向を合わせられる', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    mocks.heading.value = null;
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    expect(wrapper.get('.ar-warning').text()).toContain('カメラの利用が許可されていません');
    expect(wrapper.get('.ar-front').text()).toContain('北棟');
    const overlay = wrapper.get('.ar-labels').element;
    pointer(overlay, 'pointerdown', 0);
    pointer(overlay, 'pointermove', 10000);
    pointer(overlay, 'pointerup', 10000);
    tick();
    expect(wrapper.get('.ar-front').text()).not.toContain('北棟');
  });

  it('登録名を HTML として解釈せず、ストアの更新・削除を表示に反映する', async () => {
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    await wrapper.setProps({ places: [{ ...places[0], name: '<img src=x onerror=alert(1)>' }] });
    tick();
    expect(wrapper.findAll('.ar-label')).toHaveLength(1);
    expect(wrapper.get('.ar-label').text()).toContain('<img src=x onerror=alert(1)>');
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.setProps({ places: [] });
    tick();
    expect(wrapper.findAll('.ar-label')).toHaveLength(0);
  });

  it('センサーがある場合はドラッグ終了時に既存の方位サービスで補正を保存する', async () => {
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    const overlay = wrapper.get('.ar-labels').element;
    pointer(overlay, 'pointerdown', 0);
    pointer(overlay, 'pointermove', 100);
    pointer(overlay, 'pointermove', 200);
    expect(mocks.setOffset).not.toHaveBeenCalled();
    pointer(overlay, 'pointerup', 200);
    expect(mocks.setOffset).toHaveBeenCalledOnce();
    expect(mocks.setOffset.mock.calls[0][0]).toBeLessThan(0);
    pointer(overlay, 'pointerdown', 0);
    pointer(overlay, 'pointermove', 100);
    pointer(overlay, 'pointercancel', 100);
    expect(mocks.setOffset).toHaveBeenCalledOnce();
  });

  it('多数のラベルでも表示数を制限し、案内中の企画を優先して残す', async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ ...places[0], id: `event-${index}` }));
    const wrapper = mount(ArView, { props: { ...props(), places: many, destination: { placeId: 'event-39' } } });
    await start(wrapper);
    const shown = wrapper.findAll('.ar-label').filter(label => !label.element.hasAttribute('hidden')).length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(many.length);
    expect(wrapper.get('[data-place-id="event-39"]').element.hasAttribute('hidden')).toBe(false);
  });
});

describe('R-02 拒否・非対応時の案内', () => {
  it('HTTP で mediaDevices がない場合は HTTPS へ誘導する', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('isSecureContext', false);
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    expect(wrapper.get('.ar-warning').text()).toContain('HTTP ではカメラを使えないため、HTTPS で開いてください');
    expect(wrapper.get('.ar-warning').text()).not.toContain('許可されていません');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(wrapper.get('.ar-front').text()).toContain('北棟');
  });

  it('カメラの機器エラーはユーザー拒否と区別する', async () => {
    getUserMedia.mockRejectedValue(new DOMException('busy', 'NotReadableError'));
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    expect(wrapper.get('.ar-warning').text()).toContain('ほかのアプリで使用中でないか');
    expect(wrapper.get('.ar-warning').text()).not.toContain('許可されていません');
  });

  it.each([
    ['idle', '向きの利用を選べます', '向きを利用すると', '向きの利用を許可'],
    ['asking', '向きの許可を確認しています', '端末やブラウザの許可画面を確認', '確認中…'],
    ['denied', '向きの利用が許可されていません', '許可画面が再表示されず反応がない', '向きの利用を許可'],
    ['unavailable', '向きを取得できません', '方位センサーに対応しているか', 'もう一度試す'],
    ['timeout', '向きの取得に時間がかかっています', '端末を動かして', 'もう一度試す'],
  ])('方位の %s に合った見出し・次の操作を表示する', async (status, heading, message, action) => {
    mocks.orientationStatus.value = status;
    mocks.heading.value = null;
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    const banner = wrapper.get('.ar-orientation');
    expect(banner.attributes('role')).toBe('status');
    expect(banner.attributes('aria-live')).toBe('polite');
    expect(banner.get('h2').text()).toBe(heading);
    expect(banner.text()).toContain(message);
    expect(banner.text()).toContain('左右にドラッグ');
    const button = banner.get('button');
    expect(button.text()).toBe(action);
    expect(button.element.disabled).toBe(status === 'asking');
    mocks.allowOrientation.mockClear();
    await button.trigger('click');
    expect(mocks.allowOrientation).toHaveBeenCalledTimes(status === 'asking' ? 0 : 1);
    expect(mocks.refuseOrientation).toHaveBeenCalledTimes(['unavailable', 'timeout'].includes(status) ? 1 : 0);
  });

  it('方位拒否では iOS・Android の設定手順を表示し、許可後は案内を消す', async () => {
    mocks.orientationStatus.value = 'denied';
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    expect(wrapper.get('.ar-orientation').text()).toContain('iOS（Safari）');
    expect(wrapper.get('.ar-orientation').text()).toContain('モーションと画面の向きのアクセス');
    expect(wrapper.get('.ar-orientation').text()).toContain('Android（Chrome）');
    expect(wrapper.get('.ar-orientation').text()).toContain('「権限」→「モーション センサー」');
    expect(wrapper.get('.ar-orientation').text()).toContain('設定の項目名は端末やバージョンによって異なります');
    mocks.orientationStatus.value = 'granted';
    await nextTick();
    expect(wrapper.find('.ar-orientation section').exists()).toBe(false);
  });
});

describe('R-02 仮置きの閾値', () => {
  it('位置誤差 25 m を超えると警告し、会場から 900 m を超えると距離の案内に変わる', async () => {
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    mocks.position.value = { ...fromXY(0, 0), accuracy: 25, takenAt: 1 };
    tick();
    expect(wrapper.get('.ar-warning').element.hasAttribute('hidden')).toBe(true);
    mocks.position.value = { ...fromXY(0, 0), accuracy: 25.1, takenAt: 2 };
    tick();
    expect(wrapper.get('.ar-warning').text()).toContain('位置の誤差が大きい');
    mocks.position.value = { ...fromXY(899, 0), accuracy: 5, takenAt: 3 };
    tick();
    expect(wrapper.get('.ar-warning').element.hasAttribute('hidden')).toBe(true);
    mocks.position.value = { ...fromXY(901, 0), accuracy: 5, takenAt: 4 };
    tick();
    expect(wrapper.get('.ar-warning').text()).toContain('会場から離れています');
  });

  it('方位差 62° を超えるラベルを非表示にする', async () => {
    const at = (degrees: number) => fromXY(100 * Math.sin(degrees * Math.PI / 180), 100 * Math.cos(degrees * Math.PI / 180));
    const wrapper = mount(ArView, { props: { ...props(), landmarks: [], places: [
      { ...places[0], id: 'inside', landmarkId: null, location: at(61.9) },
      { ...places[0], id: 'outside', landmarkId: null, location: at(62.1) },
    ] } });
    await start(wrapper);
    expect(wrapper.get('[data-place-id="inside"]').element.hasAttribute('hidden')).toBe(false);
    expect(wrapper.get('[data-place-id="outside"]').element.hasAttribute('hidden')).toBe(true);
  });

  it('遮蔽ラベルは 250 m 以内で 3 枚まで表示し、行き先は制限から除く', async () => {
    const obscured = [30, 40, 50, 60, 249, 251, 300].map((y, index) => ({
      ...places[1], id: `hidden-${index}`, location: fromXY(0, y),
    }));
    const wrapper = mount(ArView, { props: { ...props(), places: obscured } });
    await start(wrapper);
    const shown = () => wrapper.findAll('.ar-label').filter(label => !label.element.hasAttribute('hidden')).map(label => label.attributes('data-place-id'));
    expect(shown()).toEqual(['hidden-0', 'hidden-1', 'hidden-2']);
    await wrapper.setProps({ places: obscured.slice(4), destination: { placeId: 'hidden-6' } });
    tick();
    expect(shown()).toEqual(['hidden-4', 'hidden-6']);
  });

  it.each(['', '?fov=65', '?fov=0', '?fov=180', '?fov=-1', '?fov=invalid'])('%s は既定の画角 65° を使う', async search => {
    window.history.replaceState(null, '', `/${search}`);
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    const label = wrapper.get('[data-place-id="north-event"]').element as HTMLElement;
    mocks.heading.value = 40;
    tick();
    const withQuery = label.style.transform;
    window.history.replaceState(null, '', '/?fov=65');
    tick();
    expect(label.style.transform).toBe(withQuery);
    window.history.replaceState(null, '', '/?fov=90');
    tick();
    expect(label.style.transform).not.toBe(withQuery);
  });
});

describe('R-02 ラベルの更新は Vue のリアクティブを通らない', () => {
  it('位置・向きの変化は Vue を再描画せず、rAF が既存 DOM の表示と座標を直接更新する', async () => {
    const updated = vi.fn();
    const wrapper = mount(ArView, { props: props(), global: { mixins: [{ updated }] } });
    await start(wrapper);
    const label = wrapper.get('[data-place-id="north-event"]').element as HTMLElement;
    const original = label.style.transform;
    updated.mockClear();
    mocks.heading.value = 10;
    mocks.position.value = { ...fromXY(1, 0), accuracy: 5, takenAt: 2 };
    await nextTick();
    expect(updated).not.toHaveBeenCalled();
    expect(label.style.transform).toBe(original);
    tick(); // Vue の nextTick より前に DOM の更新が完了する。
    expect(wrapper.get('[data-place-id="north-event"]').element).toBe(label);
    expect(label.style.transform).not.toBe(original);
    await nextTick();
    expect(updated).not.toHaveBeenCalled();
    mocks.heading.value = 180;
    tick();
    expect(label.hidden).toBe(true);
    expect(updated).not.toHaveBeenCalled();
  });
});

describe('R-02 見えない画面の更新停止と解放', () => {
  it('タブ非表示と画面外で rAF とカメラを止め、表示時にループを一つだけ再開する', async () => {
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    expect(frames.size).toBe(1);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    expect(stop).toHaveBeenCalledOnce();
    expect(wrapper.get('video').element.srcObject).toBeNull();
    const calls = vi.mocked(ctx.clearRect).mock.calls.length;
    tick();
    expect(ctx.clearRect).toHaveBeenCalledTimes(calls);
    hidden = false;
    viewport(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    viewport(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(frames.size).toBe(1);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(frames.size).toBe(0);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(disconnect).toHaveBeenCalledOnce();
    viewport(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it.each(['hidden', 'unmount'])('カメラ許可の待機中に %s となったら、遅れて届く stream を破棄する', async mode => {
    let resolve!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(() => new Promise<MediaStream>(done => { resolve = done; }));
    const wrapper = mount(ArView, { props: props() });
    await wrapper.get('.ar-start button').trigger('click');
    if (mode === 'unmount') wrapper.unmount();
    else { hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
    resolve(stream);
    await flushPromises();
    expect(stop).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });
});

describe('R-02 CameraView の既存ストア・保存・経路との接続', () => {
  it('保存された行き先を表示して端末内で案内をやめ、ラベルと正面パネルから既存経路へ移動する', async () => {
    mocks.getDestination.mockResolvedValue({ placeId: 'north-event' });
    const pinia = createPinia();
    usePlacesStore(pinia).setAll(places);
    useLandmarksStore(pinia).setAll(buildings);
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/camera', name: 'camera', component: CameraView },
      ...['card', 'building', 'map', 'list', 'noloc'].map(name => ({ path: `/${name}/:id?`, name, component: { template: '<div />' } })),
    ] });
    await router.push('/camera');
    const wrapper = mount(CameraView, { global: { plugins: [pinia, router] } });
    await flushPromises();
    await start(wrapper);
    expect(wrapper.get('.ar-guide').text()).toContain('北棟の企画まで 18 m');
    await wrapper.get('.ar-guide button').trigger('click');
    await flushPromises();
    tick();
    expect(mocks.clearDestination).toHaveBeenCalledOnce();
    expect(wrapper.get('.ar-guide').element.hasAttribute('hidden')).toBe(true);
    await wrapper.get('[data-place-id="north-event"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value).toMatchObject({ name: 'card', params: { id: 'north-event' } });
    await wrapper.get('.ar-front').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value).toMatchObject({ name: 'building', params: { id: 'north' } });
    expect(wrapper.get('nav').text()).toContain('地図');
    expect(wrapper.get('nav').text()).toContain('企画一覧');
    mocks.position.value = null;
    mocks.status.value = 'denied';
    await nextTick();
    const locationLink = wrapper.findAll('a').find(link => link.text() === '位置の設定を確認する')!;
    expect(locationLink.attributes('href')).toBe('/noloc');
    await locationLink.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('noloc');
  });
});
