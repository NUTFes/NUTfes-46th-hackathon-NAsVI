import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import PlaceRow from './PlaceRow.vue';

enableAutoUnmount(afterEach);

describe('PlaceRow（デザインシステムの props）', () => {
  it('表示用の種類・建物・階・直線距離を受け、名前からカードを開く', async () => {
    const onOpen = vi.fn();
    const wrapper = mount(PlaceRow, { props: {
      placeId: 'event-1', name: 'カード体験会', kindLabel: '体験', building: '図書館棟',
      floor: '2階', distanceM: 130.4, onOpen,
    } });
    expect(wrapper.text()).toContain('カード体験会');
    expect(wrapper.text()).toContain('体験');
    expect(wrapper.text()).toContain('図書館棟');
    expect(wrapper.text()).toContain('2階');
    expect(wrapper.get('.place-row__distance').text()).toBe('130 m');
    expect(wrapper.get('button').attributes('aria-label')).toBe('カード体験会、体験、図書館棟、2階、130 メートル');
    expect(wrapper.find('.place-row__tags').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    expect(onOpen).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([undefined, NaN, Infinity, -1])('現在地由来の距離が使えないときは表示しない: %s', distanceM => {
    const wrapper = mount(PlaceRow, { props: { placeId: 'p', name: '企画', distanceM, onOpen: vi.fn() } });
    expect(wrapper.find('.place-row__distance').exists()).toBe(false);
  });

  it('0 m と長い名前を省略せず読み上げられる', () => {
    const name = 'とても長い名前の企画です'.repeat(5);
    const wrapper = mount(PlaceRow, { props: { placeId: 'p', name, distanceM: 0, onOpen: vi.fn() } });
    expect(wrapper.get('.place-row__name').attributes('title')).toBe(name);
    expect(wrapper.get('button').attributes('aria-label')).toBe(`${name}、0 メートル`);
    expect(wrapper.get('.place-row__distance').text()).toBe('0 m');
  });

  it('一致した文字列をすべて強調し、HTML や正規表現として解釈しない', async () => {
    const wrapper = mount(PlaceRow, { props: {
      placeId: 'p', name: 'A.*<img> a.*', highlight: 'a.*', onOpen: vi.fn(),
    } });
    expect(wrapper.findAll('mark').map(mark => mark.text())).toEqual(['A.*', 'a.*']);
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.setProps({ highlight: '   ' });
    expect(wrapper.find('mark').exists()).toBe(false);
    expect(wrapper.get('.place-row__name').text()).toBe('A.*<img> a.*');
  });

  it('行きたい・お気に入りは独立したボタンで、次の状態だけを渡す', async () => {
    const tags = Object.freeze({ wantToGo: true, favorite: false });
    const onOpen = vi.fn();
    const onToggleTag = vi.fn();
    const wrapper = mount(PlaceRow, { props: { placeId: 'p', name: '企画', tags, onOpen, onToggleTag } });
    const buttons = wrapper.findAll('.place-row__tag');
    expect(buttons.map(button => button.attributes('aria-pressed'))).toEqual(['true', 'false']);
    expect(buttons.map(button => button.attributes('aria-label'))).toEqual(['企画の行きたい場所', '企画のお気に入り']);
    expect(wrapper.find('button button').exists()).toBe(false);
    await buttons[0].trigger('click');
    await buttons[1].trigger('click');
    expect(onToggleTag.mock.calls).toEqual([['wantToGo', false], ['favorite', true]]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(tags).toEqual({ wantToGo: true, favorite: false });
  });

  it.each([
    ['前ＡＢＣ後', 'abc', ['ＡＢＣ']],
    ['前abc後', 'ＡＢＣ', ['abc']],
    ['前ｶﾞﾗｽ後', 'ガラス', ['ｶﾞﾗｽ']],
    ['前ガラス後', 'ｶﾞﾗｽ', ['ガラス']],
    ['ｶﾞの後のＡＢＣ', 'abc', ['ＡＢＣ']],
    ['前㍿後', '株式会社', ['㍿']],
    ['ﬃの後のABC', 'abc', ['ABC']],
    ['前ﬃ後', 'f', ['ﬃ']],
    ['İの後のABC', 'abc', ['ABC']],
    ['前カ\u3099後', 'ガ', ['カ\u3099']],
    ['👩‍💻前ＡＢＣ後', 'abc', ['ＡＢＣ']],
    ['前ΟΣ後', 'ος', ['ΟΣ']],
  ])('正規化後の一致を元の文字範囲で強調する: %s / %s', (name, highlight, marks) => {
    const wrapper = mount(PlaceRow, { props: { placeId: 'p', name, highlight, onOpen: vi.fn() } });
    expect(wrapper.findAll('mark').map(mark => mark.text())).toEqual(marks);
    expect(wrapper.get('.place-row__name').text()).toBe(name);
  });

  it('デザインシステムの行き先・読み込み中の props に対応する', async () => {
    const onOpen = vi.fn();
    const onToggleTag = vi.fn();
    const wrapper = mount(PlaceRow, { props: {
      placeId: 'p', name: '企画', isDestination: true, loading: true,
      tags: { wantToGo: false, favorite: false }, onOpen, onToggleTag,
    } });
    expect(wrapper.find('[aria-label="行き先"]').exists()).toBe(true);
    expect(wrapper.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('.place-row__skeleton').exists()).toBe(true);
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined();
      await button.trigger('click');
    }
    expect(onOpen).not.toHaveBeenCalled();
    expect(onToggleTag).not.toHaveBeenCalled();
  });
});
