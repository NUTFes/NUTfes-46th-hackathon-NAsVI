import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import Sheet from './Sheet.vue';

enableAutoUnmount(afterEach);

describe('Sheet', () => {
  it('見出し・補足・中身を出し、見出しで名前を付ける', () => {
    const wrapper = mount(Sheet, {
      props: { title: '混雑を足元に押す', subtitle: 'いまいる場所の混み具合を、みんなに知らせます。' },
      slots: { default: '<p class="inner">中身</p>' },
    });
    const heading = wrapper.get('h2');
    expect(heading.text()).toBe('混雑を足元に押す');
    expect(wrapper.get('section').attributes('aria-labelledby')).toBe(heading.attributes('id'));
    expect(wrapper.text()).toContain('いまいる場所の混み具合を');
    expect(wrapper.get('.inner').text()).toBe('中身');
  });

  it('level=1 で h1 にする。補足が無ければ出さない', () => {
    const wrapper = mount(Sheet, { props: { title: 'T', level: 1 } });
    expect(wrapper.find('h1').exists()).toBe(true);
    expect(wrapper.find('.nv-sheet__subtitle').exists()).toBe(false);
  });

  it('閉じる(44px の IconButton)を押すと close を出す', async () => {
    const wrapper = mount(Sheet, { props: { title: 'T' } });
    await wrapper.get('button[aria-label="閉じる"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
