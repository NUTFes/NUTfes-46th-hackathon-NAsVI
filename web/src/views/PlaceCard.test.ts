import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import PlaceCard from './PlaceCard.vue';
import { routes } from '../router';
import * as geo from '../domain/geo';
import { usePosition } from '../services/position';
import { useLandmarksStore, usePlacesStore } from '../stores';
import * as repositories from '../storage';
import type { StorageRepositories } from '../storage';
import type { Landmark, Place } from '../types';

enableAutoUnmount(afterEach);

const place: Place = {
  id: 'pl_01', name: 'お化け屋敷', kind: 'event',
  location: { lat: 37.4262, lng: 138.7788 },
  landmarkId: 'lm_01', floor: 2, description: '整理券が必要です。',
  hours: [
    { start: '2026-11-28T01:00:00Z', end: '2026-11-28T07:00:00Z' },
    { start: '2026-11-29T01:00:00Z', end: '2026-11-29T07:00:00Z' },
  ],
  labelIds: [],
};
const landmark: Landmark = {
  id: 'lm_01', name: '総合研究棟', location: place.location, footprint: null, floors: [],
};
let pinia: ReturnType<typeof createPinia>;
let storage: StorageRepositories;
let position: ReturnType<typeof usePosition>;

beforeAll(async () => {
  // 全件並列実行時も、遅延ロード先の初回変換を遷移の待機時間に含めない。
  await Promise.all([
    import('./MapView.vue'),
    import('./GuideView.vue'),
    import('./TagsView.vue'),
  ]);
}, 30_000);

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('外部通信は禁止'); }));
  pinia = createPinia();
  setActivePinia(pinia);
  usePlacesStore().setAll([place]);
  useLandmarksStore().setAll([landmark]);
  storage = await repositories.createStorage({ memory: true });
  vi.spyOn(repositories, 'getStorage').mockResolvedValue(storage);
  position = usePosition();
  position.setManually(37.4252, 138.7788, 8);
});

