import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import MapCanvas from './MapCanvas.vue';
import { project, type View } from './core';
import { K_MAX, K_MIN, TH0 } from './interaction';
import { layers } from './layers';
import type { MapState } from './layers/types';

enableAutoUnmount(afterEach);

const state = (): MapState => ({
  places: [], stamps: [], landmarks: [], position: null, destination: null,
  filter: { labelIds: [], tagIds: [] }, now: 0,
});
let resizeCallback: ResizeObserverCallback;
let intersectionCallback: IntersectionObserverCallback;
let resizeObserver: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
let intersectionObserver: typeof resizeObserver;
let ctx: { setTransform: ReturnType<typeof vi.fn>; clearRect: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> };
let rect: DOMRect;
let hidden: boolean;
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let captured: Set<number>;
let draws: { name: string; view: View; state: MapState; t: number }[];

beforeEach(() => {
  rect = new DOMRect(24, 40, 480, 640);
  hidden = false;
  frames = new Map();
  frameId = 0;
  captured = new Set();
  draws = [];
  ctx = { setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
  vi.spyOn(HTMLCanvasElement.prototype, 'setPointerCapture').mockImplementation((id) => { captured.add(id); });
  vi.spyOn(HTMLCanvasElement.prototype, 'hasPointerCapture').mockImplementation((id) => captured.has(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'releasePointerCapture').mockImplementation((id) => { captured.delete(id); });
  resizeObserver = { observe: vi.fn(), disconnect: vi.fn() };
  intersectionObserver = { observe: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal('ResizeObserver', vi.fn(function (callback: ResizeObserverCallback) {
    resizeCallback = callback;
    return resizeObserver;
  }));
  vi.stubGlobal('IntersectionObserver', vi.fn(function (callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
    return intersectionObserver;
  }));
  for (const layer of layers) {
    vi.spyOn(layer, 'draw').mockImplementation((_ctx, view, state, t) => {
      draws.push({ name: layer.name, view: { ...view }, state, t });
    });
  }
});

afterEach(() => {
  for (const layer of layers) delete layer.hitTest;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function tick(t = 100) {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(t);
}
const lastView = () => draws[draws.length - 1].view;
function pointer(cv: HTMLCanvasElement, type: string, x: number, y: number, options: PointerEventInit = {}) {
  cv.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, button: 0, clientX: rect.left + x, clientY: rect.top + y,
    bubbles: true, ...options,
  }));
}
function wheel(cv: HTMLCanvasElement, deltaY: number) {
  const event = new WheelEvent('wheel', { clientX: rect.left + 120, clientY: rect.top + 80, deltaY, cancelable: true });
  cv.dispatchEvent(event);
  return event;
}
function intersect(cv: HTMLCanvasElement, isIntersecting: boolean) {
  intersectionCallback([{
    target: cv, isIntersecting, time: 0, rootBounds: null,
    boundingClientRect: rect, intersectionRect: rect, intersectionRatio: isIntersecting ? 1 : 0,
  }], intersectionObserver as unknown as IntersectionObserver);
}
function resize(cv: HTMLCanvasElement, width: number, height: number) {
  rect = new DOMRect(rect.left, rect.top, width, height);
  const size = [{ inlineSize: width, blockSize: height }];
  resizeCallback([{
    target: cv, contentRect: rect, borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size,
  }], resizeObserver as unknown as ResizeObserver);
}

describe('MapCanvas の描画とライフサイクル', () => {
  it('canvas 1 枚を dpr に合わせ、stepView の後で layers の順に毎フレーム描く', async () => {
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    const cv = wrapper.get('canvas').element;
    expect(wrapper.findAll('canvas')).toHaveLength(1);
    expect([cv.width, cv.height]).toEqual([960, 1280]);
    expect(resizeObserver.observe).toHaveBeenCalledWith(cv);
    expect(intersectionObserver.observe).toHaveBeenCalledWith(cv);
    expect(frames.size).toBe(1);
    tick(1234);
    expect(draws.map((draw) => draw.name)).toEqual(layers.map((layer) => layer.name));
    expect(draws.every((draw) => draw.t === 1234)).toBe(true);
    expect(lastView()).toEqual({ fx: 0, fy: 0, k: 480 / 240, th: TH0, cy: 320 });
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 480, 640);
    expect(ctx.save).toHaveBeenCalledTimes(layers.length);
    expect(ctx.restore).toHaveBeenCalledTimes(layers.length);
    const updated = { ...state(), now: 42 };
    await wrapper.setProps({ state: updated });
    tick(1250);
    expect(draws.at(-1)?.state.now).toBe(42);
    expect(draws).toHaveLength(layers.length * 2);
    expect(frames.size).toBe(1);
  });

  it('ResizeObserver と window resize でサイズ・dpr を更新し、拡大率を維持する', () => {
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    const cv = wrapper.get('canvas').element;
    tick();
    resize(cv, 600, 800);
    tick();
    expect([cv.width, cv.height]).toEqual([1200, 1600]);
    expect(lastView().k).toBe(2);
    expect(lastView().cy).toBeCloseTo(320 + (400 - 320) * 0.16);
    vi.stubGlobal('devicePixelRatio', 4);
    window.dispatchEvent(new Event('resize'));
    tick();
    expect([cv.width, cv.height]).toEqual([1800, 2400]);
    expect(ctx.setTransform).toHaveBeenLastCalledWith(3, 0, 0, 3, 0, 0);
    vi.stubGlobal('devicePixelRatio', 0);
    window.dispatchEvent(new Event('resize'));
    expect([cv.width, cv.height]).toEqual([600, 800]);
  });

  it('初回サイズが 0 なら描かず、初めて正のサイズになった時に k を初期化する', () => {
    rect = new DOMRect(0, 0, 0, 0);
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    const cv = wrapper.get('canvas').element;
    expect(frames.size).toBe(0);
    resize(cv, 360, 600);
    tick();
    expect(lastView().k).toBe(360 / 240);
    resize(cv, 0, 0);
    expect(frames.size).toBe(0);
    resize(cv, 480, 640);
    tick();
    expect(lastView().k).toBe(360 / 240);
  });

  it('タブ非表示で rAF を cancel し、表示時に 1 本だけ再開する', () => {
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    tick();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    const count = draws.length;
    tick();
    expect(draws).toHaveLength(count);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(1);
    tick();
    expect(draws).toHaveLength(count + layers.length);
    expect(wrapper.exists()).toBe(true);
  });

  it('画面外とタブ非表示の両方を考慮し、非表示時はドラッグも破棄する', () => {
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    const cv = wrapper.get('canvas').element;
    tick();
    pointer(cv, 'pointerdown', 100, 100);
    expect(captured.size).toBe(1);
    intersect(cv, false);
    expect(captured.size).toBe(0);
    expect(frames.size).toBe(0);
    hidden = true;
    intersect(cv, true);
    expect(frames.size).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    pointer(cv, 'pointermove', 200, 100);
    pointer(cv, 'pointerup', 200, 100);
    tick();
    expect(lastView().fx).toBe(0);
    expect(wrapper.emitted('tap')).toBeUndefined();
  });

  it('最初から非表示なら描かず、IntersectionObserver がなくてもタブ表示で再開する', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    hidden = true;
    mount(MapCanvas, { props: { state: state() } });
    expect(frames.size).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    tick();
    expect(draws).toHaveLength(layers.length);
  });

  it('unmount で observer・listener・rAF・pointer capture を解放する', () => {
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    const cv = wrapper.get('canvas').element;
    tick();
    pointer(cv, 'pointerdown', 100, 100);
    wrapper.unmount();
    expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(intersectionObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(captured.size).toBe(0);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('resize'));
    intersect(cv, true);
    resize(cv, 480, 640);
    pointer(cv, 'pointerdown', 100, 100);
    pointer(cv, 'pointerup', 100, 100);
    expect(captured.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(wrapper.emitted('tap')).toBeUndefined();
  });
});

describe('MapCanvas の DOM 操作', () => {
  it('パン・ホイール・Shift/右ドラッグ・ピンチ・コンパスが描画される視点を変える', async () => {
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    const cv = wrapper.get('canvas').element;
    tick();
    const first = { ...lastView() };
    pointer(cv, 'pointerdown', 100, 100);
    pointer(cv, 'pointermove', 150, 130);
    pointer(cv, 'pointerup', 150, 130);
    tick();
    expect(lastView().fx).not.toBe(first.fx);
    expect(lastView().fy).not.toBe(first.fy);
    expect(wheel(cv, -100).defaultPrevented).toBe(true);
    tick();
    expect(lastView().k).toBeGreaterThan(first.k);
    pointer(cv, 'pointerdown', 100, 100, { shiftKey: true });
    pointer(cv, 'pointermove', 150, 100);
    pointer(cv, 'pointerup', 150, 100);
    tick();
    expect(lastView().th).toBeGreaterThan(TH0);
    const shifted = lastView().th;
    pointer(cv, 'pointerdown', 100, 100, { button: 2 });
    pointer(cv, 'pointermove', 160, 100, { button: 2 });
    pointer(cv, 'pointerup', 160, 100, { button: 2 });
    tick();
    expect(lastView().th).toBeGreaterThan(shifted);
    pointer(cv, 'pointerdown', 100, 100);
    pointer(cv, 'pointerdown', 200, 100, { pointerId: 2 });
    const beforePinch = { ...lastView() };
    pointer(cv, 'pointermove', 260, 80, { pointerId: 2 });
    pointer(cv, 'pointerup', 260, 80, { pointerId: 2 });
    pointer(cv, 'pointerup', 100, 100);
    tick();
    expect(lastView().k).toBeGreaterThan(beforePinch.k);
    expect(lastView().th).not.toBe(beforePinch.th);
    await wrapper.get('button[aria-label="向きを戻す"]').trigger('click');
    for (let i = 0; i < 100; i++) tick();
    expect(lastView().th).toBe(TH0);
    const v = lastView();
    const [x0, y0] = project(v, rect.width, rect.height, v.fx, v.fy);
    const [x1, y1] = project(v, rect.width, rect.height, v.fx, v.fy + 10);
    expect(wrapper.get('svg').element.style.transform).toBe(`rotate(${Math.atan2(x1 - x0, -(y1 - y0))}rad)`);
    expect(wrapper.emitted('tap')).toBeUndefined();
    expect(captured.size).toBe(0);
  });

  it('ホイールの倍率は上下限を超えない', () => {
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    const cv = wrapper.get('canvas').element;
    wheel(cv, -1000000);
    for (let i = 0; i < 100; i++) tick();
    expect(lastView().k).toBe(K_MAX);
    wheel(cv, 1000000);
    for (let i = 0; i < 100; i++) tick();
    expect(lastView().k).toBe(K_MIN);
  });

  it('タップは canvas 内の CSS px で emit し、配列の後ろから最初に当たる層を select する', () => {
    const back = vi.fn(() => ({ kind: 'building' as const, id: 'back' }));
    const front = vi.fn(() => ({ kind: 'place' as const, id: 'front' }));
    const miss = vi.fn(() => null);
    layers[0].hitTest = back;
    layers[3].hitTest = front;
    layers[4].hitTest = miss;
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    const cv = wrapper.get('canvas').element;
    tick();
    pointer(cv, 'pointerdown', 100, 100);
    pointer(cv, 'pointerup', 104, 100);
    expect(wrapper.emitted('tap')).toEqual([[104, 100]]);
    expect(wrapper.emitted('select')).toEqual([[{ kind: 'place', id: 'front' }]]);
    expect(miss).toHaveBeenCalledWith(104, 100);
    expect(front).toHaveBeenCalledWith(104, 100);
    expect(back).not.toHaveBeenCalled();
  });

  it('pointercancel・lostpointercapture はタップせず、contextmenu を抑止する', () => {
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    const cv = wrapper.get('canvas').element;
    pointer(cv, 'pointerdown', 100, 100);
    pointer(cv, 'pointercancel', 100, 100);
    pointer(cv, 'pointerdown', 100, 100);
    pointer(cv, 'lostpointercapture', 100, 100);
    pointer(cv, 'pointerup', 100, 100);
    expect(wrapper.emitted('tap')).toBeUndefined();
    const event = new MouseEvent('contextmenu', { cancelable: true });
    cv.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('MapCanvas の公開操作', () => {
  it('zoomBy は画面中央を保って拡大・縮小し、上限・下限を通知する', async () => {
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    tick();
    expect(wrapper.emitted('zoomLimits')?.at(-1)).toEqual([{ zoomInDisabled: false, zoomOutDisabled: false }]);
    wrapper.vm.zoomBy(1);
    for (let i = 0; i < 120; i++) tick();
    expect(lastView().k).toBeCloseTo(2 * 1.25);
    expect(project(lastView(), 480, 640, 0, 0).slice(0, 2)).toEqual([240, 320]);
    wrapper.vm.zoomBy(-1);
    for (let i = 0; i < 120; i++) tick();
    expect(lastView().k).toBeCloseTo(2);
    wrapper.vm.zoomBy(100);
    await wrapper.vm.$nextTick();
    for (let i = 0; i < 120; i++) tick();
    expect(lastView().k).toBeCloseTo(K_MAX);
    expect(wrapper.emitted('zoomLimits')?.at(-1)).toEqual([{ zoomInDisabled: true, zoomOutDisabled: false }]);
    wrapper.vm.zoomBy(-100);
    await wrapper.vm.$nextTick();
    for (let i = 0; i < 120; i++) tick();
    expect(lastView().k).toBeCloseTo(K_MIN);
    expect(wrapper.emitted('zoomLimits')?.at(-1)).toEqual([{ zoomInDisabled: false, zoomOutDisabled: true }]);
    wrapper.vm.zoomBy(1);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('zoomLimits')?.at(-1)).toEqual([{ zoomInDisabled: false, zoomOutDisabled: false }]);
  });

  it('flyTo は最新の現在地へ移動し、位置がなければ移動しない', async () => {
    const { fromXY } = await import('../domain/geo');
    const wrapper = mount(MapCanvas, { props: { state: state() } });
    tick();
    wrapper.vm.flyTo(); tick();
    expect([lastView().fx, lastView().fy]).toEqual([0, 0]);
    for (const [x, y] of [[100, -50], [-40, 80]]) {
      await wrapper.setProps({ state: { ...state(), position: { ...fromXY(x, y), accuracy: 8, takenAt: 0 } } });
      wrapper.vm.flyTo();
      for (let i = 0; i < 120; i++) tick();
      expect(lastView().fx).toBeCloseTo(x);
      expect(lastView().fy).toBeCloseTo(y);
      expect(lastView().k).toBe(2);
    }
    await wrapper.setProps({ state: state() });
    wrapper.vm.flyTo(); tick();
    expect(lastView().fx).toBeCloseTo(-40);
    expect(lastView().fy).toBeCloseTo(80);
  });
});
