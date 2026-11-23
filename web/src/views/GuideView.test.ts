import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { h, nextTick } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromXY } from '../domain/geo';
import { usePosition } from '../services/position';
import * as storageModule from '../storage';
import { useLandmarksStore, usePlacesStore } from '../stores';
import type { Landmark, Place } from '../types';
import GuideView from './GuideView.vue';

const NOW = Date.parse('2026-11-24T03:00:00Z');
const place: Place = {
  id: 'event-1', name: 'お化け屋敷', kind: 'event', location: fromXY(150, 0),
  landmarkId: 'building-1', floor: 2, description: '', hours: [], labelIds: [],
};
const landmark: Landmark = {
  id: 'building-1', name: '総合研究棟', location: place.location, footprint: null, floors: [],
};
const otherPlace: Place = { ...place, id: 'event-2', name: '別の企画' };
const themeHosts: HTMLElement[] = [];

function themeHost(theme?: string) {
  const host = document.createElement('div');
  if (theme !== undefined) host.dataset.theme = theme;
  document.body.append(host);
  themeHosts.push(host);
  return host;
}

let storage: storageModule.StorageRepositories;
let position: ReturnType<typeof usePosition>;
let wrapper: VueWrapper | undefined;
let pinia: ReturnType<typeof createPinia>;
const fetchMock = vi.fn(() => { throw new Error('案内画面からの通信は禁止'); });
const networkMock = vi.fn(() => { throw new Error('案内画面からの通信は禁止'); });
const watchPosition = vi.fn();

async function renderGuide(attachTo?: HTMLElement) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/guide', name: 'guide', component: GuideView },
      { path: '/', name: 'map', component: { template: '<p>マップ</p>' } },
      { path: '/camera', name: 'camera', component: { template: '<p>カメラ</p>' } },
      { path: '/noloc', name: 'noloc', component: { template: '<p>位置の設定</p>' } },
      { path: '/buildings/:id', name: 'building', component: { template: '<p>建物の中の地図</p>' } },
    ],
  });
  await router.push('/guide');
  await router.isReady();
  wrapper = mount({ render: () => h(RouterView) }, { attachTo, global: { plugins: [pinia, router] } });
  await flushPromises();
  return wrapper;
}

