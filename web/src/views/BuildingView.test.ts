import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import { useLandmarksStore, usePlacesStore } from '../stores';
import type { FloorPlan, Landmark, Place } from '../types';
import BuildingView from './BuildingView.vue';

enableAutoUnmount(afterEach);

function floorPlan(floor: number): FloorPlan {
  return {
    floor,
    bounds: { north: 38, south: 36, east: 140, west: 138 },
    plan: { viewBox: '0 0 240 120', d: `M0 0H${200 + floor}V120H0Z` },
  };
}
const building: Landmark = {
  id: 'building-1', name: '図書館棟', location: { lat: 37, lng: 139 }, footprint: null,
  floors: [floorPlan(4), floorPlan(2), floorPlan(-1), floorPlan(1)],
};
function event(id: string, floor: number | null): Place {
  return {
    id, name: `企画 ${id}`, kind: 'event', location: { lat: 37, lng: 139 },
    description: '', landmarkId: building.id, floor, hours: [], labelIds: [],
  };
}
const events = [event('1f', 1), event('2f-a', 2), event('2f-b', 2), event('3f', 3), event('b1', -1)];
const facilities: Place[] = (['info', 'wc', 'rest', 'trash'] as const).flatMap((kind) => [
  { ...event(kind, 2), kind, name: `設備 ${kind}` },
  { ...event(`${kind}-only`, 5), kind, name: `設備のみ ${kind}` },
]);
const hosts: HTMLElement[] = [];

beforeEach(() => {
  setActivePinia(createPinia());
  useLandmarksStore().setAll([building]);
  usePlacesStore().setAll([
    ...events, ...facilities,
    { ...event('parking', 2), kind: 'parking' },
    { ...event('other-building', 2), landmarkId: 'other' },
    event('no-floor', null),
  ]);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('コンポーネントからの通信は禁止'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  hosts.splice(0).forEach((host) => host.remove());
});

async function render(id = building.id, attachTo?: HTMLElement) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/buildings/:id', name: 'building', component: BuildingView },
      { path: '/places/:id', name: 'card', component: { template: '<div />' } },
    ],
  });
  await router.push({ name: 'building', params: { id } });
  await router.isReady();
  const wrapper = mount(BuildingView, { attachTo, global: { plugins: [router] } });
  return { wrapper, router };
}

