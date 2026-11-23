import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, type Pinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import FilterBand from '../components/FilterBand.vue';
import PlaceRow from '../components/PlaceRow.vue';
import { fromXY, ORIGIN } from '../domain/geo';
import { usePosition } from '../services/position';
import * as storageModule from '../storage';
import { useLabelsStore, useLandmarksStore, usePlacesStore } from '../stores';
import type { Place } from '../types';
import ListView from './ListView.vue';
import SearchView from './SearchView.vue';

enableAutoUnmount(afterEach);
let pinia: Pinia;
let router: Router;
let storage: storageModule.StorageRepositories;
let position: ReturnType<typeof usePosition>;
let fetchMock: ReturnType<typeof vi.fn>;
function place(id: string, name: string, overrides: Partial<Place> = {}): Place {
  return {
    id, name, kind: 'event', description: '', labelIds: ['experience'],
    landmarkId: 'library', floor: 2, hours: [], location: fromXY(30, 40), ...overrides,
  };
}
beforeEach(async () => {
  fetchMock = vi.fn(() => Promise.reject(new Error('ネットワークは禁止')));
  vi.stubGlobal('fetch', fetchMock);
  storage = await storageModule.createStorage({ memory: true });
  vi.spyOn(storageModule, 'getStorage').mockResolvedValue(storage);
  pinia = createPinia();
  usePlacesStore(pinia).setAll([
    place('cards', 'カード体験会'),
    place('food', 'カード屋台', { labelIds: ['food'], landmarkId: null, floor: null }),
    place('parking', 'カード駐車場', { kind: 'parking', labelIds: [], landmarkId: null, floor: null }),
    ...(['info', 'wc', 'rest', 'trash'] as const).map(kind => place(kind, 'カード設備', { kind })),
  ]);
  useLabelsStore(pinia).setAll([{ id: 'experience', title: '体験' }, { id: 'food', title: '飲食' }]);
  useLandmarksStore(pinia).setAll([{ id: 'library', name: '図書館棟', location: ORIGIN, footprint: null, floors: [] }]);
  position = usePosition();
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/search', name: 'search', component: SearchView },
    { path: '/list', name: 'list', component: ListView },
    { path: '/places/:id', name: 'card', component: { template: '<div />' } },
  ] });
  await router.push('/search?q=カード');
  await router.isReady();
  vi.useFakeTimers();
});
afterEach(async () => {
  vi.useRealTimers();
  position.dispose();
  await storage.close();
  expect(fetchMock).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  const wrapper = mount(SearchView, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return wrapper;
}

describe('検索結果', () => {
  it('最後の入力から300ms後に検索・件数・強調とURLを一度だけ更新する', async () => {
    const wrapper = await render();
    const replace = vi.spyOn(router, 'replace');
    const input = wrapper.get('input');
    await input.setValue('屋');
    await vi.advanceTimersByTimeAsync(299);
    expect(wrapper.get('.place-view__count').text()).toBe('『カード』の検索結果・3 件');
    expect(wrapper.findAll('mark').map(mark => mark.text())).toEqual(['カード', 'カード', 'カード']);
    await input.setValue('屋台');
    await vi.advanceTimersByTimeAsync(299);
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(router.currentRoute.value.query.q).toBe('屋台');
    expect(wrapper.get('.place-view__count').text()).toBe('『屋台』の検索結果・1 件');
    expect(wrapper.get('mark').text()).toBe('屋台');
  });

  it('IME変換開始で待機中の検索を止め、compositionendだけで確定語を反映する', async () => {
    const wrapper = await render();
    const input = wrapper.get('input');
    await input.setValue('屋');
    await vi.advanceTimersByTimeAsync(100);
    await input.trigger('compositionstart');
    input.element.value = 'たい';
    await input.trigger('input', { isComposing: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(router.currentRoute.value.query.q).toBe('カード');
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(3);
    input.element.value = '体験';
    await input.trigger('compositionend');
    await vi.advanceTimersByTimeAsync(299);
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['cards']);
    expect(router.currentRoute.value.query.q).toBe('体験');
  });

  it.each(['あ'.repeat(50), '😀'.repeat(50)])('貼り付けも50コードポイントに制限して検索・URLに使う: %s', async value => {
    usePlacesStore(pinia).setAll([place('limit', value)]);
    const wrapper = await render();
    await wrapper.get('input').setValue(`${value}超過`);
    expect(wrapper.get('input').element.value).toBe(value);
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBe(value);
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['limit']);
    expect(wrapper.get('mark').text()).toBe(value);
  });

  it('IME変換中は文字を切らず、確定時に50文字に制限する', async () => {
    const wrapper = await render();
    const input = wrapper.get('input');
    const value = 'あ'.repeat(51);
    await input.trigger('compositionstart');
    input.element.value = value;
    await input.trigger('input', { isComposing: true });
    expect(input.element.value).toBe(value);
    await input.trigger('compositionend');
    expect(input.element.value).toBe('あ'.repeat(50));
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBe('あ'.repeat(50));
  });

  it('URLからの検索語も50文字に制限してreplaceで補正する', async () => {
    const value = 'あ'.repeat(50);
    usePlacesStore(pinia).setAll([place('limit', value)]);
    await router.replace({ query: { q: `${value}超過`, keep: '残す' }, hash: '#results' });
    const wrapper = await render();
    expect(wrapper.get('input').element.value).toBe(value);
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['limit']);
    expect(router.currentRoute.value.query).toEqual({ q: value, keep: '残す' });
    expect(router.currentRoute.value.hash).toBe('#results');
  });

  it('q以外のクエリ・ハッシュを保ち、入力や削除では履歴を増やさない', async () => {
    await router.push('/list');
    await router.push('/search?q=カード&keep=1#results');
    const wrapper = await render();
    const push = vi.spyOn(router, 'push');
    await wrapper.get('input').setValue('屋台');
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ q: '屋台', keep: '1' });
    expect(router.currentRoute.value.hash).toBe('#results');
    await wrapper.get('.place-view__search button').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ keep: '1' });
    expect(router.currentRoute.value.hash).toBe('#results');
    expect(push).not.toHaveBeenCalled();
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('list');
  });

  it('外部からのq変更は待機中の入力を取り消して即座に反映する', async () => {
    const wrapper = await render();
    await wrapper.get('input').setValue('屋台');
    await router.push('/search?q=体験');
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBe('体験');
    expect(wrapper.get('input').element.value).toBe('体験');
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['cards']);
  });

  it('消去操作とアンマウントで待機中の検索を取り消す', async () => {
    const wrapper = await render();
    await wrapper.get('input').setValue('屋台');
    await wrapper.get('.place-view__search button').trigger('click');
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(router.currentRoute.value.query.q).toBeUndefined();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(0);
    const replace = vi.spyOn(router, 'replace');
    await wrapper.get('input').setValue('体験');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(300);
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ['前ＡＢＣ後', 'abc', 'ＡＢＣ'], ['前abc後', 'ＡＢＣ', 'abc'],
    ['前ｶﾞﾗｽ後', 'ガラス', 'ｶﾞﾗｽ'], ['前ガラス後', 'ｶﾞﾗｽ', 'ガラス'],
    ['前100%_後', '%_', '%_'],
  ])('入力と名前を正規化しリテラルとして検索・強調する: %s / %s', async (name, query, mark) => {
    usePlacesStore(pinia).setAll([place('match', name), place('other', '別の企画')]);
    const wrapper = await render();
    await wrapper.get('input').setValue(query);
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['match']);
    expect(wrapper.get('mark').text()).toBe(mark);
  });

  it('空白だけの確定語を空の検索として扱う', async () => {
    const wrapper = await render();
    await wrapper.get('input').setValue('　 ');
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(0);
    expect(wrapper.get('.place-view__empty h2').text()).toBe('企画・場所の名前を入力してください');
  });

  it('検索語・一致した名前・建物・階・件数を示し、設備は検索に出さない', async () => {
    const wrapper = await render();
    expect(wrapper.get('h1').text()).toBe('検索結果');
    expect(wrapper.get('input').element.value).toBe('カード');
    expect(wrapper.get('.place-view__count').text()).toBe('『カード』の検索結果・3 件');
    const rows = wrapper.findAllComponents(PlaceRow);
    expect(rows.map(row => row.props('placeId'))).toEqual(['food', 'cards', 'parking']);
    expect(rows[1].props()).toMatchObject({
      placeId: 'cards', name: 'カード体験会', kindLabel: '体験', building: '図書館棟', floor: '2階',
      highlight: 'カード', distanceM: undefined, tags: undefined,
    });
    expect(rows[0].props()).toMatchObject({ building: '屋外', floor: undefined });
    expect(wrapper.findAll('mark').map(mark => mark.text())).toEqual(['カード', 'カード', 'カード']);
    expect(wrapper.find('.place-row__tag').exists()).toBe(false);
  });

  it('共有の現在地を端末で距離に変換し、位置が失われたら距離だけ隠す', async () => {
    const wrapper = await render();
    position.setManually(ORIGIN.lat, ORIGIN.lng, 8);
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)[0].props('distanceM')).toBeCloseTo(50);
    expect(wrapper.get('.place-row__distance').text()).toBe('50 m');
    position.refuse();
    await flushPromises();
    expect(wrapper.find('.place-row__distance').exists()).toBe(false);
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(3);
  });

  it('入力確定後に部分一致の結果が更新され、ストア更新や経路の検索語にも追従する', async () => {
    const wrapper = await render();
    await wrapper.get('input').setValue('屋台');
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['food']);
    usePlacesStore(pinia).upsert(place('new', '屋台の企画'));
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(2);
    usePlacesStore(pinia).remove('food');
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(1);
    await router.push('/search?q=体験');
    await flushPromises();
    expect(wrapper.get('input').element.value).toBe('体験');
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['cards']);
  });

  it('保存済みの種類・タグを結果にも適用し、検索中の帯は件数なしで表示する', async () => {
    await storage.tagLinks.save({ placeId: 'cards', tagId: 'favorite' });
    await storage.filter.save({ labelIds: ['experience'], tagIds: ['favorite'] });
    const wrapper = await render();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(1);
    expect(wrapper.getComponent(FilterBand).props()).toMatchObject({ labels: ['体験', 'お気に入り'], count: undefined });
    expect(wrapper.get('.filter-band__summary').text()).toBe('『体験・お気に入り』で絞り込み中');
    expect(wrapper.get('.place-view__count').text()).toBe('『カード』の検索結果・1 件');
    await wrapper.get('.filter-band__clear').trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(3);
    expect(wrapper.get('input').element.value).toBe('カード');
    expect(wrapper.find('.filter-band').exists()).toBe(false);
    expect(await storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
  });

  it('絞り込みによる一致なしでは解除を先頭に示し、検索語を保って再検索できる', async () => {
    await storage.filter.save({ labelIds: [], tagIds: ['favorite'] });
    const wrapper = await render();
    expect(wrapper.get('.place-view__empty h2').text()).toBe('『カード』に一致する企画・場所はありません');
    expect(wrapper.get('.place-view__count').text()).toBe('『カード』の検索結果・0 件');
    const actions = wrapper.get('.place-view__empty').findAll('button, a');
    expect(actions.map(action => action.text())).toEqual(['絞り込みを解除して探す', '別の言葉で探す', '一覧から探す']);
    await actions[0].trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(3);
    expect(wrapper.get('input').element.value).toBe('カード');
  });

  it('絞り込みなしの一致なしは別の言葉・一覧へ案内し、入力を消して再入力に戻れる', async () => {
    const wrapper = await render();
    await wrapper.get('input').setValue('見つからない');
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    const actions = wrapper.get('.place-view__empty').findAll('button, a');
    expect(actions.map(action => action.text())).toEqual(['別の言葉で探す', '一覧から探す']);
    await actions[0].trigger('click');
    expect(wrapper.get('input').element.value).toBe('');
    expect(wrapper.get('.place-view__empty h2').text()).toBe('企画・場所の名前を入力してください');
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(0);
    await wrapper.get('.place-view__empty a').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('list');
  });

  it('検索語を消す操作と一覧との切り替えでも保存した絞り込みを維持する', async () => {
    await storage.filter.save({ labelIds: ['food'], tagIds: [] });
    const wrapper = await render();
    await wrapper.get('.place-view__search button').trigger('click');
    expect(wrapper.get('input').element.value).toBe('');
    expect(wrapper.get('.filter-band__summary').text()).toContain('飲食');
    wrapper.unmount();
    await router.push('/list');
    const list = mount(ListView, { global: { plugins: [pinia, router] } });
    await flushPromises();
    expect(list.getComponent(FilterBand).props('labels')).toEqual(['飲食']);
    expect(list.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['food', 'info', 'wc', 'rest', 'trash']);
  });

  it('結果を押すと対応するカードへ進み、行き先は変えない', async () => {
    const wrapper = await render();
    await wrapper.get('[data-place-id="cards"] .place-row__open').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('card');
    expect(router.currentRoute.value.params.id).toBe('cards');
    expect(await storage.destination.get()).toBeNull();
  });

  it('保存情報の読み込み中に一時的な 0 件を出さず、失敗は一致なしと区別する', async () => {
    let fail!: (error: Error) => void;
    vi.mocked(storageModule.getStorage).mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    const wrapper = mount(SearchView, { global: { plugins: [pinia, router] } });
    expect(wrapper.get('[role="status"]').text()).toBe('読み込み中です');
    expect(wrapper.find('.place-view__empty').exists()).toBe(false);
    expect(wrapper.find('.place-view__count').exists()).toBe(false);
    fail(new Error('読み込み失敗'));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('読み込めませんでした');
    expect(wrapper.find('.place-view__empty').exists()).toBe(false);
  });
});
