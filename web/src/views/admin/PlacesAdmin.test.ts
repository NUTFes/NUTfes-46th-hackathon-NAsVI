import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createPinia } from 'pinia';
import PlacesAdmin from './PlacesAdmin.vue';
import AdminErrorBanner from '../../admin/AdminErrorBanner.vue';
import { ApiError } from '../../admin/client';
import { provideAdminFeedback } from '../../admin/feedback';
import { usePlacesStore } from '../../stores/places';
import type { Landmark, Place } from '../../types';

enableAutoUnmount(afterEach);
const fetchMock = vi.fn<typeof fetch>();
const place: Place = {
  id: 'pl_01', name: '焼きそば屋台', kind: 'event', location: { lat: 37.4249, lng: 138.7781 },
  description: '2年生の模擬店', landmarkId: null, floor: null,
  hours: [{ start: '2026-11-28T02:00:00.000Z', end: '2026-11-28T06:00:00.000Z' }],
  labelIds: ['lb_food'],
};

const building: Landmark = {
  id: 'lm_a', name: '講義棟', location: { lat: 37.425, lng: 138.778 }, footprint: null, floors: [],
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async url => {
    if (url === '/api/landmarks') return json({ items: [building] });
    if (url === '/api/labels') return json({ items: [{ id: 'lb_food', title: '飲食' }] });
    throw new Error('外部通信は禁止');
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

function expectFieldError(wrapper: VueWrapper, selector: string, field: string, text: string) {
  expect(wrapper.get(selector).attributes('aria-invalid')).toBe('true');
  expect(wrapper.get(selector).attributes('aria-describedby')?.split(' ')).toContain(`place-${field}-error`);
  expect(wrapper.get(`#place-${field}-error`).text()).toContain(text);
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith('/api/places', expect.objectContaining({ method: 'GET', credentials: 'include' }));
    const row = wrapper.get('tbody tr');
    expect(row.text()).toContain('焼きそば屋台');
    expect(row.text()).toContain('企画');
    expect(row.text()).toContain('飲食');
    expect(row.text()).not.toContain('lb_food');
    expect(row.text()).toContain('2026-11-28 11:00 〜 2026-11-28 15:00');
    expect(fetchMock).toHaveBeenCalledWith('/api/landmarks', expect.objectContaining({ method: 'GET', credentials: 'include' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/labels', expect.objectContaining({ method: 'GET', credentials: 'include' }));
    expect(row.text()).toContain('緯度 37.4249 / 経度 138.7781');
    expect(row.text()).toContain('屋外');
    expect(store.items).toEqual([place]);
    expect(clearError).toHaveBeenCalledTimes(2);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('空の一覧と建物・階の位置の状態を表示する', async () => {
    const empty = await render([]);
    expect(empty.wrapper.get('tbody').text()).toContain('まだ登録されていません');
    const indoor = await render([{ ...place, landmarkId: 'lm_a', floor: -1 }]);
    expect(indoor.wrapper.get('tbody').text()).toContain('講義棟');
    expect(indoor.wrapper.get('tbody').text()).toContain('-1階');
  });

  it('建物を名前で選択でき、未取得の種類も識別できる', async () => {
    const { wrapper } = await render([{ ...place, labelIds: ['lb_missing'] }]);
    expect(wrapper.get('#place-landmark').element.tagName).toBe('SELECT');
    expect(wrapper.get('#place-landmark option[value="lm_a"]').text()).toBe('講義棟');
    expect(wrapper.get<HTMLInputElement>('#place-floor').element.disabled).toBe(true);
    expect(wrapper.get('tbody').text()).toContain('未取得の種類 (lb_missing)');
    await wrapper.get('#place-landmark').setValue('lm_a');
    expect(wrapper.get<HTMLInputElement>('#place-floor').element.disabled).toBe(false);
  });

  it.each(['UTC', 'America/Los_Angeles'])('%s の端末でも UTC 応答を日本時間で表示・編集し、+09:00 で送信する', async tz => {
    vi.stubEnv('TZ', tz);
    const overnight = {
      ...place,
      hours: [{ start: '2026-11-28T15:00:00.000Z', end: '2026-11-28T16:30:12.345Z' }],
    };
    const { wrapper } = await render([overnight]);
    expect(wrapper.get('tbody').text()).toContain('2026-11-29 00:00 〜 2026-11-29 01:30');
    await wrapper.get('button[aria-label="焼きそば屋台を編集"]').trigger('click');
    // datetime-local はゼロの秒・ミリ秒を省略する。
    expect(wrapper.get<HTMLInputElement>('#period-start-0').element.value).toBe('2026-11-29T00:00');
    expect(wrapper.get<HTMLInputElement>('#period-end-0').element.value).toBe('2026-11-29T01:30:12.345');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(wrapper.get('[role="status"]').text()).toBe('変更はありません。');
    await wrapper.get('#period-start-0').setValue('2026-11-29T00:15');
    fetchMock.mockResolvedValueOnce(json(overnight));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/places/pl_01', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ hours: [{ start: '2026-11-29T00:15:00+09:00', end: '2026-11-29T01:30:12.345+09:00' }] }),
    }));
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
      hours: periods.map(period => ({ start: `${period.start}:00+09:00`, end: `${period.end}:00+09:00` })),
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
    expect(wrapper.text()).toContain('同じ場所の同じ項目を複数人が更新すると、あとから送信した内容が残ります');
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
    expect(wrapper.get<HTMLSelectElement>('#place-landmark').element.value).toBe('lm_a');
    expect(wrapper.get<HTMLInputElement>('#place-floor').element.value).toBe('2');
    expect(wrapper.get('#place-floor-error').text()).toContain('先に階の入力を消してください');
    expect(wrapper.get('#place-floor').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('#place-floor').attributes('aria-describedby')).toContain('place-floor-error');
    await wrapper.get('#place-floor').setValue('');
    await wrapper.get('#place-landmark').setValue('');
    expect(wrapper.get<HTMLInputElement>('#place-floor').element.disabled).toBe(true);
    expect(wrapper.find('#place-floor-error').exists()).toBe(false);
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['info', 'wc', 'rest', 'trash'] as const)('設備 %s も説明を保存し、時間がなければ空配列で送信する', async kind => {
    const { wrapper } = await render([]);
    await fillRequired(wrapper);
    await wrapper.get('#place-kind').setValue(kind);
    expect(wrapper.get<HTMLInputElement>('#place-description').element.value).toBe('会場案内');
    fetchMock.mockResolvedValueOnce(json({ ...place, kind, description: '会場案内', hours: [] }, 201));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(JSON.parse(String(fetchMock.mock.lastCall![1]!.body))).toMatchObject({
      kind, description: '会場案内', hours: [], landmarkId: null, floor: null,
    });
  });

  it.each([
    ['name', '#place-name'], ['kind', '#place-kind'], ['location', '#place-lat'],
    ['description', '#place-description'], ['landmarkId', '#place-landmark'], ['floor', '#place-floor'],
    ['hours', '#period-start-0'],
  ])('API の400 (%s) を対応する項目と読み上げに結び付け、入力を残す', async (field, selector) => {
    const { wrapper, reportError } = await render([]);
    await fillRequired(wrapper);
    await wrapper.get('#place-landmark').setValue('lm_a');
    await button(wrapper, '時間帯を追加').trigger('click');
    await wrapper.get('#period-start-0').setValue('2026-11-28T11:00');
    await wrapper.get('#period-end-0').setValue('2026-11-28T12:00');
    const message = `${field} を確認してください`;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'invalid_input', field, message }), {
      status: 400, headers: { 'Content-Type': 'application/problem+json' },
    }));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expectFieldError(wrapper, selector, field, message);
    if (field === 'location') expectFieldError(wrapper, '#place-lng', field, message);
    if (field === 'hours') expectFieldError(wrapper, '#period-end-0', field, message);
    expect(wrapper.get('[role="alert"]').text()).toContain(message);
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ status: 400, field }));
    expect(wrapper.get<HTMLInputElement>('#place-name').element.value).toBe('新しい案内所');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['#place-name', '', 'name', '名前は1〜50文字'],
    ['#place-name', 'あ'.repeat(51), 'name', '名前は1〜50文字'],
    ['#place-description', 'あ'.repeat(501), 'description', '説明は500文字以内'],
    ['#place-lat', '', 'location', '緯度を正しく'],
    ['#place-lat', '91', 'location', '緯度を正しく'],
    ['#place-lng', '181', 'location', '経度を正しく'],
    ['#place-floor', '1.5', 'floor', '階は-5〜20の整数'],
    ['#place-floor', '21', 'floor', '階は-5〜20の整数'],
    ['#period-start-0', '', 'hours', '開催時間の開始と終了'],
    ['#period-end-0', '2026-11-28T10:00', 'hours', '開催時間の開始と終了'],
  ])('クライアント検証: %s の不正値は項目にエラーを出し送信しない', async (selector, value, field, message) => {
    const { wrapper } = await render([]);
    await fillRequired(wrapper);
    await wrapper.get('#place-landmark').setValue('lm_a');
    await button(wrapper, '時間帯を追加').trigger('click');
    await wrapper.get('#period-start-0').setValue('2026-11-28T11:00');
    await wrapper.get('#period-end-0').setValue('2026-11-28T12:00');
    await wrapper.get(selector).setValue(value);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expectFieldError(wrapper, selector, field, message);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 修正後の再送信で、項目エラーと全体エラーを解消する。
    await wrapper.get(selector).setValue(field === 'hours' ? '2026-11-28T11:00' : field === 'floor' ? '2' : field === 'location' ? '37' : '修正済み');
    fetchMock.mockResolvedValueOnce(json(place, 201));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[aria-invalid="true"]').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(['PATCH', 'DELETE'] as const)('%s の404後は一覧を再取得し、入力を保って案内を表示する', async method => {
    const { wrapper, store } = await render();
    await wrapper.get('button[aria-label="焼きそば屋台を編集"]').trigger('click');
    await wrapper.get('#place-name').setValue('残しておく入力');
    if (method === 'DELETE') await wrapper.get('button[aria-label="焼きそば屋台を削除"]').trigger('click');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'not_found', message: '場所が削除されています' }), {
      status: 404, headers: { 'Content-Type': 'application/problem+json' },
    }));
    fetchMock.mockResolvedValueOnce(json({ items: [], cursor: '121' }));
    if (method === 'DELETE') await button(wrapper, '削除する').trigger('click');
    else await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/places', expect.objectContaining({ method: 'GET' }));
    expect(store.items).toEqual([]);
    expect(wrapper.get('[role="alert"]').text()).toContain('場所が削除されています');
    expect(wrapper.get('[role="status"]').text()).toContain('一覧を再取得しました');
    expect(wrapper.get<HTMLInputElement>('#place-name').element.value).toBe('残しておく入力');
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false);
  });

  it('404後の一覧再取得も失敗した場合、再読み込みを案内する', async () => {
    const { wrapper, store } = await render();
    await wrapper.get('button[aria-label="焼きそば屋台を編集"]').trigger('click');
    await wrapper.get('#place-name').setValue('残しておく入力');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'not_found', message: '場所がありません' }), {
      status: 404, headers: { 'Content-Type': 'application/problem+json' },
    }));
    fetchMock.mockRejectedValueOnce(new TypeError('通信できません'));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="status"]').text()).toContain('一覧の再取得にも失敗しました');
    expect(wrapper.get('[role="alert"]').text()).toContain('場所がありません');
    expect(store.items).toEqual([place]);
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await button(wrapper, 'やめる').trigger('click');
    expect(dialog.element.open).toBe(false);
    await wrapper.get('button[aria-label="焼きそば屋台を削除"]').trigger('click');
    await dialog.trigger('cancel');
    expect(dialog.element.open).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(store.items).toEqual([place]);
  });

  it('了承した場所だけを DELETE し、一覧とその場所の編集を解消する', async () => {
    const other = { ...place, id: 'pl_02', name: '別の場所' };
    const { wrapper, store, clearError } = await render([place, other]);
    await wrapper.get('button[aria-label="焼きそば屋台を編集"]').trigger('click');
    await wrapper.get('button[aria-label="焼きそば屋台を削除"]').trigger('click');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    clearError.mockClear();
    await button(wrapper, '削除する').trigger('click');
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
    if (method === 'DELETE') await button(wrapper, '削除する').trigger('click');
    else await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: 'unauthorized' }));
    expect(clearError).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[role="alert"]').text()).toContain('運営の権限が必要です');
    expect(store.items).toEqual([place]);
    if (method === 'DELETE') expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false);
    else expect(wrapper.get<HTMLInputElement>('#place-name').element.value).toBe(method === 'POST' ? '新しい案内所' : '更新した名前');
    // 自動再送せず、初回の3件取得と失敗した1回だけ。
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
    await button(wrapper, '削除する').trigger('click');
    expect(button(wrapper, '削除する').attributes('disabled')).toBeDefined();
    await button(wrapper, '削除する').trigger('click');
    await wrapper.get('dialog').trigger('cancel');
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
