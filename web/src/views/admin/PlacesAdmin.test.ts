import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createPinia } from 'pinia';
import PlacesAdmin from './PlacesAdmin.vue';
import AdminErrorBanner from '../../admin/AdminErrorBanner.vue';
import { ApiError } from '../../admin/client';
import { provideAdminFeedback } from '../../admin/feedback';
import { usePlacesStore } from '../../stores/places';
import type { Place } from '../../types';

enableAutoUnmount(afterEach);
const fetchMock = vi.fn<typeof fetch>();
const place: Place = {
  id: 'pl_01', name: '焼きそば屋台', kind: 'event', location: { lat: 37.4249, lng: 138.7781 },
  description: '2年生の模擬店', landmarkId: null, floor: null,
  hours: [{ start: '2026-11-28T02:00:00.000Z', end: '2026-11-28T06:00:00.000Z' }],
  labelIds: ['lb_food'],
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('外部通信は禁止'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function failure(status = 500) {
  return new Response(JSON.stringify({ code: 'internal_error', message: '時間をおいて、もう一度試してください' }), {
    status, headers: { 'Content-Type': 'application/problem+json' },
  });
}
function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find(item => item.text() === text);
  if (!found) throw new Error(`ボタンがありません: ${text}`);
  return found;
}

async function render(items: Place[] = [place], response?: Response) {
  fetchMock.mockResolvedValueOnce(response ?? json({ items, cursor: '120' }));
  let feedback!: ReturnType<typeof provideAdminFeedback>;
  let reportError!: ReturnType<typeof vi.spyOn>;
  let clearError!: ReturnType<typeof vi.spyOn>;
  const Host = defineComponent({
    setup() {
      feedback = provideAdminFeedback();
      reportError = vi.spyOn(feedback, 'reportError');
      clearError = vi.spyOn(feedback, 'clearError');
      return () => h('div', [h(AdminErrorBanner, { error: feedback.error.value }), h(PlacesAdmin)]);
    },
  });
  const pinia = createPinia();
  const wrapper = mount(Host, { global: { plugins: [pinia] } });
  await flushPromises();
  return { wrapper, feedback, reportError, clearError, store: usePlacesStore(pinia) };
}

async function fillRequired(wrapper: VueWrapper) {
  await wrapper.get('#place-name').setValue('新しい案内所');
  await wrapper.get('#place-kind').setValue('info');
  await wrapper.get('#place-lat').setValue('37.425');
  await wrapper.get('#place-lng').setValue('138.778');
  await wrapper.get('#place-description').setValue('会場案内');
}

describe('場所の登録・管理', () => {
  it('GET /places を認証付きで読み、名前・種別・種類・位置の表を表示する', async () => {
    const { wrapper, store, clearError, reportError } = await render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/places', expect.objectContaining({ method: 'GET', credentials: 'include' }));
    const row = wrapper.get('tbody tr');
    expect(row.text()).toContain('焼きそば屋台');
    expect(row.text()).toContain('企画');
    expect(row.text()).toContain('lb_food');
    expect(row.text()).toContain('緯度 37.4249 / 経度 138.7781');
    expect(row.text()).toContain('屋外');
    expect(store.items).toEqual([place]);
    expect(clearError).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('空の一覧と建物・階の位置の状態を表示する', async () => {
    const empty = await render([]);
    expect(empty.wrapper.get('tbody').text()).toContain('場所はまだ登録されていません');
    const indoor = await render([{ ...place, landmarkId: 'lm_a', floor: -1 }]);
    expect(indoor.wrapper.get('tbody').text()).toContain('建物 lm_a / -1階');
  });

  it('入力した全項目と複数の開催時間を POST し、応答を一覧に反映する', async () => {
    const { wrapper, store, clearError } = await render([]);
    await fillRequired(wrapper);
    await wrapper.get('#place-landmark').setValue('lm_a');
    await wrapper.get('#place-floor').setValue('2');
    const periods = [
      { start: '2026-11-28T11:00', end: '2026-11-28T12:00' },
      { start: '2026-11-28T13:00', end: '2026-11-28T14:00' },
    ];
    for (const [index, period] of periods.entries()) {
      await button(wrapper, '時間帯を追加').trigger('click');
      await wrapper.get(`#period-start-${index}`).setValue(period.start);
      await wrapper.get(`#period-end-${index}`).setValue(period.end);
    }
    const input = {
      name: '新しい案内所', kind: 'info', location: { lat: 37.425, lng: 138.778 }, description: '会場案内',
      landmarkId: 'lm_a', floor: 2,
      hours: periods.map(period => ({ start: new Date(period.start).toISOString(), end: new Date(period.end).toISOString() })),
    };
    const saved = { ...input, name: '新しい案内所 (登録済み)', id: 'pl_new', labelIds: [] } as Place;
    fetchMock.mockResolvedValueOnce(json(saved, 201));
    clearError.mockClear();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/places', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify(input),
    }));
    expect(store.items).toEqual([saved]);
    expect(wrapper.get('tbody').text()).toContain(saved.name);
    expect(wrapper.get<HTMLInputElement>('#place-name').element.value).toBe('');
    expect(wrapper.get('[role="status"]').text()).toBe('場所を登録しました。');
    expect(clearError).toHaveBeenCalledTimes(2);
  });

  it('編集中は種別を固定し、変更した項目だけ PATCH して応答を反映する', async () => {
    const { wrapper, store } = await render();
    await wrapper.get('button[aria-label="焼きそば屋台を編集"]').trigger('click');
    expect(wrapper.get<HTMLInputElement>('#place-name').element.value).toBe(place.name);
    expect(wrapper.get<HTMLSelectElement>('#place-kind').element.disabled).toBe(true);
    await wrapper.get('#place-name').setValue('焼きそば本店');
    const updated = { ...place, name: '焼きそば本店 (更新済み)' };
    fetchMock.mockResolvedValueOnce(json(updated));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/places/pl_01', expect.objectContaining({
      method: 'PATCH', credentials: 'include', body: JSON.stringify({ name: '焼きそば本店' }),
    }));
    expect(store.items).toEqual([updated]);
    expect(wrapper.get('tbody').text()).toContain(updated.name);
    expect(wrapper.get('[role="status"]').text()).toBe('場所を更新しました。');
  });

  it('屋内から屋外への変更では floor を null にし、開催時間も外せる', async () => {
    const { wrapper } = await render([{ ...place, landmarkId: 'lm_a', floor: 2 }]);
    await wrapper.get('button[aria-label="焼きそば屋台を編集"]').trigger('click');
    await wrapper.get('#place-landmark').setValue('');
    expect(wrapper.get<HTMLInputElement>('#place-floor').element.disabled).toBe(true);
    await button(wrapper, 'この時間帯を外す').trigger('click');
    fetchMock.mockResolvedValueOnce(json({ ...place, hours: [] }));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const options = fetchMock.mock.lastCall![1]!;
    expect(JSON.parse(String(options.body))).toEqual({ landmarkId: null, floor: null, hours: [] });
  });

  it('編集キャンセルと変更なしの更新では API を送らない', async () => {
    const { wrapper } = await render();
    await wrapper.get('button[aria-label="焼きそば屋台を編集"]').trigger('click');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toBe('変更はありません。');
    await wrapper.get('#place-name').setValue('キャンセルする名前');
    await button(wrapper, '編集をキャンセル').trigger('click');
    expect(wrapper.get<HTMLInputElement>('#place-name').element.value).toBe('');
    expect(wrapper.get<HTMLSelectElement>('#place-kind').element.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('削除前に連動内容をすべて表示し、キャンセルと Escape では削除しない', async () => {
    const { wrapper, store } = await render();
    await wrapper.get('button[aria-label="焼きそば屋台を削除"]').trigger('click');
    const dialog = wrapper.get<HTMLDialogElement>('dialog');
    expect(dialog.element.open).toBe(true);
    expect(dialog.text()).toContain('「焼きそば屋台」を削除しますか？');
    expect(dialog.text()).toContain('検索・一覧から消えます');
    expect(dialog.text()).toContain('付いていた運営の種類が外れます');
    expect(dialog.text()).toContain('行き先にしていた来場者の案内が終わります');
    expect(dialog.text()).toContain('スタンプは地点に付くため、場所の削除には連動しません');
    expect(dialog.text()).toContain('削除した ID は再利用されません');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await button(wrapper, 'キャンセル').trigger('click');
    expect(dialog.element.open).toBe(false);
    await wrapper.get('button[aria-label="焼きそば屋台を削除"]').trigger('click');
    await dialog.trigger('cancel');
    expect(dialog.element.open).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.items).toEqual([place]);
  });

  it('了承した場所だけを DELETE し、一覧とその場所の編集を解消する', async () => {
    const other = { ...place, id: 'pl_02', name: '別の場所' };
    const { wrapper, store, clearError } = await render([place, other]);
    await wrapper.get('button[aria-label="焼きそば屋台を編集"]').trigger('click');
    await wrapper.get('button[aria-label="焼きそば屋台を削除"]').trigger('click');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    clearError.mockClear();
    await button(wrapper, '了承して削除する').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/places/pl_01', expect.objectContaining({
      method: 'DELETE', credentials: 'include', body: undefined,
    }));
    expect(store.items).toEqual([other]);
    expect(wrapper.get('tbody').text()).not.toContain(place.name);
    expect(wrapper.get<HTMLInputElement>('#place-name').element.value).toBe('');
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toBe('場所を削除しました。');
    expect(clearError).toHaveBeenCalledTimes(2);
  });

  it('一覧の失敗を reportError し、再試行前と成功時に clearError する', async () => {
    const { wrapper, reportError, clearError, feedback } = await render([], failure());
    expect(reportError).toHaveBeenCalledWith(expect.any(ApiError));
    expect(wrapper.get('[role="alert"]').text()).toContain('時間をおいて');
    expect(wrapper.find('table').exists()).toBe(false);
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
    clearError.mockClear();
    await button(wrapper, '一覧を再読み込み').trigger('click');
    expect(feedback.error.value).toBeNull();
    expect(clearError).toHaveBeenCalledTimes(1);
    resolve(json({ items: [place] }));
    await flushPromises();
    expect(clearError).toHaveBeenCalledTimes(2);
    expect(wrapper.get('tbody').text()).toContain(place.name);
  });

  it.each(['POST', 'PATCH', 'DELETE'] as const)('%s の失敗を reportError し、入力と一覧を保つ', async method => {
    const { wrapper, reportError, clearError, store } = await render();
    if (method === 'POST') await fillRequired(wrapper);
    if (method === 'PATCH') {
      await wrapper.get('button[aria-label="焼きそば屋台を編集"]').trigger('click');
      await wrapper.get('#place-name').setValue('更新した名前');
    }
    if (method === 'DELETE') await wrapper.get('button[aria-label="焼きそば屋台を削除"]').trigger('click');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 'unauthorized', message: '運営としてログインしてください',
    }), { status: 401, headers: { 'Content-Type': 'application/problem+json' } }));
    clearError.mockClear();
    if (method === 'DELETE') await button(wrapper, '了承して削除する').trigger('click');
    else await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: 'unauthorized' }));
    expect(clearError).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[role="alert"]').text()).toContain('運営の権限が必要です');
    expect(store.items).toEqual([place]);
    if (method === 'DELETE') expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false);
    else expect(wrapper.get<HTMLInputElement>('#place-name').element.value).toBe(method === 'POST' ? '新しい案内所' : '更新した名前');
    // 再試行も手動。GET と失敗した1回以外にリクエストがない。
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ネットワークの失敗も reportError する', async () => {
    const { wrapper, reportError } = await render();
    const error = new TypeError('通信できません');
    fetchMock.mockRejectedValueOnce(error);
    await button(wrapper, '一覧を再読み込み').trigger('click');
    await flushPromises();
    expect(reportError).toHaveBeenCalledWith(error);
    expect(wrapper.get('[role="alert"]').text()).toContain('通信に失敗しました');
    expect(wrapper.get('tbody').text()).toContain(place.name);
  });

  it('削除の通信中は二重送信・キャンセルを防ぐ', async () => {
    const { wrapper } = await render();
    await wrapper.get('button[aria-label="焼きそば屋台を削除"]').trigger('click');
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
    await button(wrapper, '了承して削除する').trigger('click');
    expect(button(wrapper, '了承して削除する').attributes('disabled')).toBeDefined();
    await button(wrapper, '了承して削除する').trigger('click');
    await wrapper.get('dialog').trigger('cancel');
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolve(new Response(null, { status: 204 }));
    await flushPromises();
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false);
  });

  it('画面を離れた後の通信中断は reportError しない', async () => {
    const { wrapper, reportError } = await render();
    let reject!: (reason: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((_resolve, fail) => { reject = fail; }));
    await button(wrapper, '一覧を再読み込み').trigger('click');
    const signal = fetchMock.mock.lastCall![1]!.signal!;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    reject(new DOMException('中断しました', 'AbortError'));
    await flushPromises();
    expect(reportError).not.toHaveBeenCalled();
  });
});
