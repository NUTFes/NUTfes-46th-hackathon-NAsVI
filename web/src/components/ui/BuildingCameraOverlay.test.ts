import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import BuildingCameraOverlay from './BuildingCameraOverlay.vue';

enableAutoUnmount(afterEach);
const slots = { status: '<span>現在地 ±8 m・北東を向いています</span>', front: '<b>正面: 図書館棟</b>', minimap: '<canvas />' };

describe('BuildingCameraOverlay', () => {
  it('recognized は状態・正面・十字・ミニマップを出し、ヒントは出さない', () => {
    const wrapper = mount(BuildingCameraOverlay, { slots });
    expect(wrapper.get('.nv-cam-overlay__status').text()).toContain('北東');
    expect(wrapper.get('.nv-cam-overlay__front').text()).toBe('正面: 図書館棟');
    expect(wrapper.find('.nv-cam-overlay__cross').exists()).toBe(true);
    expect(wrapper.find('canvas').exists()).toBe(true);
    expect(wrapper.find('.nv-cam-overlay__hint').exists()).toBe(false);
  });

  it('unknown は左右のドラッグのヒントを出す', () => {
    const wrapper = mount(BuildingCameraOverlay, { props: { state: 'unknown' }, slots });
    expect(wrapper.get('.nv-cam-overlay__hint').text()).toBe('左右にドラッグして向きを合わせる');
    expect(wrapper.attributes('data-state')).toBe('unknown');
  });
});
