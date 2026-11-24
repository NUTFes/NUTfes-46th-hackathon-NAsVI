import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import MapZoomButtons from './MapZoomButtons.vue';
enableAutoUnmount(afterEach);
describe('MapZoomButtons', () => {
  it('拡大と縮小を独立して通知し、限界の側だけ止める', async () => {
    const wrapper = mount(MapZoomButtons);
    const buttons = wrapper.findAll('button');
    await buttons[0].trigger('click');
    await buttons[1].trigger('click');
    expect(wrapper.emitted('zoomIn')).toHaveLength(1);
    expect(wrapper.emitted('zoomOut')).toHaveLength(1);
    await wrapper.setProps({ zoomInDisabled: true });
    await buttons[0].trigger('click');
    await buttons[1].trigger('click');
    expect(wrapper.emitted('zoomIn')).toHaveLength(1);
    expect(wrapper.emitted('zoomOut')).toHaveLength(2);
    expect(buttons[0].attributes('aria-label')).toBe('これ以上は拡大できません');
    await wrapper.setProps({ zoomInDisabled: false, zoomOutDisabled: true });
    await buttons[1].trigger('click');
    expect(wrapper.emitted('zoomOut')).toHaveLength(2);
  });
});

import { vi } from 'vitest';
import MapCanvas from '../../map/MapCanvas.vue';
import { layers } from '../../map/layers';
import { toXY } from '../../domain/geo';
import type { View } from '../../map/core';

it('公開操作は倍率の限界を通知し、現在地を地図の中心へ移す', async () => {
  let frame: FrameRequestCallback = () => {};
  let drawn: View | undefined;
  const ctx = { setTransform() {}, clearRect() {}, save() {}, restore() {} };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 480, 640));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  for (const layer of layers) vi.spyOn(layer, 'draw').mockImplementation((_ctx, view) => { drawn = { ...view }; });
  const wrapper = mount(MapCanvas, { props: { state: {
    places: [], stamps: [], landmarks: [], destination: null, filter: { labelIds: [], tagIds: [] }, now: 0,
    position: { lat: 37.4255, lng: 138.779, accuracy: 8, takenAt: 0 },
  } } });
  try {
    wrapper.vm.zoomBy(100);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.zoomInDisabled).toBe(true);
    expect(wrapper.emitted('zoomLimits')?.at(-1)).toEqual([{ zoomInDisabled: true, zoomOutDisabled: false }]);
    wrapper.vm.zoomBy(-100);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.zoomOutDisabled).toBe(true);
    wrapper.vm.flyTo();
    for (let i = 0; i < 100; i++) frame(i);
    const [x, y] = toXY(37.4255, 138.779);
    expect(drawn?.fx).toBeCloseTo(x, 2);
    expect(drawn?.fy).toBeCloseTo(y, 2);
    expect(drawn?.k).toBe(0.9);
  } finally {
    wrapper.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
