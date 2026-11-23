import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import type { FilterState, Label, MyTag } from '../types';
import FilterChips from './FilterChips.vue';

enableAutoUnmount(afterEach);

const labels: Label[] = [
  { id: 'food', title: '飲食' },
  { id: 'experience', title: '体験' },
];
const tags: MyTag[] = [
  { id: 'want', title: '行きたい場所', builtin: true },
  { id: 'favorite', title: 'お気に入り', builtin: true },
  { id: 'custom', title: 'あとで回る', builtin: false },
];

describe('FilterChips', () => {
  it.each([
    { key: 'labelIds', title: '種類', index: 1, id: 'experience' },
    { key: 'tagIds', title: '自分用タグ', index: 1, id: 'favorite' },
  ] as const)('$title を追加・解除し、元の props を変更しない', async ({ key, title, index, id }) => {
    const modelValue: FilterState = { labelIds: ['food'], tagIds: ['want'] };
    const before = structuredClone({ labels, tags, modelValue });
    Object.freeze(modelValue.labelIds);
    Object.freeze(modelValue.tagIds);
    Object.freeze(modelValue);
    const wrapper = mount(FilterChips, { props: { labels, tags, modelValue } });
    const button = wrapper.get(`[aria-label="${title}"]`).findAll('button')[index];

    expect(button.attributes('type')).toBe('button');
    expect(button.attributes('aria-pressed')).toBe('false');
    expect(button.find('.filter-chips__check').exists()).toBe(false);
    await button.trigger('click');
    const next = wrapper.emitted<[FilterState]>('update:modelValue')![0][0];
    expect(next).toEqual({ ...modelValue, [key]: [...modelValue[key], id] });
    expect(next).not.toBe(modelValue);
    expect(next.labelIds).not.toBe(modelValue.labelIds);
    expect(next.tagIds).not.toBe(modelValue.tagIds);
    expect({ labels, tags, modelValue }).toEqual(before);

    // 表示は props が更新されるまで変わらない（内部で状態を持たない）。
    expect(button.attributes('aria-pressed')).toBe('false');
    await wrapper.setProps({ modelValue: next });
    expect(button.attributes('aria-pressed')).toBe('true');
    expect(button.get('.filter-chips__check').text()).toBe('✓');
    expect(button.get('.filter-chips__check').attributes('aria-hidden')).toBe('true');

    await button.trigger('click');
    const cleared = wrapper.emitted<[FilterState]>('update:modelValue')![1][0];
    expect(cleared).toEqual(modelValue);
    expect(next[key]).toContain(id);
    await wrapper.setProps({ modelValue: cleared });
    expect(button.attributes('aria-pressed')).toBe('false');
    expect(button.find('.filter-chips__check').exists()).toBe(false);
  });

  it('種類、タグの順に、渡された項目だけを区切り線で分けて表示する', () => {
    const wrapper = mount(FilterChips, {
      props: { labels, tags, modelValue: { labelIds: ['food'], tagIds: ['custom'] } },
    });
    expect(wrapper.findAll('button').map((button) => button.text().replace('✓', '').trim()))
      .toEqual(['飲食', '体験', '行きたい場所', 'お気に入り', 'あとで回る']);
    expect(wrapper.findAll('button').map((button) => button.attributes('aria-pressed')))
      .toEqual(['true', 'false', 'false', 'false', 'true']);
    expect(wrapper.findAll('.filter-chips__divider')).toHaveLength(1);
    expect(wrapper.element.children[1].className).toBe('filter-chips__divider');
  });

  it.each([
    { title: '種類', labels: [], tags, remaining: '自分用タグ', count: tags.length },
    { title: '自分用タグ', labels, tags: [], remaining: '種類', count: labels.length },
  ])('$title が0件ならその部分と区切り線を出さない', ({ title, labels, tags, remaining, count }) => {
    const wrapper = mount(FilterChips, {
      props: { labels, tags, modelValue: { labelIds: [], tagIds: [] } },
    });
    expect(wrapper.find(`[aria-label="${title}"]`).exists()).toBe(false);
    expect(wrapper.get(`[aria-label="${remaining}"]`).findAll('button')).toHaveLength(count);
    expect(wrapper.find('.filter-chips__divider').exists()).toBe(false);
  });

  it('種類もタグも0件なら何も描画しない', () => {
    const wrapper = mount(FilterChips, {
      props: { labels: [], tags: [], modelValue: { labelIds: [], tagIds: [] } },
    });
    expect(wrapper.find('*').exists()).toBe(false);
  });
});
