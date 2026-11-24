import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import Component from './MapLocateButton.vue';
enableAutoUnmount(afterEach);
describe('MapLocateButton', () => {
  it('名前付きのボタンで操作を通知する', async () => {
    const wrapper = mount(Component, { props: { label: '現在地へ戻る' } });
    expect(wrapper.get('button').attributes('aria-label')).toBeTruthy();
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('press')).toHaveLength(1);
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
  });
  it('無効時は操作しない', async () => {
    const wrapper = mount(Component, { props: { ...{ label: '現在地へ戻る' }, disabled: true } });
    expect(wrapper.get('button').attributes('disabled')).toBeDefined();
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('press')).toBeUndefined();
    expect(wrapper.get('svg').attributes('data-icon')).toBe('locate-off');
  });
});
