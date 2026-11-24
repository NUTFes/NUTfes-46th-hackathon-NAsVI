import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import screens from '../../../concept-design/screens.yaml?raw';
import { usePosition } from '../services/position';
import { useStampsStore } from '../stores';
import MapView from '../views/MapView.vue';
import { countByBuilding } from '../domain/filter';
import { appHarness, disposeHarness, event, facilities, networkGuards, routeNames, type Harness } from '../app/testing';

// YAML の journey.steps から画面列を読む。操作だけの同一画面の行は遷移として数えない。
const limit = Number(screens.match(/max_transitions_per_journey: (\d+)/)![1]);
function journeyScreens(id: string) {
  const block = screens.slice(screens.indexOf('journeys:')).split(/\n  - id: /)
    .find(part => part.startsWith(`${id}\n`));
  if (!block) throw new Error(`screens.yaml に ${id} がありません`);
  const names = [...block.matchAll(/screen: (\w+)/g)].map(match => match[1]);
  return names.filter((name, index) => index === 0 || name !== names[index - 1]);
}
let app: Harness | undefined;
let guards: ReturnType<typeof networkGuards>;
let position: ReturnType<typeof usePosition>;
let trace: string[];
beforeEach(() => {
  guards = networkGuards();
  position = usePosition();
  position.refuse();
  trace = [];
});
afterEach(async () => {
  await disposeHarness(app);
  app = undefined;
  position.dispose();
  expect(guards.network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function open(path = '/', items = [event]) {
  app = await appHarness(path, items);
  app.finish();
  await flushPromises();
  trace.push(String(app.router.currentRoute.value.name));
  app.router.afterEach(to => {
    const name = String(to.name);
    if (trace.at(-1) !== name) trace.push(name);
  });
  return app;
}
function checkJourney(id: string) {
  expect(trace).toEqual(journeyScreens(id));
  expect(trace.length - 1).toBeLessThanOrEqual(limit);
}
async function searchAndOpen() {
  await app!.wrapper.get('.map-view input[type="search"]').setValue('お化け');
  await app!.wrapper.get('.map-view form').trigger('submit');
  await flushPromises();
  await vi.waitFor(() => expect(app!.router.currentRoute.value.query.q).toBe('お化け'));
  await flushPromises();
  await app!.click('お化け屋敷', '.place-row__open');
  await vi.waitFor(() => expect(app!.router.currentRoute.value.name).toBe('card'));
  await flushPromises();
}

describe('S-08 screens.yaml の来場者ジャーニー', () => {
  it('F1: マップで検索し、検索結果から場所のカードを開く', async () => {
    await open();
    await searchAndOpen();
    expect(app!.wrapper.get('.place-card').text()).toContain('研究棟');
    expect(await app!.storage.destination.get()).toBeNull();
    checkJourney('F1');
    expect(guards.fetch).not.toHaveBeenCalled();
  });

  it('F2: 明示的に行き先を選び、到着後に案内を終える（画面内の終了操作は0遷移）', async () => {
    await open();
    await searchAndOpen();
    await app!.click('ここへ向かう');
    await vi.waitFor(() => expect(app!.router.currentRoute.value.name).toBe('guide'));
    await flushPromises();
    expect(await app!.storage.destination.get()).toEqual({ placeId: event.id });
    expect(app!.wrapper.get('.guide-view').text()).toContain('お化け屋敷');
    position.setManually(event.location.lat, event.location.lng, 8);
    await flushPromises();
    expect(app!.wrapper.text()).toContain('行き先に着きました');
    await app!.click('案内を終える');
    expect(await app!.storage.destination.get()).toBeNull();
    checkJourney('F2');
    expect(guards.fetch).not.toHaveBeenCalled();
  });

  it('F3: マップからスタンプを開き、種類の選択で押す（fetch はモック）', async () => {
    await open();
    position.setManually(event.location.lat, event.location.lng, 8);
    await flushPromises();
    await app!.click('スタンプを押す', '.map-view a');
    const now = Date.now();
    const stamp = {
      id: 's-08-stamp', kind: 'congestion-3', at: event.location,
      pressedAt: new Date(now).toISOString(), expiresAt: new Date(now + 1_800_000).toISOString(),
    };
    guards.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...stamp, proof: 's-08-proof' }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    }));
    await app!.wrapper.get('button[aria-label="混雑3"]').trigger('click');
    await flushPromises();
    expect(useStampsStore(app!.pinia).items).toEqual([stamp]);
    expect(await app!.storage.proofs.get(stamp.id)).toMatchObject({ proof: 's-08-proof' });
    expect(guards.fetch).toHaveBeenCalledTimes(1);
    expect(String(guards.fetch.mock.calls[0][0])).toBe('/api/stamps');
    checkJourney('F3');
  });

  it('F4: 一覧の種類で絞り、カードを開く。設備を一覧・件数に含めない', async () => {
    await open('/list', [event, ...facilities, { ...event, id: 'other', name: '別の企画', labelIds: [] }]);
    expect(app!.wrapper.get('.place-view__count').text()).toBe('2 件');
    facilities.forEach(facility => expect(app!.wrapper.text()).not.toContain(facility.name));
    await app!.click('遊び', '.filter-chips button');
    expect(app!.wrapper.get('.place-view__count').text()).toBe('1 件');
    facilities.forEach(facility => expect(app!.wrapper.text()).not.toContain(facility.name));
    expect(countByBuilding([event, ...facilities], { labelIds: ['play'], tagIds: [] }).get(event.landmarkId!)).toBe(1);
    await app!.click('お化け屋敷', '.place-row__open');
    await vi.waitFor(() => expect(app!.router.currentRoute.value.name).toBe('card'));
    checkJourney('F4');
  });

  it('F1-building: 地図の建物選択から階を選び、企画のカードを開く', async () => {
    await open('/', [event, { ...event, id: 'ground', name: '1階の企画', floor: 1 }]);
    app!.wrapper.findComponent({ name: 'MapCanvas' }).vm.$emit('select', { kind: 'building', id: 'building-1' });
    await vi.waitFor(() => expect(app!.router.currentRoute.value.name).toBe('building'));
    await flushPromises();
    await app!.wrapper.get('[role="tab"][aria-label="2階、企画 1 件"]').trigger('click');
    await app!.click('お化け屋敷企画 · 研究棟 · 2階', '.building__row');
    await vi.waitFor(() => expect(app!.router.currentRoute.value.name).toBe('card'));
    expect(app!.router.currentRoute.value.params.id).toBe(event.id);
    checkJourney('F1-building');
  });

  it('F4-tag: カードからタグを作って付け、地図のチップで絞れる', async () => {
    await open('/places/event-1');
    await app!.click('行きたい場所', '.place-card .tag');
    await app!.click('＋ タグ');
    await vi.waitFor(() => expect(app!.router.currentRoute.value.name).toBe('tags'));
    await flushPromises();
    await app!.wrapper.get('.tags-sheet input').setValue('あとで行く');
    await app!.click('作る', '.tags-sheet .create-row button');
    await app!.click('マップ', '.visitor-tabs a');
    await app!.click('あとで行く', '.filter-chips button');
    expect((await app!.storage.filter.get()).tagIds).toHaveLength(1);
    expect(app!.wrapper.get('.filter-band').text()).toContain('1 件');
    checkJourney('F4-tag');
  });

  it('F2-noloc: 位置を許可して取得できたら地図へ戻り、現在地を表示する', async () => {
    const watchPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: event.location.lat, longitude: event.location.lng, accuracy: 8 }, timestamp: Date.now() } as GeolocationPosition);
      return 1;
    });
    vi.stubGlobal('navigator', { geolocation: { watchPosition, clearWatch: vi.fn() } });
    await open('/noloc');
    expect(app!.wrapper.findComponent(MapView).exists()).toBe(false);
    await app!.click('位置の利用を許可');
    expect(watchPosition).toHaveBeenCalledOnce();
    const map = app!.wrapper.findComponent({ name: 'MapCanvas' });
    expect(map.props('state').position).toMatchObject({ ...event.location, accuracy: 8 });
    checkJourney('F2-noloc');
    expect(guards.fetch).not.toHaveBeenCalled();
  });

  it('地図の位置状態と、位置なしスタンプの両方から単独の /noloc に行ける', async () => {
    await open();
    await app!.wrapper.get('.map-view a[href="/noloc"]').trigger('click');
    await flushPromises();
    expect(app!.router.currentRoute.value.name).toBe('noloc');
    await app!.router.push('/stamp');
    await flushPromises();
    await app!.wrapper.get('.stamp-view a[href="/noloc"]').trigger('click');
    await flushPromises();
    expect(app!.router.currentRoute.value.name).toBe('noloc');
    expect(app!.wrapper.findComponent(MapView).exists()).toBe(false);
  });

  it('地図の屋外の場所選択はカードへ、カメラと位置なしの経路は登録済み', async () => {
    await open();
    app!.wrapper.findComponent({ name: 'MapCanvas' }).vm.$emit('select', { kind: 'place', id: event.id });
    await vi.waitFor(() => expect(app!.router.currentRoute.value.name).toBe('card'));
    for (const name of ['camera', 'noloc']) expect(app!.router.hasRoute(name)).toBe(true);
  });

  it('検索語の URL 書き戻しはカードへの遷移・戻る・進むをまたいで動く', async () => {
    await open('/search?q=お化け&extra=keep#results');
    vi.useFakeTimers();
    const input = app!.wrapper.get('.place-view input[type="search"]');
    await input.setValue('屋敷');
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(app!.router.currentRoute.value.query).toEqual({ q: '屋敷', extra: 'keep' });
    expect(app!.router.currentRoute.value.hash).toBe('#results');
    await app!.click('お化け屋敷', '.place-row__open');
    app!.router.back();
    await flushPromises();
    expect(app!.wrapper.get<HTMLInputElement>('.place-view input').element.value).toBe('屋敷');
    app!.router.forward();
    await flushPromises();
    expect(app!.router.currentRoute.value.name).toBe('card');
  });

  it('絞り込んだ地図も設備とスタンプを残し、件数は設備を除く', async () => {
    await open('/', [event, ...facilities]);
    const stamp = { id: 'map-stamp', kind: 'fun' as const, at: event.location,
      pressedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    useStampsStore(app!.pinia).upsert(stamp);
    await app!.click('遊び', '.filter-chips button');
    const state = app!.wrapper.findComponent({ name: 'MapCanvas' }).props('state');
    expect(state.places.map((place: { id: string }) => place.id)).toEqual([event.id, ...facilities.map(place => place.id)]);
    expect(state.stamps).toEqual([stamp]);
    expect(app!.wrapper.get('.filter-band').text()).toContain('1 件');
    await app!.click('解除', '.filter-band button');
    expect(await app!.storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
  });

  it('設備名で検索しても検索結果や件数に設備を含めない', async () => {
    await open('/search?q=設備', [event, ...facilities]);
    expect(app!.wrapper.get('.place-view__count').text()).toContain('0 件');
    expect(app!.wrapper.find('.place-row').exists()).toBe(false);
  });

  it.each(['/', '/list', '/search?q=設備', '/places/event-1', '/places/event-1/tags', '/guide', '/stamp', '/buildings/building-1', '/noloc', '/camera'])('来場者の %s に管理画面へのリンクを出さない', async path => {
    await open(path);
    expect(routeNames(app!.wrapper).some(href => href?.startsWith('/admin'))).toBe(false);
    expect(app!.wrapper.find('.visitor-tabs').exists()).toBe(true);
  });
});
