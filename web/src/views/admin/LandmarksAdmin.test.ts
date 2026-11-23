import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { routes } from '../../router';
import { useLandmarksStore } from '../../stores/landmarks';
import type { Landmark } from '../../types';

enableAutoUnmount(afterEach);
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' },
});
const footprint: NonNullable<Landmark['footprint']> = [
  { lat: 37.425, lng: 138.778 }, { lat: 37.426, lng: 138.778 }, { lat: 37.426, lng: 138.779 },
];
const building = (overrides: Partial<Landmark> = {}): Landmark => ({
  id: 'lm-a', name: 'A棟', location: { lat: 37.4252, lng: 138.7788 }, footprint, floors: [], ...overrides,
});
const floor = {
  floor: 1, plan: { viewBox: '0 0 10 10', d: 'M0 0 H10 V10 Z' },
  bounds: { north: 37.426, south: 37.425, east: 138.779, west: 138.778 },
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('外部通信は禁止'));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_API_BASE', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function render(items: Landmark[] = [building()], initialResponse?: Promise<Response>) {
  fetchMock.mockImplementationOnce(() => initialResponse ?? Promise.resolve(json({ items })));
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push('/admin/landmarks');
  await router.isReady();
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [router, pinia] } });
  await flushPromises();
  return { wrapper, store: useLandmarksStore(pinia) };
}

function button(wrapper: VueWrapper, text: string) {
  const result = wrapper.findAll('button').find((item) => item.text() === text);
  if (!result) throw new Error(`ボタンがありません: ${text}`);
  return result;
}
async function fill(wrapper: VueWrapper, name = '新しい棟', lat = '37.425', lng = '138.778') {
  await wrapper.get('#landmark-name').setValue(name);
  await wrapper.get('#landmark-lat').setValue(lat);
  await wrapper.get('#landmark-lng').setValue(lng);
}
async function editFirst(wrapper: VueWrapper) {
  await wrapper.get('tbody button').trigger('click');
}

