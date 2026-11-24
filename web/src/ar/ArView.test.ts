import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { fromXY } from '../domain/geo';
import { useLandmarksStore, usePlacesStore } from '../stores';
import type { Position } from '../types';
import ArView from './ArView.vue';
import arSource from './ArView.vue?raw';
import labelSource from '../components/ui/CameraLabel.vue?raw';
import overlaySource from '../components/ui/BuildingCameraOverlay.vue?raw';
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
let resize: (target: Element, width: number, height: number) => void;
let observeSize: ReturnType<typeof vi.fn>;
let unobserveSize: ReturnType<typeof vi.fn>;
let disconnectSize: ReturnType<typeof vi.fn>;

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
  observeSize = vi.fn((target: Element) => resize(target, target.tagName === 'MAIN' ? 400 : 160, target.tagName === 'MAIN' ? 800 : 60));
  unobserveSize = vi.fn();
  disconnectSize = vi.fn();
  vi.stubGlobal('ResizeObserver', vi.fn(function (callback: ResizeObserverCallback) {
    resize = (target, width, height) => callback([{
      target, borderBoxSize: [{ inlineSize: width, blockSize: height }], contentRect: new DOMRect(0, 0, width, height),
    } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    return { observe: observeSize, unobserve: unobserveSize, disconnect: disconnectSize };
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
  it('操作を起点に既存サービスと背面カメラを開始し、video と角丸四角のミニマップ canvas を持つ', async () => {
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
    expect(video.getAttribute('aria-hidden')).toBe('true');
    expect(video.hasAttribute('aria-label')).toBe(false);
    expect(wrapper.get('canvas').attributes('width')).toBe('240');
    expect(ctx.arc).toHaveBeenCalledWith(120, 120, 9, 0, Math.PI * 2); // 現在地の白い点
    expect(ctx.clip).not.toHaveBeenCalled(); // 角は CSS の border-radius で丸める
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
    await nextTick(); // 状態の切り替えだけは Vue が再描画する。
    expect(wrapper.get('.nv-cam-overlay__hint').text()).toContain('左右にドラッグして向きを合わせる');
    expect(wrapper.get('.nv-cam-overlay__status').text()).toContain('向きが分かりません');
    expect(wrapper.get('.nv-cam-overlay').attributes('data-state')).toBe('unknown');
    mocks.position.value = null;
    mocks.status.value = 'denied';
    tick();
    expect(wrapper.get('.nv-cam-overlay__status').text()).toContain('位置情報を許可してください');
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

  it('HTTPS でカメラ API がない場合は非対応と案内する', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('location', { protocol: 'https:', search: '' });
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    expect(wrapper.get('.ar-warning').text()).toContain('このブラウザはカメラの利用に対応していません');
    expect(wrapper.get('.ar-warning').text()).not.toContain('HTTP では');
    expect(getUserMedia).not.toHaveBeenCalled();
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

describe('R-02 ResizeObserver による寸法の保持', () => {
  it('フレーム内でレイアウトや計算済みスタイルを読まない', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => { throw new Error('rAF 内の寸法読み取りは禁止'); });
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => { throw new Error('offsetWidth 禁止'); });
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => { throw new Error('offsetHeight 禁止'); });
    const style = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => { throw new Error('rAF 内のスタイル読み取りは禁止'); });
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    mocks.heading.value = 10;
    tick();
    tick();
    expect(rect).not.toHaveBeenCalled();
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
    expect(style).not.toHaveBeenCalled();
    expect(wrapper.get('[data-place-id="north-event"]').element.hasAttribute('hidden')).toBe(false);
  });

  it('ラベルの border-box と画面のリサイズを次のフレームで反映し、非表示の 0 は寸法に使わない', async () => {
    const wrapper = mount(ArView, { props: props() });
    await start(wrapper);
    const label = wrapper.get('[data-place-id="north-event"]').element as HTMLElement;
    expect(observeSize).toHaveBeenCalledWith(wrapper.element, { box: 'border-box' });
    expect(observeSize).toHaveBeenCalledWith(label, { box: 'border-box' });
    expect(label.style.transform).toContain('translate(120px,');
    resize(label, 200, 80);
    tick();
    expect(label.style.transform).toContain('translate(100px,');
    const resized = label.style.transform;
    resize(label, 0, 0);
    tick();
    expect(label.style.transform).toBe(resized);
    resize(wrapper.element, 800, 400);
    tick();
    expect(label.style.transform).toContain('translate(300px,');
    await wrapper.setProps({ places: [] });
    tick();
    expect(unobserveSize).toHaveBeenCalledWith(label);
    wrapper.unmount();
    expect(disconnectSize).toHaveBeenCalledOnce();
  });

  it('画面の初回寸法が届くまで描画を待つ', async () => {
    const wrapper = mount(ArView, { props: props() });
    resize(wrapper.element, 0, 0);
    await start(wrapper);
    expect(ctx.clearRect).not.toHaveBeenCalled();
    resize(wrapper.element, 400, 800);
    tick();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(wrapper.get('.ar-front').text()).toContain('北棟');
  });
});

describe('R-02 最寄りテーマと映像上のコントラスト', () => {
  it.each([
    [undefined, '#130a22', '#1c1032', '#f4f0ff', '#5eead4'],
    ['dark', '#130a22', '#1c1032', '#f4f0ff', '#5eead4'],
    ['unknown', '#130a22', '#1c1032', '#f4f0ff', '#5eead4'],
    ['light', '#f6f4fa', '#ffffff', '#1e0b3a', '#0f766e'],
  ])('%s の解決済みトークンを DOM とミニマップで使う', async (theme, bg, surface, text, event) => {
    const wrapper = mount(ArView, { props: props(), attrs: theme ? { 'data-theme': theme } : {} });
    await start(wrapper);
    const style = (wrapper.element as HTMLElement).style;
    expect(style.getPropertyValue('--ar-bg')).toBe(bg);
    expect(style.getPropertyValue('--ar-surface')).toBe(surface);
    expect(style.getPropertyValue('--ar-text')).toBe(text);
    expect(style.getPropertyValue('--ar-event')).toBe(event);
    expect(ctx.fillStyle).toBe(text);
  });

  it('最寄りテーマを優先し、属性の変更・追加・削除に追随して、アンマウント時に監視を解放する', async () => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    outer.dataset.theme = 'light';
    inner.dataset.theme = 'dark';
    outer.append(inner);
    document.body.append(outer);
    const mutationDisconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const wrapper = mount(ArView, { props: props(), attachTo: inner });
    const style = (wrapper.element as HTMLElement).style;
    const color = () => style.getPropertyValue('--ar-bg');
    try {
      await start(wrapper);
      expect(color()).toBe('#130a22');
      inner.removeAttribute('data-theme');
      await vi.waitFor(() => expect(color()).toBe('#f6f4fa'));
      tick();
      expect(ctx.fillStyle).toBe('#1e0b3a');
      inner.dataset.theme = 'unknown';
      await vi.waitFor(() => expect(color()).toBe('#130a22'));
      inner.dataset.theme = 'light';
      await vi.waitFor(() => expect(color()).toBe('#f6f4fa'));
      inner.dataset.theme = 'dark';
      await vi.waitFor(() => expect(color()).toBe('#130a22'));
      inner.removeAttribute('data-theme');
      await vi.waitFor(() => expect(color()).toBe('#f6f4fa'));
      outer.removeAttribute('data-theme');
      await vi.waitFor(() => expect(color()).toBe('#130a22'));
      wrapper.unmount();
      expect(mutationDisconnect).toHaveBeenCalledOnce();
    } finally {
      outer.remove();
    }
  });

  it.each(['dark', 'light'])('%s の映像上の文字は不透明な背景で 4.5:1 以上のコントラストを保つ', async theme => {
    // Vitest は SFC の CSS を挿入しないので、本番のスタイルを DOM に載せる。
    const stylesheet = document.createElement('style');
    stylesheet.textContent = [arSource, labelSource, overlaySource].map(source => source.match(/<style>([\s\S]*)<\/style>/)![1]).join('\n');
    document.head.append(stylesheet);
    const host = document.createElement('div');
    document.body.append(host);
    const wrapper = mount(ArView, { props: props(), attrs: { 'data-theme': theme }, attachTo: host });
    await start(wrapper);
    const style = (wrapper.element as HTMLElement).style;
    const luminance = (hex: string) => {
      const channels = hex.slice(1).match(/../g)!.map(value => Number.parseInt(value, 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    for (const [bg, fg] of [['surface', 'text'], ['event', 'event-on'], ['facility', 'facility-on'], ['destination', 'destination-on'], ['danger-bg', 'danger-text'], ['action', 'action-on']]) {
      const background = style.getPropertyValue(`--ar-${bg}`);
      const foreground = style.getPropertyValue(`--ar-${fg}`);
      expect(background).toMatch(/^#[\da-f]{6}$/i);
      const a = luminance(background), b = luminance(foreground);
      expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
    // 実際に映像に重なる札・照準・案内帯にも上記の背景と文字色が当たる。
    try {
      const computed = (selector: string) => window.getComputedStyle(wrapper.get(selector).element);
      expect(computed('.nv-cam-overlay__status').backgroundColor).toBe(theme === 'dark' ? '#1c1032' : '#ffffff');
      // Figma: 建物の奥の札は facility 色で不透明度 0.6。
      expect(computed('.ar-label--far').opacity).toBe('0.6');
      // 2 枚目以降も原点基準(draw() の translate 前提)で絶対配置される。
      for (const label of wrapper.findAll('.ar-label')) {
        expect(window.getComputedStyle(label.element).position).toBe('absolute');
        expect(window.getComputedStyle(label.element).left).toBe('0px');
        expect(window.getComputedStyle(label.element).top).toBe('0px');
      }
      expect(computed('.ar-label--far').backgroundColor).toBe(theme === 'dark' ? '#f4f0ff' : '#1e0b3a');
    } finally {
      wrapper.unmount();
      host.remove();
      stylesheet.remove();
    }
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
    // 画面の切り替えは下のタブ(App)に任せ、カメラ画面では出さない。
    expect(wrapper.find('nav').exists()).toBe(false);
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
