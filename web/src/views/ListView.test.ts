import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, type Pinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import PlaceRow from '../components/PlaceRow.vue';
import FilterBand from '../components/FilterBand.vue';
import { fromXY, ORIGIN } from '../domain/geo';
import { usePosition } from '../services/position';
import * as storageModule from '../storage';
import { useLabelsStore, useLandmarksStore, usePlacesStore } from '../stores';
import type { Place } from '../types';
import ListView from './ListView.vue';

enableAutoUnmount(afterEach);
let pinia: Pinia;
let router: Router;
let storage: storageModule.StorageRepositories;
let position: ReturnType<typeof usePosition>;
let fetchMock: ReturnType<typeof vi.fn>;

function place(id: string, name: string, overrides: Partial<Place> = {}): Place {
  return {
    id, name, kind: 'event', description: '', location: fromXY(0, 130),
    landmarkId: 'library', floor: 2, hours: [], labelIds: ['experience'], ...overrides,
  };
}
const fixtures = [
  place('cards', 'カード体験会'),
  place('food', 'カード屋台', { labelIds: ['food'], landmarkId: null, floor: null }),
  place('parking', '駐車場', { kind: 'parking', labelIds: ['food'], landmarkId: null, floor: null }),
  place('wc', 'トイレ', { kind: 'wc', labelIds: [], floor: 1 }),
];

