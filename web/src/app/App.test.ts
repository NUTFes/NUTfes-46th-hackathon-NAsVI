import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { useChangesStore, usePlacesStore } from '../stores';
import GuideView from '../views/GuideView.vue';
import PlaceCard from '../views/PlaceCard.vue';
import TagsView from '../views/TagsView.vue';
import BuildingView from '../views/BuildingView.vue';
import { appHarness, deferred, disposeHarness, event, networkGuards, syncDouble, type Harness } from './testing';

let app: Harness | undefined;
let guards: ReturnType<typeof networkGuards>;
beforeEach(() => { guards = networkGuards(); });
afterEach(async () => {
  await disposeHarness(app);
  app = undefined;
  expect(guards.fetch).not.toHaveBeenCalled();
  expect(guards.network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('S-08 同期と画面の結線', () => {
  it.each([
    ['/guide', GuideView], ['/places/event-1', PlaceCard],
    ['/places/event-1/tags', TagsView], ['/buildings/building-1', BuildingView],
  ] as const)('取得前の %s をマウントせず、解決後に出す', async (path, component) => {
    app = await appHarness(path, []);
    await app.storage.destination.save({ placeId: event.id });
    const clear = vi.spyOn(app.storage.destination, 'clear');
    expect(app.wrapper.findComponent(component).exists()).toBe(false);
    expect(app.wrapper.text()).toContain('場所を読み込んでいます');
    expect(clear).not.toHaveBeenCalled();
    usePlacesStore(app.pinia).setAll([event]);
    app.finish();
    await flushPromises();
    expect(app.wrapper.findComponent(component).exists()).toBe(true);
    expect(clear).not.toHaveBeenCalled();
    expect(await app.storage.destination.get()).toEqual({ placeId: event.id });
  });

  it('syncing が false でも start 未解決なら読み込みを続ける', async () => {
    const double = syncDouble();
    double.sync.state.syncing = false;
    app = await appHarness('/guide', [], double);
    expect(app.wrapper.findComponent(GuideView).exists()).toBe(false);
    expect(app.wrapper.text()).toContain('場所を読み込んでいます');
  });

  it('start 未解決でもキャッシュを先に表示する', async () => {
    app = await appHarness('/places/event-1');
    expect(app.wrapper.findComponent(PlaceCard).exists()).toBe(true);
    expect(app.sync.start).toHaveBeenCalledOnce();
  });

  it.each(['/guide', '/places/event-1', '/places/event-1/tags', '/buildings/building-1'])('キャッシュなしで places 失敗なら %s を出さず再試行を出す', async path => {
    app = await appHarness(path, []);
    await app.storage.destination.save({ placeId: event.id });
    const clear = vi.spyOn(app.storage.destination, 'clear');
    app.finish(['places'], new Error('API unavailable'));
    await flushPromises();
    expect(app.wrapper.get('[aria-label="場所の取得失敗"]').text()).toContain('もう一度読み込む');
    expect(app.wrapper.find('.visitor-overlay').exists()).toBe(false);
    expect(clear).not.toHaveBeenCalled();
    expect(await app.storage.destination.get()).toEqual({ placeId: event.id });
    const pending = deferred<void>();
    app.sync.refresh.mockImplementationOnce(() => pending.promise);
    await app.click('もう一度読み込む');
    expect(app.sync.refresh).toHaveBeenCalledExactlyOnceWith(['places']);
    expect(app.wrapper.findComponent(GuideView).exists()).toBe(false);
    pending.resolve();
    await flushPromises();
  });

  it('キャッシュを表示しながら場所の失敗を知らせ、失敗キー全体で refresh する', async () => {
    app = await appHarness('/places/event-1');
    app.finish(['places', 'stamps'], new Error('offline'));
    await flushPromises();
    expect(app.wrapper.findComponent(PlaceCard).exists()).toBe(true);
    expect(app.wrapper.get('[aria-label="場所の取得失敗"]').text()).toContain('保存済みの情報');
    await app.click('もう一度読み込む');
    expect(app.sync.refresh).toHaveBeenCalledExactlyOnceWith(['places', 'stamps']);
    expect(app.sync.resync).not.toHaveBeenCalled();
  });

  it.each([{ items: [] }, { items: [event] }])('snapshot あり・failedKeys 空の throw は resync を使う（キャッシュ $items）', async ({ items }) => {
    app = await appHarness('/list', items);
    app.finish([], new Error('bootstrap threw'));
    await flushPromises();
    await app.click('もう一度読み込む');
    expect(app.sync.resync).toHaveBeenCalledOnce();
    expect(app.sync.refresh).not.toHaveBeenCalled();
  });

  it('snapshot がない throw は無効な refresh をせず再読み込みを促す', async () => {
    app = await appHarness('/guide', []);
    app.sync.hasSnapshot.value = false;
    app.finish([], new Error('loadCachedOrFetch threw'));
    await flushPromises();
    expect(app.wrapper.get('[aria-label="場所の取得失敗"]').text()).toContain('画面を再読み込みして');
    expect(app.wrapper.findAll('button').map(button => button.text())).toContain('再読み込み');
    expect(app.wrapper.text()).not.toContain('もう一度読み込む');
    expect(app.sync.refresh).not.toHaveBeenCalled();
    expect(app.sync.resync).not.toHaveBeenCalled();
  });

  it('failedKeys の places を error がなくても失敗として扱う', async () => {
    app = await appHarness('/list', []);
    app.finish(['places']);
    await flushPromises();
    expect(app.wrapper.find('[aria-label="場所の取得失敗"]').exists()).toBe(true);
    expect(app.wrapper.find('.place-view').exists()).toBe(false);
  });

  it('throw の再試行で error が一時的に消えても、通知と操作中の表示を保つ', async () => {
    app = await appHarness('/guide', []);
    app.finish([], new Error('updated failed'));
    await flushPromises();
    const pending = deferred<void>();
    app.sync.resync.mockImplementationOnce(() => {
      app!.sync.state.syncing = true;
      app!.sync.state.error = null;
      return pending.promise;
    });
    await app.click('もう一度読み込む');
    expect(app.wrapper.get('[aria-label="場所の取得失敗"] button').text()).toBe('再試行中…');
    expect(app.wrapper.get('[aria-label="場所の取得失敗"] button').attributes('disabled')).toBeDefined();
    expect(app.wrapper.findComponent(GuideView).exists()).toBe(false);
    app.sync.state.syncing = false;
    pending.resolve();
    await flushPromises();
  });

  it.each(['stamps', 'labels', 'landmarks'] as const)('%s の error を places の失敗にしない（場所0件成功）', async key => {
    app = await appHarness('/list', []);
    app.finish([key], new Error(`${key} failed`));
    await flushPromises();
    expect(app.wrapper.find('[aria-label="場所の取得失敗"]').exists()).toBe(false);
    expect(app.wrapper.text()).toContain('0 件');
    expect(app.wrapper.text()).toContain('場所はまだありません');
  });

  it('0件成功を空の一覧として出し、再同期中も読み込みに戻さない', async () => {
    app = await appHarness('/list', []);
    app.finish();
    await flushPromises();
    expect(app.wrapper.text()).toContain('0 件');
    expect(app.wrapper.text()).not.toContain('場所を読み込んでいます');
    app.sync.state.syncing = true;
    await flushPromises();
    expect(app.wrapper.text()).toContain('場所はまだありません');
  });

  it('places の再試行成功後に失敗画面から一覧へ戻る', async () => {
    app = await appHarness('/list', []);
    app.finish(['places'], new Error('offline'));
    await flushPromises();
    app.sync.refresh.mockImplementationOnce(async () => {
      app!.sync.state.failedKeys = [];
      app!.sync.state.error = null;
    });
    await app.click('もう一度読み込む');
    expect(app.wrapper.text()).toContain('0 件');
    expect(app.wrapper.find('[aria-label="場所の取得失敗"]').exists()).toBe(false);
  });

  it('online による再試行完了も0件成功として扱う', async () => {
    app = await appHarness('/list', []);
    app.finish(['places'], new Error('offline'));
    await flushPromises();
    app.sync.state.syncing = true;
    await flushPromises();
    app.sync.state.failedKeys = [];
    app.sync.state.error = null;
    app.sync.state.syncing = false;
    await flushPromises();
    expect(app.wrapper.text()).toContain('0 件');
  });

  it('versionChanged をストアから読み、通知を解除できる', async () => {
    app = await appHarness('/list');
    app.finish();
    const changes = useChangesStore(app.pinia);
    changes.applyChange({ type: 'appVersionChanged', payload: { version: 'next' } });
    await flushPromises();
    expect(app.wrapper.get('[aria-label="アプリの更新"]').text()).toContain('再読み込み');
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    await app.click('再読み込み');
    expect(reload).toHaveBeenCalledOnce();
    await app.click('あとで');
    expect(changes.versionChanged).toBe(false);
    expect(app.wrapper.find('[aria-label="アプリの更新"]').exists()).toBe(false);
  });

  it('最寄りテーマの追加・切替・削除に App と地図が追従する', async () => {
    app = await appHarness('/');
    app.host.dataset.theme = 'light';
    await flushPromises();
    const color = () => app!.wrapper.get<HTMLElement>('.map-view').element.style.getPropertyValue('--app-bg-page');
    expect(color()).toBe('#f6f4fa');
    app.wrapper.element.setAttribute('data-theme', 'dark');
    await flushPromises();
    expect(color()).toBe('#130a22');
    app.wrapper.element.setAttribute('data-theme', 'unknown');
    await flushPromises();
    expect(color()).toBe('#130a22');
    app.wrapper.element.removeAttribute('data-theme');
    await flushPromises();
    expect(color()).toBe('#f6f4fa');
    delete app.host.dataset.theme;
    await flushPromises();
    expect(color()).toBe('#130a22');
  });

  it('経路を変えても同期を再作成せず、アンマウント時に close する', async () => {
    app = await appHarness('/list');
    app.finish();
    await app.router.push('/');
    await flushPromises();
    expect(app.sync.start).toHaveBeenCalledOnce();
    const close = app.sync.close;
    await disposeHarness(app);
    app = undefined;
    expect(close).toHaveBeenCalledOnce();
  });
});