describe('建物の一覧・登録・更新', () => {
  it('AdminLayout の中で一覧、輪郭の有無、階の状態を表示する', async () => {
    const { wrapper } = await render([
      building({ floors: [floor] }), building({ id: 'lm-b', name: 'B棟', footprint: null }),
    ]);
    expect(wrapper.get('header h1').text()).toBe('運営の画面');
    expect(wrapper.findAll('tbody tr').map((row) => row.text())).toEqual([
      'A棟形あり1階編集', 'B棟形なし未登録編集',
    ]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/landmarks', expect.objectContaining({
      method: 'GET', credentials: 'include', signal: expect.any(AbortSignal),
    }));
  });

  it('空の一覧には未登録の案内と登録欄を出す', async () => {
    const { wrapper } = await render([]);
    expect(wrapper.text()).toContain('建物はまだ登録されていません。');
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined();
    expect(button(wrapper, '登録する').exists()).toBe(true);
  });

  it('読み込み失敗を共通バナーに出し、空の一覧と区別して再取得する', async () => {
    const { wrapper } = await render([], Promise.resolve(json({ code: 'internal_error', message: '取得できません' }, 500)));
    expect(wrapper.get('[role="alert"]').text()).toContain('取得できません');
    expect(wrapper.text()).not.toContain('建物はまだ登録されていません。');
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    fetchMock.mockResolvedValueOnce(json({ items: [building()] }));
    await button(wrapper, '一覧を読み込み直す').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('tbody').text()).toContain('A棟');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('名前と位置だけを登録し、輪郭がなくても成功として表示する', async () => {
    const saved = building({ id: 'lm-new', name: '新しい棟', footprint: null });
    const { wrapper, store } = await render([]);
    await fill(wrapper);
    fetchMock.mockResolvedValueOnce(json(saved, 201));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/landmarks', expect.objectContaining({
      method: 'POST', credentials: 'include',
      body: JSON.stringify({ name: '新しい棟', location: { lat: 37.425, lng: 138.778 } }),
    }));
    expect(store.items).toEqual([saved]);
    expect(wrapper.text()).toContain('建物を登録しました。');
    expect(wrapper.text()).toContain('形なし（カメラの正面に出ない）');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('選んだ建物の名前・位置を PATCH し、応答の輪郭と階を保つ', async () => {
    const original = building({ id: '棟/a', floors: [floor] });
    const saved = { ...original, name: 'A棟（本館）', location: { lat: 37.426, lng: 138.779 } };
    const { wrapper, store } = await render([original]);
    await editFirst(wrapper);
    expect((wrapper.get('#landmark-name').element as HTMLInputElement).value).toBe('A棟');
    await fill(wrapper, saved.name, '37.426', '138.779');
    fetchMock.mockResolvedValueOnce(json(saved));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/landmarks/${encodeURIComponent(original.id)}`, expect.objectContaining({
      method: 'PATCH', credentials: 'include', body: JSON.stringify({ name: saved.name, location: saved.location }),
    }));
    expect(store.items).toEqual([saved]);
    expect(wrapper.text()).toContain('建物を更新しました。');
    await button(wrapper, '新しい建物').trigger('click');
    expect((wrapper.get('#landmark-name').element as HTMLInputElement).value).toBe('');
    expect(button(wrapper, '登録する').exists()).toBe(true);
  });

  it.each([
    ['', '37', '138', 'name'], ['あ'.repeat(51), '37', '138', 'name'],
    ['A棟', '', '138', 'lat'], ['A棟', '37', '', 'lng'],
    ['A棟', '91', '138', 'lat'], ['A棟', '-91', '138', 'lat'],
    ['A棟', '37', '181', 'lng'], ['A棟', '37', '-181', 'lng'],
  ])('契約外の入力を送らない: %s / %s / %s', async (name, lat, lng, field) => {
    const { wrapper } = await render([]);
    await fill(wrapper, name, lat, lng);
    await wrapper.get('form').trigger('submit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const input = wrapper.get(`#landmark-${field}`);
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby')).toBe(`landmark-${field}-error`);
    expect(wrapper.get(`#landmark-${field}-error`).text()).not.toBe('');
    expect(document.activeElement).toBe(input.element);
    await input.setValue(field === 'name' ? 'A棟' : '0');
    expect(input.attributes('aria-invalid')).toBeUndefined();
    expect(input.attributes('aria-describedby')).toBeUndefined();
    expect(wrapper.find(`#landmark-${field}-error`).exists()).toBe(false);
  });

  it('50コードポイントの名前と0の座標を送信できる', async () => {
    const { wrapper } = await render([]);
    const name = '🏫'.repeat(50);
    await fill(wrapper, name, '0', '0');
    fetchMock.mockResolvedValueOnce(json(building({ name, location: { lat: 0, lng: 0 } }), 201));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ name, location: { lat: 0, lng: 0 } });
  });

  it.each([
    [400, 'invalid_input', '入力を確認してください', 'unknown'],
    [401, 'unauthorized', '運営としてログインしてください', undefined],
    [404, 'not_found', '建物が見つかりません', undefined],
  ])('更新の %i を共通バナーに出し、下書きと保存済みデータを保つ', async (status, code, message, field) => {
    const { wrapper, store } = await render();
    await editFirst(wrapper);
    await fill(wrapper, '修正中の名前');
    fetchMock.mockResolvedValueOnce(json({ code, message, field }, status));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(code);
    expect(wrapper.get('[role="alert"]').text()).toContain(message);
    expect(store.items[0].name).toBe('A棟');
    expect((wrapper.get('#landmark-name').element as HTMLInputElement).value).toBe('修正中の名前');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['name', ['name']], ['location', ['lat', 'lng']],
    ['location.lat', ['lat']], ['location.lng', ['lng']],
  ] as const)('400のfield=%sを項目に結び付け、下書きを保つ', async (field, inputs) => {
    const { wrapper, store } = await render();
    await editFirst(wrapper);
    await fill(wrapper, '修正中の名前');
    fetchMock.mockResolvedValueOnce(json({ code: 'invalid_input', message: '値を確認してください', field }, 400));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('header [role="alert"]').exists()).toBe(false);
    for (const name of inputs) {
      const input = wrapper.get(`#landmark-${name}`);
      expect(input.attributes('aria-invalid')).toBe('true');
      expect(wrapper.get(`#${input.attributes('aria-describedby')}`).text()).toBe('値を確認してください');
    }
    expect(document.activeElement).toBe(wrapper.get(`#landmark-${inputs[0]}`).element);
    expect(store.items[0].name).toBe('A棟');
    expect((wrapper.get('#landmark-name').element as HTMLInputElement).value).toBe('修正中の名前');
    await wrapper.get(`#landmark-${inputs[0]}`).setValue(inputs[0] === 'name' ? 'A棟' : '0');
    expect(wrapper.find('[aria-invalid="true"]').exists()).toBe(false);
    expect(wrapper.find('form [role="alert"]').exists()).toBe(false);
  });

  it('複数の入力エラーを示し、新規登録への切替で消す', async () => {
    const { wrapper } = await render();
    await wrapper.get('form').trigger('submit');
    expect(wrapper.findAll('form [aria-invalid="true"]')).toHaveLength(3);
    expect(document.activeElement).toBe(wrapper.get('#landmark-name').element);
    await editFirst(wrapper);
    expect(wrapper.find('form [role="alert"]').exists()).toBe(false);
    await fill(wrapper, '');
    await wrapper.get('form').trigger('submit');
    await button(wrapper, '新しい建物').trigger('click');
    expect(wrapper.find('form [aria-invalid="true"]').exists()).toBe(false);
    expect(wrapper.find('form [role="alert"]').exists()).toBe(false);
  });

  it('送信中は操作を止め、重複送信しない', async () => {
    const { wrapper } = await render([]);
    await fill(wrapper);
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('main').attributes('aria-busy')).toBe('true');
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '一覧を読み込み直す').attributes('disabled')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    complete(json(building(), 201));
    await flushPromises();
    expect(wrapper.get('main').attributes('aria-busy')).toBe('false');
  });

  it('画面を離れたらリクエストを中断し、遅い応答でストアを上書きしない', async () => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { complete = resolve; });
    const { wrapper, store } = await render([], pending);
    const signal = fetchMock.mock.calls[0][1]!.signal!;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    complete(json({ items: [building()] }));
    await flushPromises();
    expect(store.items).toEqual([]);
  });
});