describe('BuildingView', () => {
  it('建物画面と見取り図が共に祖先のテーマ切替に追従する', async () => {
    const host = document.createElement('div');
    host.dataset.theme = 'light';
    document.body.append(host);
    hosts.push(host);
    const { wrapper } = await render(building.id, host);
    await nextTick();
    for (const element of [wrapper.get('main').element, wrapper.get('svg').element]) {
      expect(element.style.getPropertyValue('--building-bg-page')).toBe('#f6f4fa');
      expect(element.style.getPropertyValue('--building-text-primary')).toBe('#1e0b3a');
    }
    host.dataset.theme = 'dark';
    await flushPromises();
    for (const element of [wrapper.get('main').element, wrapper.get('svg').element]) {
      expect(element.style.getPropertyValue('--building-bg-page')).toBe('#130a22');
      expect(element.style.getPropertyValue('--building-text-primary')).toBe('#f4f0ff');
    }
  });

  it('建物名、見取り図と企画の階の和集合、件数を表示し、最初は1階を選ぶ', async () => {
    const { wrapper } = await render();
    expect(wrapper.get('h1').text()).toBe(building.name);
    const buttons = wrapper.findAll('nav button');
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([
      '地下1階、企画 1 件', '1階、企画 2 件', '2階、企画 2 件', '3階、企画 1 件', '4階、企画 0 件',
    ]);
    expect(wrapper.get('nav [aria-pressed="true"]').attributes('aria-label')).toBe('1階、企画 2 件');
    expect(buttons[4].text()).toBe('4階');
    expect(wrapper.findAll('li').map((row) => row.text())).toEqual([
      '企画 1f企画 · 図書館棟 · 1階', '企画 no-floor企画 · 図書館棟 · 1階',
    ]);
    expect(wrapper.get('.building__events h2').text()).toBe('1階の企画 2 件');
    expect(wrapper.findAll('[role="button"]').map((marker) => marker.attributes('aria-label')))
      .toEqual(['企画 1f', '企画 no-floor']);
    expect(wrapper.get('path').attributes('d')).toBe(floorPlan(1).plan.d);
  });

  it('階を切り替えると見取り図・印・一覧が変わり、設備や他の建物を含めない', async () => {
    const { wrapper } = await render();
    await wrapper.get('nav [aria-label="2階、企画 2 件"]').trigger('click');
    expect(wrapper.get('path').attributes('d')).toBe(floorPlan(2).plan.d);
    expect(wrapper.findAll('li button').map((row) => row.text())).toEqual([
      '企画 2f-a企画 · 図書館棟 · 2階', '企画 2f-b企画 · 図書館棟 · 2階',
    ]);
    expect(wrapper.findAll('circle').map((marker) => marker.attributes('aria-label')))
      .toEqual(['企画 2f-a', '企画 2f-b']);
    expect(wrapper.text()).not.toContain('設備');
    expect(wrapper.text()).not.toContain('parking');
    expect(wrapper.text()).not.toContain('other-building');
    expect(wrapper.text()).not.toContain('no-floor');
  });

  it('企画0件の階は空表示と別の階への案内を出し、案内で切り替わる', async () => {
    const { wrapper } = await render();
    await wrapper.get('nav [aria-label="4階、企画 0 件"]').trigger('click');
    expect(wrapper.text()).toContain('この階に企画はありません');
    expect(wrapper.find('li').exists()).toBe(false);
    const suggestions = wrapper.findAll('.building__suggestions button');
    expect(suggestions).toHaveLength(4);
    const next = suggestions.find((button) => button.text().startsWith('2階'))!;
    await next.trigger('click');
    expect(wrapper.get('nav [aria-pressed="true"]').attributes('aria-label')).toBe('2階、企画 2 件');
    expect(wrapper.findAll('li')).toHaveLength(2);
    expect(wrapper.text()).not.toContain('この階に企画はありません');
  });

  it('見取り図が無い階も企画の一覧を表示する', async () => {
    const { wrapper } = await render();
    await wrapper.get('nav [aria-label="3階、企画 1 件"]').trigger('click');
    expect(wrapper.text()).toContain('この階の見取り図はありません');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.get('li').text()).toContain('企画 3f');
  });

  it('建物を参照できないときは未取得と区別できないので見つからないと断定しない', async () => {
    const { wrapper } = await render('missing');
    expect(wrapper.text()).toBe('');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.find('nav').exists()).toBe(false);
    expect(wrapper.find('li').exists()).toBe(false);
  });

  it('取得前にエラーや企画なしを出さず、遅れて取得した建物と企画を表示する', async () => {
    useLandmarksStore().$reset();
    usePlacesStore().$reset();
    const { wrapper } = await render();
    expect(wrapper.text()).toBe('');
    useLandmarksStore().setAll([building]);
    usePlacesStore().setAll([event('late', null)]);
    await nextTick();
    expect(wrapper.get('h1').text()).toBe(building.name);
    expect(wrapper.get('nav [aria-pressed="true"]').attributes('aria-label')).toBe('1階、企画 1 件');
    expect(wrapper.get('li').text()).toContain('企画 late');
    expect(wrapper.text()).not.toContain('企画がありません');
  });

  it('見取り図の階が空でも、階がnullの企画を1階のタブ・一覧・件数に表示する', async () => {
    useLandmarksStore().setAll([{ ...building, floors: [] }]);
    usePlacesStore().setAll([
      event('no-floor', null),
      { ...event('outside', null), landmarkId: null },
      { ...event('other', null), landmarkId: 'other' },
      { ...event('wc', null), kind: 'wc' },
    ]);
    const { wrapper } = await render();
    expect(wrapper.findAll('nav button')).toHaveLength(1);
    expect(wrapper.get('nav [aria-pressed="true"]').attributes('aria-label')).toBe('1階、企画 1 件');
    expect(wrapper.get('.building__events h2').text()).toBe('1階の企画 1 件');
    expect(wrapper.findAll('li').map((row) => row.text())).toEqual(['企画 no-floor企画 · 図書館棟 · 1階']);
    expect(wrapper.text()).toContain('この階の見取り図はありません');
    expect(wrapper.find('.building__empty').exists()).toBe(false);
    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it.each(['li button', 'circle[role="button"]'])('%s を押すと場所のカードへ遷移する', async (selector) => {
    const { wrapper, router } = await render();
    const push = vi.spyOn(router, 'push');
    await wrapper.get(selector).trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'card', params: { id: '1f' } });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/places/1f');
  });

  it('1階が無ければ最小の階を選ぶ', async () => {
    useLandmarksStore().setAll([{ ...building, floors: [floorPlan(2), floorPlan(-1)] }]);
    usePlacesStore().setAll([event('2f', 2), event('b1', -1)]);
    const { wrapper } = await render();
    expect(wrapper.get('nav [aria-pressed="true"]').attributes('aria-label')).toBe('地下1階、企画 1 件');
    expect(wrapper.get('li').text()).toContain('企画 b1');
  });

  it('企画が建物全体に無ければ案内ボタンを出さない', async () => {
    usePlacesStore().setAll(facilities);
    const { wrapper } = await render();
    expect(wrapper.text()).toContain('この建物には企画がありません');
    expect(wrapper.text()).not.toContain('この階に企画はありません');
    expect(wrapper.find('.building__suggestions').exists()).toBe(false);
    expect(wrapper.findAll('nav button')).toHaveLength(4);
  });

  it('階の情報が無くても空表示と見取り図なしを表示する', async () => {
    useLandmarksStore().setAll([{ ...building, floors: [] }]);
    usePlacesStore().setAll([]);
    const { wrapper } = await render();
    expect(wrapper.text()).toContain('この建物には企画がありません');
    expect(wrapper.text()).not.toContain('この階に企画はありません');
    expect(wrapper.text()).toContain('この階の見取り図はありません');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('undefined');
  });

  it('ストアの更新と別の建物への移動を反映する', async () => {
    const { wrapper, router } = await render();
    await wrapper.get('nav [aria-label="2階、企画 2 件"]').trigger('click');
    usePlacesStore().upsert(event('new', 2));
    await nextTick();
    expect(wrapper.get('nav [aria-pressed="true"]').attributes('aria-label')).toBe('2階、企画 3 件');
    expect(wrapper.findAll('li')).toHaveLength(3);
    useLandmarksStore().setAll([building, { ...building, id: 'other', name: '別棟' }]);
    await router.push('/buildings/other');
    await nextTick();
    expect(wrapper.get('h1').text()).toBe('別棟');
    expect(wrapper.get('nav [aria-pressed="true"]').attributes('aria-label')).toBe('1階、企画 0 件');
  });
});
