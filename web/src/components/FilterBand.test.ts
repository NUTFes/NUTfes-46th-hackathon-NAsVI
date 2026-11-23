import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import FilterBand from './FilterBand.vue';

enableAutoUnmount(afterEach);

const emptyHint = 'お気に入りはまだありません。場所のカードの ☆ で付けられます';

describe('FilterBand', () => {
  it('labels が空なら件数や補足があっても何も描画しない', () => {
    const wrapper = mount(FilterBand, { props: { labels: [], count: 0, emptyHint } });
    expect(wrapper.find('*').exists()).toBe(false);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it.each([
    { labels: ['飲食'], expected: '『飲食』で絞り込み中・3 件' },
    { labels: ['飲食', '体験', '行きたい場所'], expected: '『飲食・体験・行きたい場所』で絞り込み中・3 件' },
  ])('選択した名前と、渡された件数を status に表示する: $labels', ({ labels, expected }) => {
    const wrapper = mount(FilterBand, { props: { labels, count: 3 } });
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
    expect(wrapper.get('.filter-band__summary').text()).toBe(expected);
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('.filter-band__hint').exists()).toBe(false);
  });

  it('count が未指定なら件数も0件の補足も出さない', () => {
    const wrapper = mount(FilterBand, { props: { labels: ['お気に入り'], emptyHint } });
    expect(wrapper.get('.filter-band__summary').text()).toBe('『お気に入り』で絞り込み中');
    expect(wrapper.find('.filter-band__hint').exists()).toBe(false);
  });

  it('0件で emptyHint があれば、補足を2行目の段落に出す', () => {
    const wrapper = mount(FilterBand, { props: { labels: ['お気に入り'], count: 0, emptyHint } });
    const lines = wrapper.get('[role="status"]').findAll('p');
    expect(lines.map((line) => line.text())).toEqual([
      '『お気に入り』で絞り込み中・0 件',
      emptyHint,
    ]);
    expect(lines[1].classes()).toContain('filter-band__hint');
  });

  it.each([
    { count: 0, emptyHint: undefined },
    { count: 0, emptyHint: '' },
    { count: 2, emptyHint },
  ])('0件と補足が両方そろわなければ2行目を出さない: %o', (props) => {
    const wrapper = mount(FilterBand, { props: { labels: ['お気に入り'], ...props } });
    expect(wrapper.findAll('p')).toHaveLength(1);
    expect(wrapper.get('.filter-band__summary').text()).toBe(`『お気に入り』で絞り込み中・${props.count} 件`);
  });

  it('解除を押すと clear だけを emit し、labels は変更しない', async () => {
    const labels = ['飲食', '行きたい場所'];
    Object.freeze(labels);
    const wrapper = mount(FilterBand, { props: { labels, count: 2 } });
    const button = wrapper.get('button');
    expect(button.text()).toBe('解除');
    expect(button.attributes('type')).toBe('button');
    await button.trigger('click');
    expect(wrapper.emitted('clear')).toEqual([[]]);
    expect(labels).toEqual(['飲食', '行きたい場所']);
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);

    await wrapper.setProps({ labels: [] });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});
