import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { routes } from '../../router';
import { useLandmarksStore } from '../../stores/landmarks';
import type { Landmark, Place } from '../../types';

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
const place = (overrides: Partial<Place> = {}): Place => ({
  id: 'pl-a', name: '企画A', kind: 'event', location: { lat: 37.425, lng: 138.778 },
  description: '', landmarkId: 'lm-a', floor: null, hours: [], labelIds: [], ...overrides,
});
const floor = {
  floor: 1, plan: { viewBox: '0 0 10 10', d: 'M0 0 H10 V10 Z' },
  bounds: { north: 37.426, south: 37.425, east: 138.779, west: 138.778 },
};

beforeAll(async () => {
  // 全件並列実行時も、管理画面の初回変換を最初の操作テストの5秒に含めない。
  await Promise.all([
    import('./AdminLayout.vue'),
    import('./LandmarksAdmin.vue'),
  ]);
}, 30_000);

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

async function render(items: Landmark[] = [building()], initialResponse?: Promise<Response>, places: Place[] = [], placesResponse?: Promise<Response>) {
  fetchMock.mockImplementationOnce(() => initialResponse ?? Promise.resolve(json({ items })));
  fetchMock.mockImplementationOnce(() => placesResponse ?? Promise.resolve(json({ items: places })));
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push('/admin/landmarks');
  await router.isReady();
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [router, pinia] } });
  await flushPromises();
  return { wrapper, store: useLandmarksStore(pinia), router };
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
  it('「編集」を押すと、ボタンが「編集中」に替わってもフォーカスはフォーム先頭の入力へ移る', async () => {
    const { wrapper } = await render([building()]);
    await editFirst(wrapper);
    await flushPromises();
    expect(wrapper.get('tbody tr').text()).toContain('編集中');
    expect(document.activeElement).toBe(wrapper.get('#landmark-name').element);
  });

  it('AdminLayout の中で一覧、輪郭の有無、階の状態を表示する', async () => {
    const { wrapper } = await render([
      building({ floors: [floor] }), building({ id: 'lm-b', name: 'B棟', footprint: null }),
    ]);
    expect(wrapper.get('header h1').text()).toBe('運営の画面');
    expect(wrapper.findAll('tbody tr').map((row) => row.text())).toEqual([
      'A棟0件形あり1階編集', 'B棟0件形なし未登録編集',
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/landmarks', expect.objectContaining({
      method: 'GET', credentials: 'include', signal: expect.any(AbortSignal),
    }));
  });

  it('場所の件数には設備を含め、別の建物・屋外の場所を数えない', async () => {
    const { wrapper } = await render([building(), building({ id: 'lm-b' })], undefined, [
      place(), place({ id: 'wc', kind: 'wc' }),
      place({ id: 'outside', landmarkId: null }), place({ id: 'b', landmarkId: 'lm-b' }),
    ]);
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toContain('場所の件数');
    expect(wrapper.findAll('tbody tr').map((row) => row.get('td').text())).toEqual(['2件', '1件']);
    expect(fetchMock).toHaveBeenCalledWith('/api/places', expect.objectContaining({ method: 'GET', credentials: 'include' }));
  });

  it('件数の取得に失敗しても建物を表示し、未取得と0件を区別する', async () => {
    const placesError = new Response(JSON.stringify({ code: 'internal_error', message: '場所を取得できません' }), {
      status: 500, headers: { 'Content-Type': 'application/problem+json' },
    });
    const { wrapper } = await render([building()], undefined, [], Promise.resolve(placesError));
    expect(wrapper.get('tbody tr td').text()).toBe('未取得');
    expect(wrapper.text()).toContain('場所の件数を取得できませんでした');
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined();
  });

  it('空の一覧には未登録の案内と登録欄を出す', async () => {
    const { wrapper } = await render([]);
    expect(wrapper.text()).toContain('まだ登録されていません');
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined();
    expect(button(wrapper, '登録する').exists()).toBe(true);
  });

  it('読み込み失敗を共通バナーに出し、空の一覧と区別して再取得する', async () => {
    const { wrapper } = await render([], Promise.resolve(json({ code: 'internal_error', message: '取得できません' }, 500)));
    expect(wrapper.get('[role="alert"]').text()).toContain('取得できません');
    expect(wrapper.text()).not.toContain('まだ登録されていません');
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    fetchMock.mockResolvedValueOnce(json({ items: [building()] }));
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    await button(wrapper, '一覧を読み込み直す').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('tbody').text()).toContain('A棟');
    expect(fetchMock).toHaveBeenCalledTimes(4);
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
    expect(wrapper.get('main [role="status"]').text()).toContain('建物を登録しました。輪郭は取得できませんでした。');
    expect(wrapper.get('main [role="status"]').text()).toContain('輪郭なしでも一覧・見取り図・建物の企画に使えます');
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({ name, location: { lat: 0, lng: 0 } });
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    expect(wrapper.get('dialog').attributes('aria-modal')).toBe('true');
    expect((wrapper.get('dialog').element as HTMLDialogElement).open).toBe(true);
    expect(document.activeElement).toBe(button(wrapper, 'やめる').element);
    await button(wrapper, 'やめる').trigger('click');
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(button(wrapper, '建物を削除').element);
    await button(wrapper, '建物を削除').trigger('click');
    await wrapper.get('[role="alertdialog"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('削除確認のTab・Shift+Tabを閉じ込め、ブラウザの取消しで戻る', async () => {
    const { wrapper } = await render();
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    // 並びは「削除する」「やめる」（Figma の DeleteConfirm）。先頭で Shift+Tab すると末尾へ、末尾で Tab すると先頭へ戻る。
    await button(wrapper, '削除する').trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(button(wrapper, 'やめる').element);
    await button(wrapper, 'やめる').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(button(wrapper, '削除する').element);
    await wrapper.get('dialog').trigger('cancel');
    expect(wrapper.find('dialog').exists()).toBe(false);
    expect(document.activeElement).toBe(button(wrapper, '建物を削除').element);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('削除送信中はTab・Esc・cancelで確認から抜けず、二重送信しない', async () => {
    const { wrapper } = await render();
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await button(wrapper, '削除する').trigger('click');
    await button(wrapper, '削除する').trigger('click');
    await wrapper.get('dialog').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(wrapper.get('dialog').element);
    await wrapper.get('dialog').trigger('keydown', { key: 'Escape' });
    await wrapper.get('dialog').trigger('cancel');
    expect(wrapper.find('dialog').exists()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    complete(new Response(null, { status: 204 }));
    await flushPromises();
    expect(wrapper.find('dialog').exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get('#landmark-name').element);
  });

  it('削除が401で失敗したら確認を閉じ、共通エラーを読める状態に戻す', async () => {
    const { wrapper, store } = await render();
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    fetchMock.mockResolvedValueOnce(json({ code: 'unauthorized', message: '認証し直してください' }, 401));
    await button(wrapper, '削除する').trigger('click');
    await flushPromises();
    expect(wrapper.find('dialog').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('unauthorized');
    expect(document.activeElement).toBe(button(wrapper, '建物を削除').element);
    expect(store.items).toEqual([building()]);
  });

  it('確認後にだけ DELETE し、204 で一覧と編集欄から消す', async () => {
    const { wrapper, store } = await render();
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await button(wrapper, '削除する').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/landmarks/lm-a', expect.objectContaining({ method: 'DELETE', credentials: 'include', body: undefined }));
    expect(store.items).toEqual([]);
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('建物を削除しました。');
    expect((wrapper.get('#landmark-name').element as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(wrapper.get('#landmark-name').element);
  });

  it('使用中の409で設備を含む最新の関連場所と管理画面へのリンクを示す', async () => {
    const original = building({ floors: [floor] });
    const associated = [place({ id: '企画/a' }), place({ id: 'wc-a', kind: 'wc', name: 'トイレA' })];
    const { wrapper, store, router } = await render([original]);
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    fetchMock.mockResolvedValueOnce(json({ code: 'landmark_in_use', message: 'A棟には 2 件の場所が付いています' }, 409));
    fetchMock.mockResolvedValueOnce(json({ items: [...associated, place({ id: 'other', name: '別の棟の企画', landmarkId: 'lm-b' })] }));
    await button(wrapper, '削除する').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('landmark_in_use');
    expect(wrapper.get('[role="alert"]').text()).toContain('2 件');
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    const guidance = wrapper.get('[aria-labelledby="delete-conflict-title"]');
    expect(document.activeElement).toBe(wrapper.get('#delete-conflict-title').element);
    expect(guidance.text()).toContain('別の建物へ付け替えてください');
    expect(guidance.findAll('li a').map((link) => link.text())).toEqual(['企画A', 'トイレA']);
    expect(guidance.get('li a').attributes('href')).toBe(router.resolve({ name: 'card', params: { id: '企画/a' } }).href);
    expect(guidance.get('a[href="/admin/places"]').text()).toBe('場所の管理画面を開く');
    expect(wrapper.get('tbody tr td').text()).toBe('2件');
    expect(store.items).toEqual([original]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/places', expect.objectContaining({ method: 'GET', credentials: 'include' }));
    await button(wrapper, '新しい建物').trigger('click');
    expect(wrapper.find('[aria-labelledby="delete-conflict-title"]').exists()).toBe(false);
  });

  it('409後の場所取得中に離れたら中断し、遅い応答を反映しない', async () => {
    const { wrapper } = await render();
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    fetchMock.mockResolvedValueOnce(json({ code: 'landmark_in_use', message: '場所が付いています' }, 409));
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await button(wrapper, '削除する').trigger('click');
    await flushPromises();
    const signal = fetchMock.mock.calls[3][1]!.signal!;
    wrapper.unmount();
    expect(signal.aborted).toBe(true);
    complete(json({ items: [place()] }));
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('409後の場所取得失敗では0件とせず、管理画面への導線を残して再取得できる', async () => {
    const { wrapper, store } = await render();
    await editFirst(wrapper);
    await button(wrapper, '建物を削除').trigger('click');
    fetchMock.mockResolvedValueOnce(json({ code: 'landmark_in_use', message: '場所が付いています' }, 409));
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await button(wrapper, '削除する').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('landmark_in_use');
    expect(wrapper.get('tbody tr td').text()).toBe('未取得');
    expect(wrapper.get('[aria-labelledby="delete-conflict-title"]').text()).toContain('関連する場所を取得できませんでした');
    expect(wrapper.find('a[href="/admin/places"]').exists()).toBe(true);
    expect(store.items).toEqual([building()]);
    fetchMock.mockResolvedValueOnce(json({ items: [building()] }));
    fetchMock.mockResolvedValueOnce(json({ items: [place()] }));
    await button(wrapper, '一覧を読み込み直す').trigger('click');
    await flushPromises();
    expect(wrapper.get('tbody tr td').text()).toBe('1件');
    expect(wrapper.get('[aria-labelledby="delete-conflict-title"] li').text()).toBe('企画A');
  });

});

describe('建物の形の確認と読み込み直し', () => {
  it('輪郭を北が上の確認用画像にし、出典を表示する', async () => {
    const { wrapper } = await render();
    await editFirst(wrapper);
    const image = wrapper.get('.building-shape-preview svg[role="img"]');
    expect(image.attributes('aria-label')).toBe('A棟の建物の形（北が上）');
    expect(image.get('path').attributes('d')).toMatch(/^M .+ L .+ L .+ Z$/);
    const vertices = image.get('path').attributes('d')!.slice(2, -2).split(' L ').map((point) => point.split(' ').map(Number));
    // 北にある2頂点は、南の頂点より図の上に来る。
    expect(vertices[1][1]).toBeLessThan(vertices[0][1]);
    expect(vertices[2][1]).toBe(vertices[1][1]);
    expect(wrapper.text()).toContain('© OpenStreetMap contributors（ODbL）');
    expect(wrapper.text()).toContain('輪郭は編集できません');
    expect(wrapper.findAll('main input').map((input) => input.attributes('name'))).toEqual(['name', 'lat', 'lng']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([[], footprint.slice(0, 1), footprint.slice(0, 2)].map((points) => [points]))('頂点不足の輪郭（%j）を描画せず、形なしとして取り直せる', async (points) => {
    const { wrapper } = await render([building({ footprint: points })]);
    await editFirst(wrapper);
    expect(wrapper.find('.building-shape-preview svg').exists()).toBe(false);
    expect(wrapper.get('tbody').text()).toContain('形なし');
    expect(wrapper.text()).not.toMatch(/Infinity|NaN/);
    expect(wrapper.text()).toContain('輪郭なしでも一覧・見取り図・建物の企画に使えます');
    expect(button(wrapper, '形を読み込み直す').attributes('disabled')).toBeUndefined();
    fetchMock.mockResolvedValueOnce(json(building()));
    await button(wrapper, '形を読み込み直す').trigger('click');
    await flushPromises();
    expect(wrapper.get('tbody').text()).toContain('形あり');
    expect(wrapper.get('.building-shape-preview svg').attributes('viewBox')).not.toMatch(/Infinity|NaN/);
  });

  it('輪郭のない建物でも取り直せ、本文なしの専用 POST の結果を反映する', async () => {
    const original = building({ id: '棟/a', footprint: null, floors: [floor] });
    const updated = { ...original, footprint };
    const { wrapper, store } = await render([original]);
    await editFirst(wrapper);
    expect(wrapper.find('.building-shape-preview svg').exists()).toBe(false);
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
    expect(wrapper.find('.building-shape-preview svg[role="img"]').exists()).toBe(true);
    expect(wrapper.get('main [role="status"]').text()).toBe('建物の形を読み込み直しました。');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([true, false])('502 でも元の輪郭と見取り図を保つ（輪郭あり=%s）', async (hasShape) => {
    const original = building({ footprint: hasShape ? footprint : null, floors: [floor] });
    const { wrapper, store } = await render([original]);
    await editFirst(wrapper);
    const previousPath = hasShape ? wrapper.get('.building-shape-preview svg path').attributes('d') : undefined;
    fetchMock.mockResolvedValueOnce(json({ code: 'footprint_unavailable', message: 'この位置の建物の輪郭が地図データに見つかりません' }, 502));
    await button(wrapper, '形を読み込み直す').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('footprint_unavailable');
    expect(store.items).toEqual([original]);
    expect(wrapper.find('.building-shape-preview svg[role="img"]').exists()).toBe(hasShape);
    if (hasShape) expect(wrapper.get('.building-shape-preview svg path').attributes('d')).toBe(previousPath);
    expect(wrapper.find('main [role="status"]').exists()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.slice(2).every(([, options]) => options?.body === undefined)).toBe(true);
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    complete(json(building()));
    await flushPromises();
    expect(button(wrapper, '形を読み込み直す').attributes('disabled')).toBeUndefined();
  });
});


describe('地図による位置の入力', () => {
  it('地図と緯度経度を双方向に同期し、APIには緯度経度を送る', async () => {
    const { wrapper } = await render();
    const lat = wrapper.get('#landmark-lat');
    const lng = wrapper.get('#landmark-lng');
    await wrapper.get('.location-picker button').trigger('keydown', { key: 'Enter' });
    const latitude = Number((lat.element as HTMLInputElement).value);
    const longitude = Number((lng.element as HTMLInputElement).value);
    expect(latitude).toBeGreaterThan(37);
    expect(longitude).toBeGreaterThan(138);
    expect(wrapper.get('.location-picker p').text()).toContain('横 50.00%、縦 50.00%');
    await wrapper.get('.location-picker button').trigger('keydown', { key: 'ArrowUp' });
    expect(Number((lat.element as HTMLInputElement).value)).toBeGreaterThan(latitude);
    await lat.setValue(String(latitude));
    await lng.setValue(String(longitude));
    expect(wrapper.get('.location-picker p').text()).toContain('横 50.00%、縦 50.00%');
    await wrapper.get('#landmark-name').setValue('地図から登録');
    fetchMock.mockResolvedValueOnce(json(building()));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const request = fetchMock.mock.calls.find(([url, options]) => url === '/api/landmarks' && options?.method === 'POST');
    expect(request).toBeDefined();
    expect(JSON.parse(String(request![1]!.body)).location).toEqual({ lat: latitude, lng: longitude });
    await lat.setValue('');
    expect(wrapper.get('.location-picker p').text()).toContain('まだ置いていません');
  });
});

 it.each(['Enter', ' '])('範囲外の座標は矢印で変更せず、%sで中央に置き直す', async (key) => {
    const { wrapper } = await render();
    const lat = wrapper.get('#landmark-lat');
    const lng = wrapper.get('#landmark-lng');
    await lat.setValue('35');
    await lng.setValue('139');
    const picker = wrapper.get('.location-picker');
    expect(picker.get('p[aria-live="polite"]').text()).toContain('入力した座標は地図の範囲外です');
    expect(picker.text()).not.toContain('まだ置いていません');
    expect(picker.find('[data-icon="flag"]').exists()).toBe(false);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      await picker.get('button').trigger('keydown', { key, shiftKey: true });
    }
    expect((lat.element as HTMLInputElement).value).toBe('35');
    expect((lng.element as HTMLInputElement).value).toBe('139');
    await picker.get('button').trigger('keydown', { key });
    expect(picker.get('p').text()).toContain('横 50.00%、縦 50.00%');
    expect(picker.find('[data-icon="flag"]').exists()).toBe(true);
  });
