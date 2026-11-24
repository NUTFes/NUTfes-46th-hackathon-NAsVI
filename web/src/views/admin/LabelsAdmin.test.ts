import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { useLabelsStore, usePlacesStore } from '../../stores';
import type { Label, Place } from '../../types';
import AdminLayout from './AdminLayout.vue';
import LabelsAdmin from './LabelsAdmin.vue';

enableAutoUnmount(afterEach);
const fetchMock = vi.fn<typeof fetch>();
const initialLabels: Label[] = [
  { id: 'lb_food', title: '飲食' },
  { id: 'lb_stage', title: 'ステージ' },
];
const initialPlaces: Place[] = [{
  id: 'pl_01', name: '焼きそば屋台', kind: 'event',
  location: { lat: 37.4252, lng: 138.7788 }, description: '模擬店',
  landmarkId: null, floor: null, hours: [], labelIds: ['lb_food'],
}];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function problem(status: number, code: string, message: string, field?: string) {
  return new Response(JSON.stringify({ code, message, ...(field ? { field } : {}) }), {
    status, headers: { 'Content-Type': 'application/problem+json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  fetchMock.mockReset();
  // 既知の一覧以外は必ず各テストで応答を指定する。実 fetch は一切呼ばない。
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === 'GET' && url === '/api/labels') return json({ items: initialLabels });
    if (init?.method === 'GET' && url === '/api/places') return json({ items: initialPlaces, cursor: '1' });
    throw new Error(`未設定の fetch: ${init?.method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: '/admin', component: AdminLayout,
      children: [{ path: 'labels', component: LabelsAdmin }],
    }],
  });
  await router.push('/admin/labels');
  await router.isReady();
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [pinia, router] } });
  return { wrapper, labels: useLabelsStore(pinia), places: usePlacesStore(pinia) };
}

function lastRequest(method: string, url: string, body?: unknown) {
  const [actualUrl, init] = fetchMock.mock.calls.at(-1)!;
  expect(actualUrl).toBe(url);
  expect(init).toMatchObject({ method, credentials: 'include' });
  expect(init?.body).toBe(body === undefined ? undefined : JSON.stringify(body));
}

describe('種類の管理', () => {
  it('認証付きで一覧を読み、共有ストアと場所に付いている種類を表示する', async () => {
    const { wrapper, labels, places } = await render();
    await flushPromises();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/labels', '/api/places']);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    }
    expect(labels.items).toEqual(initialLabels);
    expect(places.items).toEqual(initialPlaces);
    expect(wrapper.get('main h2').text()).toBe('種類の定義・管理(運営)');
    expect(wrapper.get('legend').text()).toBe('焼きそば屋台');
    expect(wrapper.get<HTMLInputElement>('[aria-label="焼きそば屋台の飲食"]').element.checked).toBe(true);
    expect(wrapper.get<HTMLInputElement>('[aria-label="焼きそば屋台のステージ"]').element.checked).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('両方の一覧がそろうまで編集できず、読み込み状態を表示する', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const { wrapper } = await render();
    await flushPromises();
    expect(wrapper.get('main').attributes('aria-busy')).toBe('true');
    expect(wrapper.text()).toContain('一覧を読み込んでいます');
    expect(wrapper.get('#label-title').attributes('disabled')).toBeDefined();
    expect(wrapper.find('fieldset').exists()).toBe(false);
    pending.resolve(json({ items: initialLabels }));
    await flushPromises();
    expect(wrapper.get('main').attributes('aria-busy')).toBe('false');
    expect(wrapper.get('#label-title').attributes('disabled')).toBeUndefined();
  });

  it('空の一覧を未登録として表示する', async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] })).mockResolvedValueOnce(json({ items: [], cursor: '0' }));
    const { wrapper } = await render();
    await flushPromises();
    expect(wrapper.text()).toContain('種類はまだ登録されていません');
    expect(wrapper.text()).toContain('場所はまだ登録されていません');
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
  });

  it('場所だけあるときは種類の作成を案内する', async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [] }));
    const { wrapper } = await render();
    await flushPromises();
    expect(wrapper.text()).toContain('種類を作成すると、場所に付けられます');
  });

  it('作成したサーバーの種類を一覧と付け外し欄に追加する', async () => {
    const { wrapper, labels } = await render();
    await flushPromises();
    const created: Label = { id: 'lb_new', title: '展示' };
    fetchMock.mockResolvedValueOnce(json(created, 201));
    await wrapper.get('#label-title').setValue('展示');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    lastRequest('POST', '/api/labels', { title: '展示' });
    expect(labels.items).toEqual([...initialLabels, created]);
    expect(wrapper.get<HTMLInputElement>('#label-title').element.value).toBe('');
    expect(wrapper.get('[aria-label="展示を削除"]').text()).toBe('削除');
    expect(wrapper.get<HTMLInputElement>('[aria-label="焼きそば屋台の展示"]').element.checked).toBe(false);
    expect(wrapper.text()).toContain('種類を作成しました');
  });

  it.each(['', ' \t\n　', 'あ'.repeat(21), ` ${'😀'.repeat(21)} `])('trim後の長さ制約に合わない名前は送らない: %s', async (title) => {
    const { wrapper } = await render();
    await flushPromises();
    await wrapper.get('#label-title').setValue(title);
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['あ', 'あ'.repeat(20), '😀'.repeat(20)])('前後の空白を除いた1〜20 code pointの名前だけを送る: %s', async (title) => {
    const { wrapper } = await render();
    await flushPromises();
    fetchMock.mockResolvedValueOnce(json({ id: 'lb_new', title }, 201));
    await wrapper.get('#label-title').setValue(`　 ${title} \t`);
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('#label-title').attributes('aria-invalid')).toBe('false');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    lastRequest('POST', '/api/labels', { title });
  });

  it('同名の409では入力と一覧を残し、明示的な再試行でエラーを消す', async () => {
    const { wrapper, labels } = await render();
    await flushPromises();
    fetchMock.mockResolvedValueOnce(problem(409, 'label_title_taken', '種類「飲食」は既にあります'));
    await wrapper.get('#label-title').setValue('飲食');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('種類「飲食」は既にあります');
    expect(wrapper.get('#label-title-error').text()).toBe('その名前は使われています');
    expect(wrapper.get('#label-title').attributes('aria-describedby')).toBe('label-title-help label-title-error');
    expect(wrapper.get('#label-title').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get<HTMLInputElement>('#label-title').element.value).toBe('飲食');
    expect(labels.items).toEqual(initialLabels);
    expect(wrapper.text()).not.toContain('すべての場所から外してから');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValueOnce(json({ id: 'lb_new', title: '展示' }, 201));
    await wrapper.get('#label-title').setValue('展示');
    expect(wrapper.find('#label-title-error').exists()).toBe(false);
    expect(wrapper.get('#label-title').attributes('aria-describedby')).toBe('label-title-help');
    expect(wrapper.get('#label-title').attributes('aria-invalid')).toBe('false');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(['button', 'Escape'])('削除対象と影響を確認し、キャンセル（%s）ではAPIを呼ばずフォーカスを戻す', async (cancel) => {
    const { wrapper, labels } = await render();
    await flushPromises();
    const trigger = wrapper.get<HTMLButtonElement>('[aria-label="ステージを削除"]');
    await trigger.trigger('click');
    const dialog = wrapper.get('[role="alertdialog"]');
    expect(dialog.attributes('aria-labelledby')).toBe('delete-title');
    expect(dialog.attributes('aria-describedby')).toBe('delete-effects');
    expect(dialog.get('#delete-title').text()).toContain('「ステージ」を削除');
    expect(dialog.get('#delete-effects').text()).toContain('場所に付けられなくなります');
    expect(dialog.text()).toContain('この操作は取り消せません');
    expect(dialog.text()).toContain('使用中のため削除できません');
    expect(dialog.text()).toContain('先にすべての場所から外してください');
    expect(dialog.text()).toContain('場所そのものは削除されません');
    expect(document.activeElement).toBe(dialog.findAll('button')[1].element);
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    window.dispatchEvent(new Event('focus'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (cancel === 'button') await dialog.findAll('button')[1].trigger('click');
    else await dialog.trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    expect(labels.items).toEqual(initialLabels);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('確認後だけ未使用の種類を削除し、付け外し欄からも除く', async () => {
    const { wrapper, labels } = await render();
    await flushPromises();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await wrapper.get('[aria-label="ステージを削除"]').trigger('click');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await wrapper.get('[role="alertdialog"] button:first-child').trigger('click');
    await flushPromises();
    lastRequest('DELETE', '/api/labels/lb_stage');
    expect(labels.items).toEqual([initialLabels[0]]);
    expect(wrapper.find('[aria-label="焼きそば屋台のステージ"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('種類を削除しました');
    expect(document.activeElement).toBe(wrapper.get('main > button').element);
  });

  it('使用中の409は種類を残して外し方を案内し、外したあとに削除できる', async () => {
    const { wrapper, labels, places } = await render();
    await flushPromises();
    fetchMock.mockResolvedValueOnce(problem(409, 'label_in_use', '種類 lb_food は 1 件の場所に付いています'));
    await wrapper.get('[aria-label="飲食を削除"]').trigger('click');
    await wrapper.get('[role="alertdialog"] button:first-child').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('label_in_use');
    expect(wrapper.text()).toContain('付いているすべての場所から外してから削除');
    expect(labels.items).toEqual(initialLabels);
    expect(places.items).toEqual(initialPlaces);
    expect(fetchMock.mock.calls.slice(2).map(([url, init]) => [init?.method, url])).toEqual([
      ['DELETE', '/api/labels/lb_food'], ['GET', '/api/labels'], ['GET', '/api/places'],
    ]);
    expect(wrapper.get('a[href="#label-place-pl_01"]').text()).toBe('焼きそば屋台の付け外しへ');
    expect(wrapper.get('#label-place-pl_01').get('legend').text()).toBe('焼きそば屋台');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await wrapper.get('[aria-label="焼きそば屋台の飲食"]').setValue(false);
    await flushPromises();
    lastRequest('DELETE', '/api/places/pl_01/labels/lb_food');
    expect(places.items[0].labelIds).toEqual([]);
    expect(labels.items).toEqual(initialLabels);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('すべての場所から外してから');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await wrapper.get('[aria-label="飲食を削除"]').trigger('click');
    await wrapper.get('[role="alertdialog"] button:first-child').trigger('click');
    await flushPromises();
    lastRequest('DELETE', '/api/labels/lb_food');
    expect(labels.items).toEqual([initialLabels[1]]);
  });

  it('種類をPUTで付け、DELETEで外し、ほかの場所・種類は保つ', async () => {
    const secondPlace = { ...initialPlaces[0], id: 'pl_02', name: '展示室' };
    fetchMock.mockResolvedValueOnce(json({ items: initialLabels }))
      .mockResolvedValueOnce(json({ items: [...initialPlaces, secondPlace], cursor: '1' }));
    const { wrapper, places, labels } = await render();
    await flushPromises();
    const checkbox = wrapper.get<HTMLInputElement>('[aria-label="焼きそば屋台のステージ"]');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await checkbox.setValue(true);
    await flushPromises();
    lastRequest('PUT', '/api/places/pl_01/labels/lb_stage');
    expect(checkbox.element.checked).toBe(true);
    expect(places.items[0]).toEqual({ ...initialPlaces[0], labelIds: ['lb_food', 'lb_stage'] });
    expect(places.items[1]).toEqual(secondPlace);
    expect(wrapper.text()).toContain('場所に種類を付けました');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await checkbox.setValue(false);
    await flushPromises();
    lastRequest('DELETE', '/api/places/pl_01/labels/lb_stage');
    expect(checkbox.element.checked).toBe(false);
    expect(places.items).toEqual([...initialPlaces, secondPlace]);
    expect(labels.items).toEqual(initialLabels);
    expect(wrapper.text()).toContain('場所から種類を外しました');
  });

  it.each([
    { assigned: true, code: 'label_not_found' },
    { assigned: false, code: 'label_not_found' },
    { assigned: true, code: 'not_found' },
    { assigned: false, code: 'not_found' },
  ])('付け外しの404 $code（元の状態=$assigned）はバナーを残し、両一覧を再取得する', async ({ assigned, code }) => {
    const { wrapper, places } = await render();
    await flushPromises();
    const reloadedLabels = code === 'label_not_found' ? initialLabels.filter((label) => label.id !== (assigned ? 'lb_food' : 'lb_stage')) : initialLabels;
    const reloadedPlaces = code === 'not_found' ? [] : [{ ...initialPlaces[0], labelIds: [] }];
    fetchMock.mockResolvedValueOnce(problem(404, code, '場所か種類が登録されていません'))
      .mockResolvedValueOnce(json({ items: reloadedLabels }))
      .mockResolvedValueOnce(json({ items: reloadedPlaces, cursor: '2' }));
    const checkbox = wrapper.get<HTMLInputElement>(assigned
      ? '[aria-label="焼きそば屋台の飲食"]' : '[aria-label="焼きそば屋台のステージ"]');
    await checkbox.setValue(!assigned);
    expect(checkbox.element.checked).toBe(assigned);
    expect(places.items).toEqual(initialPlaces);
    await flushPromises();
    expect(places.items).toEqual(reloadedPlaces);
    expect(wrapper.find(assigned ? '[aria-label="焼きそば屋台の飲食"]' : '[aria-label="焼きそば屋台のステージ"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain(code);
    expect(fetchMock.mock.calls.slice(2).map(([url, init]) => [init?.method, url])).toEqual([
      [assigned ? 'DELETE' : 'PUT', `/api/places/pl_01/labels/${assigned ? 'lb_food' : 'lb_stage'}`],
      ['GET', '/api/labels'], ['GET', '/api/places'],
    ]);
  });

  it.each(['not_found', 'label_not_found'])('削除の404 %sもバナーを残し、両一覧を再取得する', async (code) => {
    const { wrapper, labels, places } = await render();
    await flushPromises();
    const updatedPlaces = [{ ...initialPlaces[0], name: '更新された屋台' }];
    fetchMock.mockResolvedValueOnce(problem(404, code, '削除対象は見つかりません'))
      .mockResolvedValueOnce(json({ items: [initialLabels[0]] }))
      .mockResolvedValueOnce(json({ items: updatedPlaces, cursor: '2' }));
    await wrapper.get('[aria-label="ステージを削除"]').trigger('click');
    await wrapper.get('[role="alertdialog"] button:first-child').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(code);
    expect(labels.items).toEqual([initialLabels[0]]);
    expect(places.items).toEqual(updatedPlaces);
    expect(fetchMock.mock.calls.slice(2).map(([url, init]) => [init?.method, url])).toEqual([
      ['DELETE', '/api/labels/lb_stage'], ['GET', '/api/labels'], ['GET', '/api/places'],
    ]);
  });

  it('404のバナーを再取得中と取得失敗後も残し、手動の再取得で復帰する', async () => {
    const { wrapper, labels, places } = await render();
    await flushPromises();
    const pending = deferred<Response>();
    fetchMock.mockResolvedValueOnce(problem(404, 'not_found', '場所は削除されています'))
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(problem(500, 'internal_error', '取得失敗'));
    await wrapper.get('[aria-label="焼きそば屋台のステージ"]').setValue(true);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('場所は削除されています');
    expect(wrapper.get('main').attributes('aria-busy')).toBe('true');
    pending.resolve(json({ items: [] }));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('場所は削除されています');
    expect(wrapper.text()).toContain('一覧を読み込めませんでした');
    expect(wrapper.get('#label-title').attributes('disabled')).toBeDefined();
    expect(labels.items).toEqual(initialLabels);
    expect(places.items).toEqual(initialPlaces);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await wrapper.get('main > button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('legend').text()).toBe('焼きそば屋台');
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it.each(['focus', 'visibilitychange'])('画面への復帰（%s）で他の運営の変更を取り直し、入力を残す', async (event) => {
    const { wrapper, labels, places } = await render();
    await flushPromises();
    await wrapper.get('#label-title').setValue('入力途中');
    const updatedLabels = [...initialLabels, { id: 'lb_new', title: '展示' }];
    const updatedPlaces = [{ ...initialPlaces[0], labelIds: ['lb_new'] }];
    fetchMock.mockResolvedValueOnce(json({ items: updatedLabels }))
      .mockResolvedValueOnce(json({ items: updatedPlaces, cursor: '2' }));
    if (event === 'focus') window.dispatchEvent(new Event(event));
    else document.dispatchEvent(new Event(event));
    await flushPromises();
    expect(labels.items).toEqual(updatedLabels);
    expect(places.items).toEqual(updatedPlaces);
    expect(wrapper.get<HTMLInputElement>('[aria-label="焼きそば屋台の展示"]').element.checked).toBe(true);
    expect(wrapper.get<HTMLInputElement>('#label-title').element.value).toBe('入力途中');
    expect(fetchMock.mock.calls.slice(2).map(([url, init]) => [init?.method, url])).toEqual([
      ['GET', '/api/labels'], ['GET', '/api/places'],
    ]);
    wrapper.unmount();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('保存中の復帰では保存を再送せず、完了後に一覧を取り直す', async () => {
    const { wrapper, places } = await render();
    await flushPromises();
    const pending = deferred<Response>();
    const updatedPlaces = [{ ...initialPlaces[0], name: '他の運営が更新', labelIds: ['lb_food', 'lb_stage'] }];
    fetchMock.mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(json({ items: initialLabels }))
      .mockResolvedValueOnce(json({ items: updatedPlaces, cursor: '2' }));
    await wrapper.get('[aria-label="焼きそば屋台のステージ"]').setValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    pending.resolve(new Response(null, { status: 204 }));
    await flushPromises();
    expect(places.items).toEqual(updatedPlaces);
    expect(fetchMock.mock.calls.slice(2).map(([url, init]) => [init?.method, url])).toEqual([
      ['PUT', '/api/places/pl_01/labels/lb_stage'], ['GET', '/api/labels'], ['GET', '/api/places'],
    ]);
  });

  it('保存中は再送を防ぎ、成功するまで表示・ストアを変えない', async () => {
    const { wrapper, places } = await render();
    await flushPromises();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const checkbox = wrapper.get<HTMLInputElement>('[aria-label="焼きそば屋台のステージ"]');
    await checkbox.setValue(true);
    expect(checkbox.element.checked).toBe(false);
    expect(places.items).toEqual(initialPlaces);
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[aria-label="飲食を削除"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('main').attributes('aria-busy')).toBe('true');
    await checkbox.trigger('change');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 保存中に別経路から更新された項目を、応答待ち前のオブジェクトで上書きしない。
    places.upsert({ ...places.items[0], name: '屋台（更新済み）' });
    pending.resolve(new Response(null, { status: 204 }));
    await flushPromises();
    expect(places.items[0].name).toBe('屋台（更新済み）');
    expect(places.items[0].labelIds).toEqual(['lb_food', 'lb_stage']);
    expect(checkbox.element.checked).toBe(true);
    expect(wrapper.get('main').attributes('aria-busy')).toBe('false');
  });

  it.each([
    [400, 'invalid_input', '名前を確認してください', 'title'],
    [401, 'unauthorized', '認証を確認してください', undefined],
    [500, 'internal_error', '作成できませんでした', undefined],
  ] as const)('作成の%sは共通バナーに渡し、入力を保つ', async (status, code, message, field) => {
    const { wrapper, labels } = await render();
    await flushPromises();
    fetchMock.mockResolvedValueOnce(problem(status, code, message, field));
    await wrapper.get('#label-title').setValue('展示');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const banner = wrapper.get('[role="alert"]');
    expect(banner.text()).toContain(message);
    expect(banner.text()).toContain(code);
    if (field) expect(banner.text()).toContain(field);
    if (status === 401) expect(banner.text()).toContain('Cloudflare Access');
    expect(wrapper.get<HTMLInputElement>('#label-title').element.value).toBe('展示');
    expect(labels.items).toEqual(initialLabels);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['labels', 'places'])('%sの取得失敗を空一覧とせず、一覧の再試行で回復する', async (failed) => {
    fetchMock.mockResolvedValueOnce(failed === 'labels'
      ? problem(500, 'internal_error', '一覧を取得できませんでした') : json({ items: initialLabels }))
      .mockResolvedValueOnce(failed === 'places'
        ? problem(500, 'internal_error', '一覧を取得できませんでした') : json({ items: initialPlaces, cursor: '1' }));
    const { wrapper } = await render();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('一覧を取得できませんでした');
    expect(wrapper.text()).toContain('一覧を読み込めませんでした');
    expect(wrapper.text()).not.toContain('まだ登録されていません');
    expect(wrapper.get('#label-title').attributes('disabled')).toBeDefined();
    await wrapper.get('main > button').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('legend').text()).toBe('焼きそば屋台');
  });

  it('通信失敗でも削除対象を残し、自動再送しない', async () => {
    const { wrapper, labels } = await render();
    await flushPromises();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await wrapper.get('[aria-label="ステージを削除"]').trigger('click');
    await wrapper.get('[role="alertdialog"] button:first-child').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('通信に失敗しました');
    expect(labels.items).toEqual(initialLabels);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('画面を離れると読み込みを中断し、遅い応答を共有ストアへ反映しない', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const { wrapper, labels, places } = await render();
    const signal = fetchMock.mock.calls[0][1]?.signal;
    wrapper.unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve(json({ items: initialLabels }));
    await flushPromises();
    expect(labels.items).toEqual([]);
    expect(places.items).toEqual([]);
  });

  it('画面を離れた後の更新応答も反映しない', async () => {
    const { wrapper, labels } = await render();
    await flushPromises();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await wrapper.get('#label-title').setValue('展示');
    await wrapper.get('form').trigger('submit');
    wrapper.unmount();
    pending.resolve(json({ id: 'lb_new', title: '展示' }, 201));
    await flushPromises();
    expect(labels.items).toEqual(initialLabels);
  });
});