afterEach(async () => {
  expect(fetch).not.toHaveBeenCalled();
  position.dispose();
  await storage.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openCard(id = place.id) {
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push({ name: 'card', params: { id } });
  await router.isReady();
  // アプリ起動時の同期を介さず、場所カード自身の表示・操作を検証する。
  const wrapper = mount(PlaceCard, { attachTo: document.body, global: { plugins: [pinia, router] } });
  await flushPromises();
  return { wrapper, router };
}

describe('場所のカード', () => {
  it('名前・建物と階・種別・説明・複数の開催時間・直線距離を表示する', async () => {
    const calculate = vi.spyOn(geo, 'distanceM');
    const { wrapper } = await openCard();

    expect(wrapper.get('h1').text()).toBe('お化け屋敷');
    expect(wrapper.get('.eyebrow').text()).toBe('総合研究棟・2階・企画');
    expect(wrapper.get('.description').text()).toBe('整理券が必要です。');
    expect(wrapper.get('.hours').text()).toBe('2026/11/28 10:00〜16:00\n2026/11/29 10:00〜16:00');
    expect(wrapper.get('.distance strong').text()).toBe('111m');
    expect(wrapper.get('.distance').text()).toContain('直線');
    expect(calculate).toHaveBeenCalledWith(position.position.value, place.location);
    expect(wrapper.text()).not.toContain('37.4252');
    expect(document.activeElement).toBe(wrapper.get('h1').element);
  });

  it('開くだけでは既存の行き先・タグを変更しない(D-013)', async () => {
    await storage.destination.save({ placeId: 'another-place' });
    const saveDestination = vi.spyOn(storage.destination, 'save');
    const clearDestination = vi.spyOn(storage.destination, 'clear');
    const saveTag = vi.spyOn(storage.tagLinks, 'save');
    const deleteTag = vi.spyOn(storage.tagLinks, 'delete');

    const { router } = await openCard();

    expect(router.currentRoute.value.name).toBe('card');
    expect(await storage.destination.get()).toEqual({ placeId: 'another-place' });
    expect(saveDestination).not.toHaveBeenCalled();
    expect(clearDestination).not.toHaveBeenCalled();
    expect(saveTag).not.toHaveBeenCalled();
    expect(deleteTag).not.toHaveBeenCalled();
  });

  it('「ここへ向かう」で場所IDだけを端末に保存して案内へ進む', async () => {
    const save = vi.spyOn(storage.destination, 'save');
    const { wrapper, router } = await openCard();
    await wrapper.get('.go').trigger('click');
    await flushPromises();

    expect(save).toHaveBeenCalledExactlyOnceWith({ placeId: place.id });
    expect(await storage.destination.get()).toEqual({ placeId: place.id });
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('guide'));
  });

  it('行き先の保存に失敗したらカード上で伝え、再試行できる', async () => {
    vi.spyOn(storage.destination, 'save').mockRejectedValueOnce(new Error('保存失敗'));
    const { wrapper, router } = await openCard();
    await wrapper.get('.go').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('行き先を保存できませんでした');
    expect(router.currentRoute.value.name).toBe('card');
    expect(await storage.destination.get()).toBeNull();
    expect(wrapper.get('.go').attributes('disabled')).toBeUndefined();
    await wrapper.get('.go').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('guide'));
  });

  it.each(repositories.BUILTIN_TAGS)('$title を付け外しし、状態とチェックを更新する', async tag => {
    const { wrapper } = await openCard();
    const button = wrapper.findAll('button').find(item => item.text() === tag.title)!;
    expect(button.attributes('aria-pressed')).toBe('false');

    await button.trigger('click');
    await flushPromises();
    expect(await storage.tagLinks.list(place.id)).toEqual([{ placeId: place.id, tagId: tag.id }]);
    expect(button.attributes('aria-pressed')).toBe('true');
    expect(button.get('svg').attributes('data-icon')).toBe(tag.id === 'favorite' ? 'star' : 'bookmark');
    expect(button.get('svg').attributes('data-filled')).toBe('true');

    await button.trigger('click');
    await flushPromises();
    expect(await storage.tagLinks.list(place.id)).toEqual([]);
    expect(button.attributes('aria-pressed')).toBe('false');
    expect(button.get('svg').attributes('data-filled')).toBeUndefined();
    expect(await storage.destination.get()).toBeNull();
  });

  it('保存済みのタグ状態を読み、別の場所には引き継がない', async () => {
    const tag = repositories.BUILTIN_TAGS[0];
    await storage.tagLinks.save({ placeId: place.id, tagId: tag.id });
    usePlacesStore().upsert({ ...place, id: 'pl_02', name: '別の企画' });
    const { wrapper, router } = await openCard();
    expect(wrapper.get('[aria-pressed="true"]').text()).toContain(tag.title);

    await router.push({ name: 'card', params: { id: 'pl_02' } });
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('別の企画');
    expect(wrapper.find('[aria-pressed="true"]').exists()).toBe(false);
    expect(await storage.tagLinks.list(place.id)).toEqual([{ placeId: place.id, tagId: tag.id }]);
  });

  it('タグ保存の失敗を表示し、付いたことにしない', async () => {
    vi.spyOn(storage.tagLinks, 'save').mockRejectedValueOnce(new Error('保存失敗'));
    const { wrapper } = await openCard();
    const button = wrapper.get('[aria-pressed="false"]');
    await button.trigger('click');
    await flushPromises();

    expect(button.attributes('aria-pressed')).toBe('false');
    expect(button.attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toContain('タグを変更できませんでした');
    expect(await storage.tagLinks.list(place.id)).toEqual([]);
  });

  it('「＋ タグ」でその場所のタグ画面を開く', async () => {
    const { wrapper, router } = await openCard();
    const button = wrapper.findAll('button').find(item => item.text() === '＋ タグ')!;
    await button.trigger('click');
    await flushPromises();

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('tags'));
    expect(router.currentRoute.value.params.id).toBe(place.id);
    expect(await storage.tagLinks.list(place.id)).toEqual([]);
    expect(await storage.destination.get()).toBeNull();
  });

  it('現在地が無ければ距離を推測せず、行き先にはできる', async () => {
    position.refuse();
    const calculate = vi.spyOn(geo, 'distanceM');
    const { wrapper, router } = await openCard();
    expect(wrapper.get('.distance').text()).toContain('直線距離を表示できません');
    expect(wrapper.find('.distance strong').exists()).toBe(false);
    expect(calculate).not.toHaveBeenCalled();

    await wrapper.get('.go').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('guide'));
  });

  it('端末内の現在地の更新で直線距離も更新される', async () => {
    const { wrapper } = await openCard();
    position.setManually(place.location.lat, place.location.lng, 8);
    await flushPromises();
    expect(wrapper.get('.distance strong').text()).toBe('0m');
  });

  it.each(['info', 'wc', 'rest', 'trash'] as const)('設備 %s を facility として表示する(D-030)', async kind => {
    usePlacesStore().upsert({ ...place, kind, hours: [], description: '' });
    const { wrapper } = await openCard();
    expect(wrapper.get('.place-card').attributes('data-kind')).toBe('facility');
    expect(wrapper.get('.eyebrow').text()).toBe('総合研究棟・2階・設備');
    expect(wrapper.find('.hours').exists()).toBe(false);
    expect(wrapper.find('.description').exists()).toBe(false);
  });

  it('建物・階・時間のない屋外駐車場も表示する', async () => {
    usePlacesStore().upsert({ ...place, kind: 'parking', landmarkId: null, floor: null, hours: [] });
    const { wrapper } = await openCard();
    expect(wrapper.get('.place-card').attributes('data-kind')).toBe('parking');
    expect(wrapper.get('.eyebrow').text()).toBe('駐車場');
    expect(wrapper.find('.hours').exists()).toBe(false);
  });

  it('地下階と日をまたぐ開催時間を省略せずに表示する', async () => {
    usePlacesStore().upsert({
      ...place, floor: -1,
      hours: [{ start: '2026-11-28T14:00:00Z', end: '2026-11-28T16:00:00Z' }],
    });
    const { wrapper } = await openCard();
    expect(wrapper.get('.eyebrow').text()).toContain('地下1階');
    expect(wrapper.get('.hours').text()).toBe('2026/11/28 23:00〜2026/11/29 01:00');
  });

  it.each(['UTC', 'America/New_York'])('端末の TZ が %s でも開催時間は日本時間で表示する', async timezone => {
    const previousTZ = process.env.TZ;
    try {
      process.env.TZ = timezone;
      // Vitest のワーカー内で TZ の変更が Intl に反映されない環境でも、
      // 既定タイムゾーンに依存しないことをフォーマッターの引数で確認する。
      const DateTimeFormat = Intl.DateTimeFormat;
      const format = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
        return new DateTimeFormat(locales, { timeZone: timezone, ...options });
      });
      usePlacesStore().upsert({
        ...place,
        hours: [{ start: '2026-11-28T14:00:00Z', end: '2026-11-28T16:00:00Z' }],
      });
      const { wrapper } = await openCard();

      expect(wrapper.get('.hours').text()).toBe('2026/11/28 23:00〜2026/11/29 01:00');
      expect(format).toHaveBeenCalledWith('ja-JP', expect.objectContaining({
        timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
      }));
      expect(format).toHaveBeenCalledWith('ja-JP', expect.objectContaining({
        timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }));
    } finally {
      if (previousTZ === undefined) delete process.env.TZ;
      else process.env.TZ = previousTZ;
    }
  });

  it('一覧が0件なら未取得として表示し、削除文言や有効な操作を出さない', async () => {
    usePlacesStore().setAll([]);
    const { wrapper } = await openCard();

    expect(wrapper.get('[role="status"]').text()).toBe('読み込み中…');
    expect(wrapper.text()).not.toContain('この場所は見られなくなりました');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('.go').exists()).toBe(false);
    expect(wrapper.find('[aria-pressed]').exists()).toBe(false);
    expect(wrapper.find('button:not(:disabled)').exists()).toBe(false);

    usePlacesStore().setAll([place]);
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe(place.name);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.get('.go').attributes('disabled')).toBeUndefined();
  });

  it('表示中に場所が削除されたら説明を出し、行き先・タグ操作を外す', async () => {
    usePlacesStore().upsert({ ...place, id: 'pl_02' });
    const { wrapper } = await openCard();
    usePlacesStore().remove(place.id);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('この場所は見られなくなりました');
    expect(wrapper.find('.go').exists()).toBe(false);
    expect(wrapper.find('[aria-pressed]').exists()).toBe(false);
    expect(await storage.destination.get()).toBeNull();
  });

  it('一覧が1件以上あり不明な場所IDなら削除時と同じ説明と閉じる操作を出す', async () => {
    const { wrapper, router } = await openCard('missing');
    expect(wrapper.get('[role="alert"]').text()).toBe('この場所は見られなくなりました');
    await wrapper.get('button').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('map'));
  });

  it('モーダルとして初期フォーカスを見出しに置き、Tab / Shift+Tab がカード内で循環する', async () => {
    const { wrapper } = await openCard();
    const card = wrapper.get('[role="dialog"]');
    const buttons = card.findAll('button:not(:disabled)');
    expect(card.attributes('aria-modal')).toBe('true');
    expect(card.attributes('aria-labelledby')).toBe(wrapper.get('h1').attributes('id'));
    expect(document.activeElement).toBe(wrapper.get('h1').element);

    for (const button of [...buttons, buttons[0]]) {
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(button.element);
    }
    for (const button of [...buttons].reverse()) {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(button.element);
    }

    (wrapper.get('h1').element as HTMLElement).focus();
    await wrapper.get('h1').trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(buttons[buttons.length - 1].element);
  });

  it('タグ読み込み中は無効なボタンをTab移動で飛ばす', async () => {
    let resolveLinks!: (links: repositories.TagLink[]) => void;
    vi.spyOn(storage.tagLinks, 'list').mockReturnValueOnce(new Promise(resolve => { resolveLinks = resolve; }));
    const { wrapper } = await openCard();
    expect(wrapper.findAll('[aria-pressed]:disabled')).toHaveLength(repositories.BUILTIN_TAGS.length);

    const addTag = wrapper.findAll('button').find(button => button.text() === '＋ タグ')!;
    await wrapper.get('h1').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(addTag.element);
    await addTag.trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(wrapper.get('.close').element);

    resolveLinks([]);
    await flushPromises();
  });

  it('削除表示ではTab / Shift+Tab ともに閉じるボタンに留まる', async () => {
    const { wrapper } = await openCard('missing');
    for (const shiftKey of [false, true]) {
      await wrapper.get('h1').trigger('keydown', { key: 'Tab', shiftKey });
      expect(document.activeElement).toBe(wrapper.get('.close').element);
      await wrapper.get('.close').trigger('keydown', { key: 'Tab', shiftKey });
      expect(document.activeElement).toBe(wrapper.get('.close').element);
    }
  });

  it('未取得で有効なボタンが無い場合もTab / Shift+Tab は見出しに留まる', async () => {
    usePlacesStore().setAll([]);
    const { wrapper } = await openCard();
    for (const shiftKey of [false, true]) {
      await wrapper.get('h1').trigger('keydown', { key: 'Tab', shiftKey });
      expect(document.activeElement).toBe(wrapper.get('h1').element);
    }
  });

  it.each(['通常', '未取得', '削除'])('%s の表示でもEscで地図へ戻る', async state => {
    if (state === '未取得') usePlacesStore().setAll([]);
    const { wrapper, router } = await openCard(state === '削除' ? 'missing' : place.id);
    await wrapper.get('h1').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('map'));
  });

  it('閉じると地図へ戻り、行き先は変更しない', async () => {
    await storage.destination.save({ placeId: 'another-place' });
    const { wrapper, router } = await openCard();
    await wrapper.get('.close').trigger('click');
    await flushPromises();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('map'));
    expect(await storage.destination.get()).toEqual({ placeId: 'another-place' });
  });

  it('閉じるは名前付きの IconButton で、位置指定はカード自身が持たない(M3・M4)', async () => {
    const { wrapper } = await openCard();
    const close = wrapper.get('button.close');
    expect(close.attributes('aria-label')).toBe('閉じる');
    expect(close.find('svg').attributes('data-icon')).toBe('close');
    expect(wrapper.get('.go svg').attributes('data-icon')).toBe('navigation');
    expect(wrapper.get('.place-card').attributes('style')).not.toContain('position');
  });
});
