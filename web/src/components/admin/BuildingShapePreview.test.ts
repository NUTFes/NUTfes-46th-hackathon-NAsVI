import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import BuildingShapePreview from './BuildingShapePreview.vue';

describe('BuildingShapePreview', () => {
  it('空の形を文で伝え、再読込を通知する', async () => {
    const wrapper = mount(BuildingShapePreview, { props: { shape: null } });
    expect(wrapper.text()).toContain('形なし（カメラの正面に出ない）');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.text()).toContain('© OpenStreetMap contributors（ODbL）');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('reload')).toHaveLength(1);
    await wrapper.setProps({ disabled: true });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('reload')).toHaveLength(1);
    wrapper.unmount();
  });
  it('指定した輪郭を説明付き画像にする', () => {
    const shape = { viewBox: '0 0 100 50', d: 'M 0 0 L 100 0 L 100 50 Z' };
    const wrapper = mount(BuildingShapePreview, { props: { shape, label: '講義棟の形（北が上）' } });
    expect(wrapper.get('svg').attributes('viewBox')).toBe(shape.viewBox);
    expect(wrapper.get('svg').attributes('aria-label')).toBe('講義棟の形（北が上）');
    expect(wrapper.get('path').attributes('d')).toBe(shape.d);
    wrapper.unmount();
  });
});