function setPosition(x: number, y: number, accuracy = 8) {
  const point = fromXY(x, y);
  position.setManually(point.lat, point.lng, accuracy);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW - 10_000);
  vi.stubGlobal('fetch', fetchMock.mockClear());
  networkMock.mockClear();
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource']) vi.stubGlobal(name, networkMock);
  vi.stubGlobal('navigator', {
    userAgent: navigator.userAgent,
    geolocation: { watchPosition: watchPosition.mockReset(), clearWatch: vi.fn() },
    sendBeacon: networkMock,
  });
  pinia = createPinia();
  setActivePinia(pinia);
  storage = await storageModule.createStorage({ memory: true });
  vi.spyOn(storageModule, 'getStorage').mockResolvedValue(storage);
  await storage.destination.save({ placeId: place.id });
  usePlacesStore().setAll([place]);
  useLandmarksStore().setAll([landmark]);
  // 位置画面などの既存利用者を再現。実 GPS・外部通信は使わない。
  position = usePosition();
  setPosition(0, 0);
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  themeHosts.splice(0).forEach(host => host.remove());
  position.dispose();
  await storage.close();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(networkMock).not.toHaveBeenCalled();
  expect(watchPosition).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GuideView', () => {
  it.each(['light', 'dark', undefined, 'unknown'])('テーマ %s を resolveColors と同じ規則で解決する', async theme => {
    const view = await renderGuide(themeHost(theme));
    const style = view.get<HTMLElement>('.guide-view').element.style;
    const expected = theme === 'light'
      ? ['#f6f4fa', '#ffffff', '#1e0b3a', '#5b5274', '#facc15', '#1e0b3a', '#1e0b3a', '#1e0b3a26', '#6d28d9', '#c2410c', '#b91c1c']
      : ['#130a22', '#1c1032', '#f4f0ff', '#b4a9cf', '#ffd84a', '#1e0b3a', '#ffd84a', '#a78bfa47', '#a78bfa', '#fdba74', '#fecaca'];
    const tokens = ['page', 'surface', 'text', 'secondary', 'destination', 'destination-on', 'destination-border', 'border', 'focus', 'stale', 'danger'];
    tokens.forEach((token, index) => {
      expect(style.getPropertyValue(`--guide-${token}`)).toBe(expected[index]);
    });
  });

  it('最寄りのテーマを優先し、属性の追加・切替・削除に追従する', async () => {
    const outer = themeHost('light');
    const inner = document.createElement('div');
    outer.append(inner);
    const view = await renderGuide(inner);
    const color = () => view.get<HTMLElement>('.guide-view').element.style.getPropertyValue('--guide-destination');
    expect(color()).toBe('#facc15');
    inner.dataset.theme = 'dark';
    await flushPromises();
    expect(color()).toBe('#ffd84a');
    inner.dataset.theme = 'light';
    await flushPromises();
    expect(color()).toBe('#facc15');
    inner.dataset.theme = 'unknown';
    await flushPromises();
    expect(color()).toBe('#ffd84a');
    inner.removeAttribute('data-theme');
    await flushPromises();
    expect(color()).toBe('#facc15');
    outer.dataset.theme = 'dark';
    await flushPromises();
    expect(color()).toBe('#ffd84a');
  });

  it('保存済みの行き先・建物・階・北基準の方角・直線距離・更新時刻・精度を表示する', async () => {
    const view = await renderGuide();
    expect(view.text()).toContain('お化け屋敷');
    expect(view.text()).toContain('総合研究棟 2階');
    expect(view.text()).toContain('直線距離 約 150 m');
    expect(view.text()).toContain('方角：東（北を基準）');
    expect(view.text()).toContain('10 秒前に更新・精度 ±8 m');
    expect(view.get('a').attributes('href')).toBe('/camera');
    expect(view.get('button').text()).toBe('案内をやめる');
  });

  it.each([
    { distance: 149.6, text: '直線距離 約 150 m' },
    { distance: 1500, text: '直線距離 約 1500 m' },
  ])('追加決定に従い距離 $distance を「約」付きの整数 m で表示する', async ({ distance, text }) => {
    usePlacesStore().upsert({ ...place, location: fromXY(distance, 0) });
    const view = await renderGuide();
    expect(view.get('.distance').text()).toBe(text);
  });

  it('現在地の更新に追従し、距離・方角・時刻・精度を再計算する', async () => {
    const view = await renderGuide();
    setPosition(150, -60, 12);
    await nextTick();
    expect(view.text()).toContain('直線距離 約 60 m');
    expect(view.text()).toContain('方角：北（北を基準）');
    expect(view.text()).toContain('0 秒前に更新・精度 ±12 m');
  });

  it('場所と建物のストアの更新に追従する', async () => {
    const view = await renderGuide();
    usePlacesStore().upsert({ ...place, name: '新しい企画名', location: fromXY(-100, -100), floor: 0 });
    useLandmarksStore().setAll([{ ...landmark, name: '新しい建物名' }]);
    await nextTick();
    expect(view.text()).toContain('新しい企画名');
    expect(view.text()).toContain('新しい建物名 0階');
    expect(view.text()).toContain('直線距離 約 141 m');
    expect(view.text()).toContain('方角：南西（北を基準）');
  });

  it.each([
    { x: 120, arrived: false }, // 行き先から 30 m
    { x: 131, arrived: true }, // 既存の仮置き 20 m の内側
    { x: 150, arrived: true }, // 同じ位置
  ])('現在地 x=$x の到着表示は $arrived（操作前には行き先を消さない）', async ({ x, arrived }) => {
    setPosition(x, 0);
    const clear = vi.spyOn(storage.destination, 'clear');
    const view = await renderGuide();
    expect(view.text().includes('行き先に着きました')).toBe(arrived);
    expect(view.get('button').text()).toBe(arrived ? '案内を終える' : '案内をやめる');
    expect(await storage.destination.get()).toEqual({ placeId: place.id });
    expect(clear).not.toHaveBeenCalled();
  });

  it('移動で到着表示に変わり、案内を終えると端末内の行き先を解除する', async () => {
    const view = await renderGuide();
    setPosition(140, 0);
    await nextTick();
    expect(view.text()).toContain('行き先に着きました');
    expect(view.get('a').text()).toBe('建物の中の地図');
    expect(view.get('a').attributes('href')).toBe('/buildings/building-1');
    const clear = vi.spyOn(storage.destination, 'clear');
    await view.get('button').trigger('click');
    await flushPromises();
    expect(clear).toHaveBeenCalledOnce();
    expect(await storage.destination.get()).toBeNull();
    expect(view.text()).toContain('案内を終了しました');
    expect(view.find('.destination-card').exists()).toBe(false);
    expect(view.get('a').attributes('href')).toBe('/');
  });

  it('到着前の「案内をやめる」も同じ保存APIで解除する', async () => {
    const view = await renderGuide();
    await view.get('button').trigger('click');
    await flushPromises();
    expect(await storage.destination.get()).toBeNull();
    expect(view.text()).toContain('案内を終了しました');
  });

  it('解除の失敗を表示して行き先を残し、同じ操作で再試行できる', async () => {
    const view = await renderGuide();
    vi.spyOn(storage.destination, 'clear').mockRejectedValueOnce(new Error('保存失敗'));
    await view.get('button').trigger('click');
    await flushPromises();
    expect(view.get('[role="alert"]').text()).toContain('もう一度お試しください');
    expect(await storage.destination.get()).toEqual({ placeId: place.id });
    expect(view.get('button').attributes('disabled')).toBeUndefined();
    await view.get('button').trigger('click');
    await flushPromises();
    expect(await storage.destination.get()).toBeNull();
    expect(view.find('[role="alert"]').exists()).toBe(false);
  });

  it('解除の処理中は二重操作を防ぐ', async () => {
    const view = await renderGuide();
    let finish!: () => void;
    const clear = vi.spyOn(storage.destination, 'clear').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await view.get('button').trigger('click');
    await flushPromises();
    expect(view.get('button').attributes('disabled')).toBeDefined();
    await view.get('button').trigger('click');
    expect(clear).toHaveBeenCalledOnce();
    finish();
    await flushPromises();
  });

  it('新しい位置が来なくても経過時間を更新し、30秒で古いことを示す', async () => {
    const view = await renderGuide();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(view.text()).toContain('29 秒前に更新');
    expect(view.text()).not.toContain('更新が止まっています');
    await vi.advanceTimersByTimeAsync(1000);
    expect(view.get('.stale').text()).toContain('更新が止まっています・30 秒前に更新');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(view.get('.stale').text()).toContain('1 分前に更新');
    setPosition(0, 0);
    await nextTick();
    expect(view.text()).toContain('0 秒前に更新');
    expect(view.find('.stale').exists()).toBe(false);
  });

  it('位置が使えなくなれば数値と到着表示を消し、位置の設定へ案内する', async () => {
    setPosition(150, 0);
    const view = await renderGuide();
    position.refuse();
    await nextTick();
    expect(view.text()).toContain('現在地が使えません');
    expect(view.text()).not.toContain('着きました');
    expect(view.find('.distance').exists()).toBe(false);
    expect(view.get('.position-banner a').attributes('href')).toBe('/noloc');
    expect(await storage.destination.get()).toEqual({ placeId: place.id });
  });

  it('精度が不明な手入力を精度0として表示しない', async () => {
    setPosition(0, 0, Infinity);
    const view = await renderGuide();
    expect(view.text()).toContain('精度不明');
    expect(view.text()).not.toMatch(/Infinity|NaN|±0/);
  });

  it('屋外の行き先では建物名・階・建物の中の地図を出さない', async () => {
    usePlacesStore().upsert({ ...place, landmarkId: null, floor: null });
    setPosition(150, 0);
    const view = await renderGuide();
    expect(view.text()).toContain('着きました');
    expect(view.text()).not.toContain('総合研究棟');
    expect(view.text()).not.toContain('建物の中の地図');
  });

  it('行き先がない場合は距離を作らずマップへの手を出す', async () => {
    await storage.destination.clear();
    const clear = vi.spyOn(storage.destination, 'clear');
    const view = await renderGuide();
    expect(view.text()).toContain('行き先が選ばれていません');
    expect(view.text()).not.toContain('直線距離');
    expect(view.get('a').attributes('href')).toBe('/');
    expect(clear).not.toHaveBeenCalled();
  });

  it.each(['remove', 'setAll'] as const)('一覧の %s で場所が消えたら自動で案内を終え、マップへ戻る', async change => {
    usePlacesStore().setAll([place, otherPlace]);
    const view = await renderGuide();
    const clear = vi.spyOn(storage.destination, 'clear');
    if (change === 'remove') usePlacesStore().remove(place.id);
    else usePlacesStore().setAll([otherPlace]);
    await nextTick();
    expect(view.text()).not.toContain('お化け屋敷');
    expect(view.text()).not.toContain('直線距離');
    await flushPromises();
    expect(clear).toHaveBeenCalledOnce();
    expect(await storage.destination.get()).toBeNull();
    expect(view.vm.$router.currentRoute.value.name).toBe('map');
    expect(view.text()).toBe('マップ');
    expect(view.findComponent(GuideView).exists()).toBe(false);
  });

  it('場所の取得前は一覧が空でも解除せず、取得後に保存済みの行き先を案内する', async () => {
    usePlacesStore().setAll([]);
    const clear = vi.spyOn(storage.destination, 'clear');
    const view = await renderGuide();
    expect(clear).not.toHaveBeenCalled();
    expect(await storage.destination.get()).toEqual({ placeId: place.id });
    expect(view.vm.$router.currentRoute.value.name).toBe('guide');
    expect(view.find('.destination-card').exists()).toBe(false);
    usePlacesStore().setAll([place]);
    await flushPromises();
    expect(clear).not.toHaveBeenCalled();
    expect(await storage.destination.get()).toEqual({ placeId: place.id });
    expect(view.get('.destination-card').text()).toContain('お化け屋敷');
  });

  it.each(['remove', 'setAll'] as const)('一覧の %s で0件になっても未取得扱いで自動解除しない', async change => {
    const view = await renderGuide();
    const clear = vi.spyOn(storage.destination, 'clear');
    if (change === 'remove') usePlacesStore().remove(place.id);
    else usePlacesStore().setAll([]);
    await flushPromises();
    expect(clear).not.toHaveBeenCalled();
    expect(await storage.destination.get()).toEqual({ placeId: place.id });
    expect(view.vm.$router.currentRoute.value.name).toBe('guide');
    expect(view.find('.destination-card').exists()).toBe(false);
  });

  it('空だった一覧を取得して1件以上になり、行き先が無いと分かったら解除する', async () => {
    usePlacesStore().setAll([]);
    const clear = vi.spyOn(storage.destination, 'clear');
    const view = await renderGuide();
    expect(clear).not.toHaveBeenCalled();
    usePlacesStore().setAll([otherPlace]);
    await flushPromises();
    expect(clear).toHaveBeenCalledOnce();
    expect(await storage.destination.get()).toBeNull();
    expect(view.vm.$router.currentRoute.value.name).toBe('map');
  });

  it('1件以上の一覧に保存済みの行き先が初めから無い場合も自動で解除する', async () => {
    usePlacesStore().setAll([otherPlace]);
    const clear = vi.spyOn(storage.destination, 'clear');
    const view = await renderGuide();
    expect(clear).toHaveBeenCalledOnce();
    expect(await storage.destination.get()).toBeNull();
    expect(view.text()).not.toContain('直線距離');
    expect(view.vm.$router.currentRoute.value.name).toBe('map');
    expect(view.findComponent(GuideView).exists()).toBe(false);
  });

  it('削除時の自動解除に失敗したら古い案内を出さず、再試行で解除できる', async () => {
    usePlacesStore().setAll([place, otherPlace]);
    const view = await renderGuide();
    const clear = vi.spyOn(storage.destination, 'clear').mockRejectedValueOnce(new Error('保存失敗'));
    usePlacesStore().remove(place.id);
    await flushPromises();
    expect(clear).toHaveBeenCalledOnce();
    expect(await storage.destination.get()).toEqual({ placeId: place.id });
    expect(view.get('[role="alert"]').text()).toContain('もう一度お試しください');
    expect(view.get('[role="status"]').text()).toBe('この場所は案内できなくなりました');
    expect(view.find('.destination-card').exists()).toBe(false);
    expect(view.get('a').attributes('href')).toBe('/');
    expect(view.vm.$router.currentRoute.value.name).toBe('guide');
    expect(view.get('button').text()).toBe('案内を終える');
    await view.get('button').trigger('click');
    await flushPromises();
    expect(clear).toHaveBeenCalledTimes(2);
    expect(await storage.destination.get()).toBeNull();
    expect(view.find('[role="alert"]').exists()).toBe(false);
    expect(view.vm.$router.currentRoute.value.name).toBe('map');
    expect(view.findComponent(GuideView).exists()).toBe(false);
  });

  it('自動解除が終わるまで理由を知らせ、完了後に履歴を置き換えてマップへ戻る', async () => {
    usePlacesStore().setAll([place, otherPlace]);
    const view = await renderGuide();
    const router = view.vm.$router;
    const replace = vi.spyOn(router, 'replace');
    const originalClear = storage.destination.clear.bind(storage.destination);
    let finish!: () => void;
    const clear = vi.spyOn(storage.destination, 'clear').mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      await originalClear();
    });
    usePlacesStore().remove(place.id);
    await flushPromises();
    expect(view.get('[role="status"]').text()).toBe('この場所は案内できなくなりました');
    expect(view.find('.destination-card').exists()).toBe(false);
    expect(view.get('button').attributes('disabled')).toBeDefined();
    expect(router.currentRoute.value.name).toBe('guide');
    expect(replace).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledOnce();
    finish();
    await flushPromises();
    expect(await storage.destination.get()).toBeNull();
    expect(replace).toHaveBeenCalledExactlyOnceWith({ name: 'map' });
    expect(router.currentRoute.value.name).toBe('map');
  });

  it('保存先の読み込みに失敗しても理由とマップへの手を出す', async () => {
    vi.mocked(storageModule.getStorage).mockRejectedValueOnce(new Error('読み込み失敗'));
    const view = await renderGuide();
    expect(view.get('[role="alert"]').text()).toContain('行き先を読み込めませんでした');
    expect(view.get('a').attributes('href')).toBe('/');
    expect(view.text()).not.toContain('直線距離');
  });

  it('アンマウント時に経過時間用タイマーを解放する', async () => {
    const view = await renderGuide();
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    wrapper = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });
});