beforeEach(async () => {
  fetchMock = vi.fn(() => Promise.reject(new Error('ネットワークは禁止')));
  vi.stubGlobal('fetch', fetchMock);
  storage = await storageModule.createStorage({ memory: true });
  vi.spyOn(storageModule, 'getStorage').mockResolvedValue(storage);
  pinia = createPinia();
  usePlacesStore(pinia).setAll(fixtures);
  useLabelsStore(pinia).setAll([{ id: 'experience', title: '体験' }, { id: 'food', title: '飲食' }]);
  useLandmarksStore(pinia).setAll([{
    id: 'library', name: '図書館棟', location: ORIGIN, footprint: null, floors: [],
  }]);
  position = usePosition();
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/list', name: 'list', component: ListView },
    { path: '/places/:id', name: 'card', component: { template: '<div />' } },
  ] });
  await router.push('/list');
  await router.isReady();
});
afterEach(async () => {
  position.dispose();
  await storage.close();
  expect(fetchMock).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(props = {}) {
  const wrapper = mount(ListView, { props, global: { plugins: [pinia, router] } });
  await flushPromises();
  return wrapper;
}

// S-01: 一覧の表示、状態、絞り込み・部品 props、通信なしをコンポーネントから検証する。
describe('一覧', () => {
  it('設備除外時は全4種類を一覧・絞り込み・件数から除き、設定変更にも追従する(D-030)', async () => {
    usePlacesStore(pinia).setAll([
      ...fixtures.filter(item => item.kind !== 'wc'),
      ...(['info', 'wc', 'rest', 'trash'] as const).map(kind => place(kind, `設備-${kind}`, { kind })),
    ]);
    const wrapper = await render({ excludeFacilities: true });
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(3);
    expect(wrapper.get('.place-view__count').text()).toBe('3 件');
    await wrapper.getComponent({ name: 'FilterChips' }).findAll('button')[0].trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['cards']);
    expect(wrapper.getComponent(FilterBand).props('count')).toBe(1);
    await wrapper.setProps({ excludeFacilities: false });
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(5);
    await wrapper.setProps({ excludeFacilities: true });
    expect(wrapper.get('.place-view__count').text()).toBe('1 件');
  });

  it('現在地なしでは日本語の名前順、現在地ありでは未丸めの距離順・同距離なら名前順にする', async () => {
    const items = [
      place('far', 'あの企画', { location: fromXY(0, 200) }),
      place('near-b', 'うの企画', { location: fromXY(0, 100.1) }),
      place('near-a', 'いの企画', { location: fromXY(0, 100.1) }),
      place('closer', 'えの企画', { location: fromXY(0, 100) }),
    ];
    usePlacesStore(pinia).setAll(items);
    const wrapper = await render();
    const ids = () => wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'));
    expect(ids()).toEqual(['far', 'near-a', 'near-b', 'closer']);
    position.setManually(ORIGIN.lat, ORIGIN.lng, 8);
    await flushPromises();
    expect(ids()).toEqual(['closer', 'near-a', 'near-b', 'far']);
    // 表示はすべて 100 m でも、内部では丸める前の距離で比べる。
    expect(wrapper.findAll('.place-row__distance').slice(0, 3).map(row => row.text())).toEqual(['100 m', '100 m', '100 m']);
    expect(usePlacesStore(pinia).items.map(item => item.id)).toEqual(items.map(item => item.id));
    position.refuse();
    await flushPromises();
    expect(ids()).toEqual(['far', 'near-a', 'near-b', 'closer']);
  });

  it('距離を計算できない場合も名前順で比較する', async () => {
    usePlacesStore(pinia).setAll([
      place('b', 'いの企画', { location: { lat: NaN, lng: NaN } }),
      place('a', 'あの企画'),
    ]);
    position.setManually(ORIGIN.lat, ORIGIN.lng, 8);
    const wrapper = await render();
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['a', 'b']);
    expect(wrapper.get('[data-place-id="b"]').find('.place-row__distance').exists()).toBe(false);
  });

  it.each([
    ['前ＡＢＣ後', 'abc'], ['前abc後', 'ＡＢＣ'],
    ['前ｶﾞﾗｽ後', 'ガラス'], ['前ガラス後', 'ｶﾞﾗｽ'],
  ])('URL の検索語と名前を NFKC・小文字化して一覧を絞る: %s / %s', async (name, query) => {
    usePlacesStore(pinia).setAll([place('match', name), place('other', '別の企画')]);
    await router.replace({ query: { q: query } });
    const wrapper = await render();
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['match']);
    expect(wrapper.get('mark').text()).toBe(name.slice(1, -1));
  });

  it('名前・種類・建物・階・件数を表示用 props に変換し、位置がある場合だけ直線距離を渡す', async () => {
    const wrapper = await render();
    expect(wrapper.get('h1').text()).toBe('一覧');
    expect(wrapper.get('.place-view__count').text()).toBe('4 件');
    const row = wrapper.getComponent<typeof PlaceRow>('[data-place-id="cards"]');
    expect(row.props()).toMatchObject({
      placeId: 'cards', name: 'カード体験会', kindLabel: '体験', building: '図書館棟', floor: '2階',
      distanceM: undefined, tags: { wantToGo: false, favorite: false },
    });
    expect(wrapper.find('[data-place-id="food"]').text()).toContain('屋外');
    expect(wrapper.find('[data-place-id="wc"]').text()).toContain('トイレ');
    expect(wrapper.find('.place-row__distance').exists()).toBe(false);
    position.setManually(ORIGIN.lat, ORIGIN.lng, 8);
    await flushPromises();
    expect(row.props('distanceM')).toBeCloseTo(130);
    expect(row.get('.place-row__distance').text()).toBe('130 m');
    position.refuse();
    await flushPromises();
    expect(wrapper.find('.place-row__distance').exists()).toBe(false);
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(4);
  });

  it('ストアの変更・削除を再描画し、建物名や種類が未取得でも ID を表示しない', async () => {
    const wrapper = await render();
    usePlacesStore(pinia).upsert(place('cards', '更新した企画', { landmarkId: 'missing', labelIds: ['missing'], floor: 0 }));
    usePlacesStore(pinia).remove('food');
    await flushPromises();
    expect(wrapper.text()).toContain('更新した企画');
    expect(wrapper.text()).not.toContain('カード屋台');
    expect(wrapper.get('.place-view__count').text()).toBe('3 件');
    const row = wrapper.getComponent<typeof PlaceRow>('[data-place-id="cards"]');
    expect(row.props()).toMatchObject({ kindLabel: '企画', building: '建物情報なし', floor: '0階' });
  });

  it('種類は OR、タグは AND で絞り、設備は残し、帯・件数・保存内容を一致させる', async () => {
    await storage.tagLinks.save({ placeId: 'cards', tagId: 'want-to-go' });
    await storage.tagLinks.save({ placeId: 'cards', tagId: 'favorite' });
    await storage.tagLinks.save({ placeId: 'food', tagId: 'want-to-go' });
    const wrapper = await render();
    const chip = (title: string) => wrapper.getComponent({ name: 'FilterChips' }).findAll('button').find(button => button.text().includes(title))!;
    await chip('体験').trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(2);
    await chip('飲食').trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(4);
    await chip('行きたい場所').trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(3);
    await chip('お気に入り').trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow).map(row => row.props('placeId'))).toEqual(['cards', 'wc']);
    expect(wrapper.getComponent(FilterBand).props()).toMatchObject({
      labels: ['体験', '飲食', '行きたい場所', 'お気に入り'], count: 2,
    });
    expect(await storage.filter.get()).toEqual({ labelIds: ['experience', 'food'], tagIds: ['want-to-go', 'favorite'] });
    await wrapper.get('.filter-band__clear').trigger('click');
    await flushPromises();
    expect(await storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
    expect(wrapper.find('.filter-band').exists()).toBe(false);
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(4);
  });

  it('端末に保存したタグと行き先を復元し、タグの切り替えを保存してもカードを開かない', async () => {
    await storage.destination.save({ placeId: 'cards' });
    await storage.tagLinks.save({ placeId: 'cards', tagId: 'favorite' });
    const wrapper = await render();
    const buttons = () => wrapper.get('[data-place-id="cards"]').findAll('.place-row__tag');
    expect(buttons().map(button => button.attributes('aria-pressed'))).toEqual(['false', 'true']);
    expect(wrapper.find('[aria-label="行き先"]').exists()).toBe(true);
    await buttons()[0].trigger('click');
    await flushPromises();
    await buttons()[1].trigger('click');
    await flushPromises();
    expect(await storage.tagLinks.list('cards')).toEqual([{ placeId: 'cards', tagId: 'want-to-go' }]);
    expect(router.currentRoute.value.name).toBe('list');
    expect(await storage.destination.get()).toEqual({ placeId: 'cards' });
    wrapper.unmount();
    const restored = await render();
    expect(restored.get('[data-place-id="cards"]').findAll('.place-row__tag').map(button => button.attributes('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('お気に入りの絞り込み中にタグを外すと、行と件数がすぐ変わる', async () => {
    await storage.filter.save({ labelIds: [], tagIds: ['favorite'] });
    await storage.tagLinks.save({ placeId: 'cards', tagId: 'favorite' });
    const wrapper = await render();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(2);
    await wrapper.get('[data-place-id="cards"]').findAll('.place-row__tag')[1].trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-place-id="cards"]').exists()).toBe(false);
    expect(wrapper.get('.place-view__count').text()).toBe('1 件');
  });

  it('0 件では理由と解除を示し、条件なしの空の一覧と区別する', async () => {
    usePlacesStore(pinia).setAll([fixtures[0]]);
    await storage.filter.save({ labelIds: [], tagIds: ['favorite'] });
    const wrapper = await render();
    expect(wrapper.getComponent({ name: 'EmptyState' }).props()).toMatchObject({
      title: 'この種類の場所はありません',
      body: '条件を変えると、見つかることがあります。',
      actions: [{ label: '絞り込みを解除して探す', disabled: false }],
    });
    expect(wrapper.getComponent(FilterBand).props('count')).toBe(0);
    expect(wrapper.get('.filter-band__hint').text()).toContain('お気に入りはまだありません');
    expect(wrapper.get('.place-view__empty').text()).toContain('この種類の場所はありません');
    await wrapper.get('.place-view__empty button').trigger('click');
    await flushPromises();
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(1);
    usePlacesStore(pinia).setAll([]);
    await flushPromises();
    expect(wrapper.get('.place-view__empty h2').text()).toBe('場所はまだありません');
    expect(wrapper.getComponent({ name: 'EmptyState' }).props()).toMatchObject({
      title: '場所はまだありません', actions: [],
    });
    expect(wrapper.find('.place-view__empty button').exists()).toBe(false);
  });

  it('タグが既にある組み合わせの 0 件で、タグがないという誤った理由を出さない', async () => {
    usePlacesStore(pinia).setAll([fixtures[0], fixtures[1]]);
    await storage.tagLinks.save({ placeId: 'cards', tagId: 'favorite' });
    await storage.filter.save({ labelIds: ['food'], tagIds: ['favorite'] });
    const wrapper = await render();
    expect(wrapper.getComponent(FilterBand).props('count')).toBe(0);
    expect(wrapper.get('.filter-band__hint').text()).toBe('条件に合う場所がありません。絞り込みを解除して探せます。');
  });

  it('絞り込みの保存に失敗したら以前の状態を保ち、再操作できる', async () => {
    vi.spyOn(storage.filter, 'save').mockRejectedValueOnce(new Error('保存失敗'));
    const wrapper = await render();
    const chip = wrapper.getComponent({ name: 'FilterChips' }).findAll('button')[0];
    await chip.trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('絞り込みを保存できませんでした');
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(4);
    expect(chip.attributes('aria-pressed')).toBe('false');
    expect(await storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
    await chip.trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.findAllComponents(PlaceRow)).toHaveLength(2);
    expect(await storage.filter.get()).toEqual({ labelIds: ['experience'], tagIds: [] });
  });

  it('行を押すとカードへ進み、行き先やタグは変更しない', async () => {
    const wrapper = await render();
    await wrapper.get('[data-place-id="cards"] .place-row__open').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('card');
    expect(router.currentRoute.value.params.id).toBe('cards');
    expect(await storage.destination.get()).toBeNull();
    expect(await storage.tagLinks.list()).toEqual([]);
  });

  it('保存に失敗したタグは入にせず、失敗を知らせる', async () => {
    vi.spyOn(storage.tagLinks, 'save').mockRejectedValueOnce(new Error('保存失敗'));
    const wrapper = await render();
    await wrapper.get('[data-place-id="cards"]').findAll('.place-row__tag')[0].trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('タグを保存できませんでした');
    expect(wrapper.get('[data-place-id="cards"]').findAll('.place-row__tag')[0].attributes('aria-pressed')).toBe('false');
  });
});
