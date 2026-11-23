import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import SearchField from './SearchField.vue';

enableAutoUnmount(afterEach);

describe('SearchField', () => {
  it('虫めがねと入力を出し、placeholder が既定で読み上げの名前になる', () => {
    const wrapper = mount(SearchField);
    expect(wrapper.get('svg').attributes('data-icon')).toBe('search');
    const input = wrapper.get('input');
    expect(input.attributes('placeholder')).toBe('企画・場所を検索');
    expect(input.attributes('aria-label')).toBe('企画・場所を検索');
    expect(input.attributes('type')).toBe('search');
  });

  it('空のときは消去を出さない', () => {
    expect(mount(SearchField).find('button').exists()).toBe(false);
  });

  it('入力で update:modelValue を出す', async () => {
    const wrapper = mount(SearchField, { props: { modelValue: '' } });
    await wrapper.get('input').setValue('たこ');
    expect(wrapper.emitted('update:modelValue')).toEqual([['たこ']]);
  });

  it('入力中は右に × を出し、押すと空にして clear を出す', async () => {
    const wrapper = mount(SearchField, { props: { modelValue: 'たこやき' } });
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('たこやき');
    const clear = wrapper.get('button');
    expect(clear.attributes('aria-label')).toBe('入力を消す');
    await clear.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([['']]);
    expect(wrapper.emitted('clear')).toHaveLength(1);
  });

  it('placeholder を変えられる', () => {
    expect(mount(SearchField, { props: { placeholder: '建物を検索' } }).get('input').attributes('aria-label')).toBe('建物を検索');
  });

  it('naturalSearch で「文章で探す」を出す', async () => {
    expect(mount(SearchField).text()).not.toContain('文章で探す');
    const wrapper = mount(SearchField, { props: { naturalSearch: true } });
    expect(wrapper.text()).toContain('文章で探す');
    await wrapper.get('.nv-search__natural').trigger('click');
    expect(wrapper.emitted('natural')).toHaveLength(1);
  });
});