describe('建物の削除', () => {
  it('見取り図への影響を確認し、やめるにフォーカスする。取消しでは送信しない', async () => {
    const { wrapper } = await render([building({ floors: [floor] })]);
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('階ごとの見取り図も消えます');
    expect(document.activeElement).toBe(button(wrapper, 'やめる').element);
    await button(wrapper, 'やめる').trigger('click');
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(button(wrapper, '建物を削除').element);
    await button(wrapper, '建物を削除').trigger('click');
    await wrapper.get('[role="alertdialog"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('確認後にだけ DELETE し、204 で一覧と編集欄から消す', async () => {
    const { wrapper, store } = await render();
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await button(wrapper, '削除する').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/landmarks/lm-a', expect.objectContaining({ method: 'DELETE', credentials: 'include', body: undefined }));
    expect(store.items).toEqual([]);
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('建物を削除しました。');
    expect((wrapper.get('#landmark-name').element as HTMLInputElement).value).toBe('');
  });

  it('使用中の409では建物と見取り図を消さず、付け替えを案内する', async () => {
    const original = building({ floors: [floor] });
    const { wrapper, store } = await render([original]);
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    fetchMock.mockResolvedValueOnce(json({ code: 'landmark_in_use', message: 'A棟には 2 件の場所が付いています' }, 409));
    await button(wrapper, '削除する').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('landmark_in_use');
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('付け替えてください');
    expect(store.items).toEqual([original]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('建物の形の確認と読み込み直し', () => {
  it('輪郭を北が上の確認用画像にし、出典を表示する', async () => {
    const { wrapper } = await render();
    await editFirst(wrapper);
    const image = wrapper.get('main svg[role="img"]');
    expect(image.attributes('aria-label')).toBe('A棟の建物の形（北が上）');
    expect(image.get('path').attributes('d')).toMatch(/^M .+ L .+ L .+ Z$/);
    const vertices = image.get('path').attributes('d')!.slice(2, -2).split(' L ').map((point) => point.split(' ').map(Number));
    // 北にある2頂点は、南の頂点より図の上に来る。
    expect(vertices[1][1]).toBeLessThan(vertices[0][1]);
    expect(vertices[2][1]).toBe(vertices[1][1]);
    expect(wrapper.text()).toContain('© OpenStreetMap contributors（ODbL）');
    expect(wrapper.text()).toContain('輪郭は編集できません');
    expect(wrapper.findAll('main input').map((input) => input.attributes('name'))).toEqual(['name', 'lat', 'lng']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('輪郭のない建物でも取り直せ、本文なしの専用 POST の結果を反映する', async () => {
    const original = building({ id: '棟/a', footprint: null, floors: [floor] });
    const updated = { ...original, footprint };
    const { wrapper, store } = await render([original]);
    await editFirst(wrapper);
    expect(wrapper.find('main svg').exists()).toBe(false);
    expect(wrapper.text()).toContain('形なし（カメラの正面に出ない）');
    fetchMock.mockResolvedValueOnce(json(updated));
    await button(wrapper, '形を読み込み直す').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/landmarks/${encodeURIComponent(original.id)}/footprint`, expect.objectContaining({
      method: 'POST', credentials: 'include', body: undefined,
    }));
    expect(store.items).toEqual([updated]);
    expect(wrapper.get('tbody').text()).toContain('形あり');
    expect(wrapper.get('tbody').text()).toContain('1階');
    expect(wrapper.find('main svg[role="img"]').exists()).toBe(true);
    expect(wrapper.get('main [role="status"]').text()).toBe('建物の形を読み込み直しました。');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('502 でも元の輪郭と見取り図を保つ（輪郭あり=%s）', async (hasShape) => {
    const original = building({ footprint: hasShape ? footprint : null, floors: [floor] });
    const { wrapper, store } = await render([original]);
    await editFirst(wrapper);
    const previousPath = hasShape ? wrapper.get('main svg path').attributes('d') : undefined;
    fetchMock.mockResolvedValueOnce(json({ code: 'footprint_unavailable', message: 'この位置の建物の輪郭が地図データに見つかりません' }, 502));
    await button(wrapper, '形を読み込み直す').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('footprint_unavailable');
    expect(store.items).toEqual([original]);
    expect(wrapper.find('main svg[role="img"]').exists()).toBe(hasShape);
    if (hasShape) expect(wrapper.get('main svg path').attributes('d')).toBe(previousPath);
    expect(wrapper.find('main [role="status"]').exists()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('通信失敗では保存済みの輪郭と入力を保ち、手動再試行でエラーを消す', async () => {
    const original = building();
    const { wrapper, store } = await render([original]);
    await editFirst(wrapper);
    await fill(wrapper, '保存前の名前', '37.4', '138.7');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await button(wrapper, '形を読み込み直す').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('通信に失敗しました');
    expect(store.items).toEqual([original]);
    fetchMock.mockResolvedValueOnce(json(building({ footprint: [...footprint].reverse() })));
    await button(wrapper, '形を読み込み直す').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect((wrapper.get('#landmark-name').element as HTMLInputElement).value).toBe('保存前の名前');
    expect((wrapper.get('#landmark-lat').element as HTMLInputElement).value).toBe('37.4');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.slice(1).every(([, options]) => options?.body === undefined)).toBe(true);
  });

  it('取り直し中は二重実行と対象の切り替えを防ぐ', async () => {
    const { wrapper } = await render([building(), building({ id: 'lm-b', name: 'B棟' })]);
    await editFirst(wrapper);
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await button(wrapper, '形を読み込み直す').trigger('click');
    await button(wrapper, '形を読み込み直す').trigger('click');
    expect(wrapper.findAll('tbody button').every((item) => item.attributes('disabled') !== undefined)).toBe(true);
    expect(button(wrapper, '建物を削除').attributes('disabled')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    complete(json(building()));
    await flushPromises();
    expect(button(wrapper, '形を読み込み直す').attributes('disabled')).toBeUndefined();
  });
});
