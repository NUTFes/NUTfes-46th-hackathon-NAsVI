import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import EmptyState from './EmptyState.vue';

enableAutoUnmount(afterEach);

describe('EmptyState', () => {
  it('見出し・説明・既定のアイコン（search-off）を出す', () => {
    const wrapper = mount(EmptyState, { props: {
      title: '「たこやき」に一致する企画・場所はありません', body: '絞り込みを解除すると、見つかるかもしれません。',
    } });
    expect(wrapper.get('.nv-empty__title').text()).toBe('「たこやき」に一致する企画・場所はありません');
    expect(wrapper.get('.nv-empty__body').text()).toContain('絞り込みを解除');
    expect(wrapper.get('svg').attributes('data-icon')).toBe('search-off');
    expect(wrapper.get('svg').attributes('width')).toBe('40');
    expect(wrapper.attributes('aria-label')).toBe('「たこやき」に一致する企画・場所はありません');
  });

  it('body・actions が無ければ出さない。icon を変えられる', () => {
    const wrapper = mount(EmptyState, { props: { title: 't', icon: 'camera' } });
    expect(wrapper.find('.nv-empty__body').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.get('svg').attributes('data-icon')).toBe('camera');
  });

  it('操作は 3 つまで。先頭は primary、残りは secondary。押すと onPress', async () => {
    const calls: number[] = [];
    const wrapper = mount(EmptyState, { props: { title: 't', actions: [
      { label: '絞り込みを解除して探す', onPress: () => calls.push(1) },
      { label: '一覧を見る', onPress: () => calls.push(2) },
      { label: '地図に戻る', onPress: () => calls.push(3) },
      { label: '4 つ目' },
    ] } });
    const buttons = wrapper.findAll('button');
    expect(buttons.map(b => b.text())).toEqual(['絞り込みを解除して探す', '一覧を見る', '地図に戻る']);
    expect(buttons.map(b => b.attributes('data-variant'))).toEqual(['primary', 'secondary', 'secondary']);
    for (const button of buttons) await button.trigger('click');
    expect(calls).toEqual([1, 2, 3]);
  });
});
