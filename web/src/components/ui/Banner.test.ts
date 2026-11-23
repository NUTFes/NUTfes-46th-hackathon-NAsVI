import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import Banner from './Banner.vue';

enableAutoUnmount(afterEach);

describe('Banner', () => {
  it('見出しと説明を role=alert で出す。既定は warning と警告の三角', () => {
    const wrapper = mount(Banner, { props: { title: '位置情報が使えません', body: '設定で許可してください' } });
    expect(wrapper.attributes('role')).toBe('alert');
    expect(wrapper.attributes('data-tone')).toBe('warning');
    expect(wrapper.get('.nv-banner__title').text()).toBe('位置情報が使えません');
    expect(wrapper.get('.nv-banner__body').text()).toBe('設定で許可してください');
    expect(wrapper.get('svg').attributes('data-icon')).toBe('alert');
  });

  it.each(['warning', 'error'] as const)('tone %s', tone => {
    expect(mount(Banner, { props: { title: 't', tone } }).classes()).toContain(`nv-banner--${tone}`);
  });

  it('body・actions が無ければ出さない', () => {
    const wrapper = mount(Banner, { props: { title: 't' } });
    expect(wrapper.find('.nv-banner__body').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('icon を変えられる', () => {
    expect(mount(Banner, { props: { title: 't', icon: 'info' } }).get('svg').attributes('data-icon')).toBe('info');
  });

  it('操作は 2 つまで。先頭は danger、次は secondary。押すと onPress', async () => {
    const calls: string[] = [];
    const wrapper = mount(Banner, { props: { title: 't', actions: [
      { label: '許可する', onPress: () => calls.push('a') },
      { label: '閉じる', onPress: () => calls.push('b') },
      { label: '3 つ目' },
    ] } });
    const buttons = wrapper.findAll('button');
    expect(buttons.map(b => b.text())).toEqual(['許可する', '閉じる']);
    expect(buttons.map(b => b.attributes('data-variant'))).toEqual(['danger', 'secondary']);
    await buttons[0].trigger('click');
    await buttons[1].trigger('click');
    expect(calls).toEqual(['a', 'b']);
  });

  it('操作の variant・disabled を上書きできる', () => {
    const button = mount(Banner, { props: { title: 't', actions: [{ label: 'x', variant: 'primary', disabled: true }] } }).get('button');
    expect(button.attributes('data-variant')).toBe('primary');
    expect(button.attributes('disabled')).toBeDefined();
  });
});
