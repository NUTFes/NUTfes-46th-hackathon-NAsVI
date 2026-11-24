import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createPinia } from 'pinia';
import { ApiError } from '../../admin/client';
import AdminErrorBanner from '../../admin/AdminErrorBanner.vue';
import { provideAdminFeedback } from '../../admin/feedback';
import { useLandmarksStore } from '../../stores/landmarks';
import type { FloorPlan, Landmark } from '../../types';
import FloorPlansAdmin from './FloorPlansAdmin.vue';

enableAutoUnmount(afterEach);
const fetchMock = vi.fn<typeof fetch>();
const plan: FloorPlan = {
  floor: 1,
  plan: { viewBox: '0 0 400 240', d: 'M10 10 H390 V230 H10 Z' },
  bounds: { north: 37.4248, south: 37.4244, east: 138.7782, west: 138.7776 },
};
const buildings: Landmark[] = [
  { id: 'lm_a', name: 'A 棟', location: { lat: 37.4246, lng: 138.7779 }, footprint: null,
    floors: [plan, { ...plan, floor: -1, plan: { viewBox: '0 0 200 100', d: 'M0 0 H200 V100 Z' } }] },
  { id: 'lm_b', name: 'B 棟', location: { lat: 37.425, lng: 138.778 }, footprint: null, floors: [] },
];
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function problem(status = 400, field = 'plan') {
  return new Response(JSON.stringify({ code: status === 413 ? 'payload_too_large' : 'invalid_input', message: '見取り図を確認してください', field }), {
    status, headers: { 'Content-Type': 'application/problem+json' },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('外部通信は禁止'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(items = buildings) {
  fetchMock.mockResolvedValueOnce(json({ items }));
  return mountScreen();
}

async function mountScreen() {
  let feedback!: ReturnType<typeof provideAdminFeedback>;
  const Host = defineComponent({
    setup() {
      feedback = provideAdminFeedback();
      vi.spyOn(feedback, 'reportError');
      vi.spyOn(feedback, 'clearError');
      return () => h('div', [h(AdminErrorBanner, { error: feedback.error.value }), h(FloorPlansAdmin)]);
    },
  });
  const pinia = createPinia();
  const wrapper = mount(Host, { attachTo: document.body, global: { plugins: [pinia] } });
  await flushPromises();
  return { wrapper, feedback, store: useLandmarksStore(pinia) };
}

type Screen = Awaited<ReturnType<typeof mountScreen>>['wrapper'];
async function choose(wrapper: Screen, id = 'lm_a', floor?: number) {
  await wrapper.get('#floorplan-building').setValue(id);
  if (floor !== undefined) await wrapper.get('#floorplan-floor').setValue(String(floor));
}
async function enterPlan(wrapper: Screen, value = plan) {
  await wrapper.get('#floorplan-viewbox').setValue(value.plan.viewBox);
  await wrapper.get('#floorplan-d').setValue(value.plan.d);
  for (const key of ['north', 'south', 'east', 'west'] as const) {
    await wrapper.get(`#floorplan-${key}`).setValue(String(value.bounds[key]));
  }
}
function deleteButton(wrapper: Screen) { return wrapper.get('button.delete'); }
function reloadButton(wrapper: Screen) { return wrapper.get('main > button'); }
async function confirmDelete(wrapper: Screen) {
  await deleteButton(wrapper).trigger('click');
  await wrapper.findAll('[role="alertdialog"] button').find((item) => item.text() === '削除する')!.trigger('click');
}

describe('見取り図の登録・管理', () => {
  it('建物一覧を取得して store に保持し、建物・階ごとの既存値を読み込む', async () => {
    const { wrapper, store } = await render();
    expect(fetchMock).toHaveBeenCalledWith('/api/landmarks', expect.objectContaining({ method: 'GET', credentials: 'include' }));
    expect(store.items).toEqual(buildings);
    expect(wrapper.get('#floorplan-building').findAll('option').map((option) => option.text()))
      .toEqual(['建物を選んでください', 'A 棟', 'B 棟']);
    expect(wrapper.find('form').exists()).toBe(false);
    await choose(wrapper);
    expect((wrapper.get('#floorplan-viewbox').element as HTMLInputElement).value).toBe(plan.plan.viewBox);
    expect((wrapper.get('#floorplan-d').element as HTMLTextAreaElement).value).toBe(plan.plan.d);
    for (const key of ['north', 'south', 'east', 'west'] as const) {
      expect((wrapper.get(`#floorplan-${key}`).element as HTMLInputElement).value).toBe(String(plan.bounds[key]));
    }
    expect(wrapper.get('svg').attributes('viewBox')).toBe(plan.plan.viewBox);
    await choose(wrapper, 'lm_a', -1);
    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 200 100');
    expect(wrapper.get('path').attributes('d')).toBe('M0 0 H200 V100 Z');
    await wrapper.get('#floorplan-floor').setValue('2');
    expect((wrapper.get('#floorplan-d').element as HTMLTextAreaElement).value).toBe('');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(deleteButton(wrapper).attributes('disabled')).toBeDefined();
    await choose(wrapper, 'lm_b');
    expect((wrapper.get('#floorplan-floor').element as HTMLInputElement).value).toBe('1');
    expect(wrapper.text()).toContain('未登録');
  });

  it('未登録の階への入力から SVG の属性でプレビューを更新する', async () => {
    const { wrapper } = await render();
    await choose(wrapper, 'lm_b');
    await enterPlan(wrapper);
    expect(wrapper.get('svg[role="img"]').attributes('viewBox')).toBe(plan.plan.viewBox);
    expect(wrapper.get('svg path').attributes('d')).toBe(plan.plan.d);
    await wrapper.get('#floorplan-viewbox').setValue('-10, -20, 3e2, 150');
    await wrapper.get('#floorplan-d').setValue('M0 0 L100 100');
    expect(wrapper.get('svg').attributes('viewBox')).toBe('-10, -20, 3e2, 150');
    expect(wrapper.get('path').attributes('d')).toBe('M0 0 L100 100');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('入力のマークアップを HTML として展開しない', async () => {
    const { wrapper } = await render();
    await choose(wrapper);
    const malicious = 'M0 0 "></path><script>alert(1)</script><path onload="alert(1)';
    await wrapper.get('#floorplan-d').setValue(malicious);
    expect(wrapper.get('path').attributes('d')).toBe(malicious);
    expect(wrapper.findAll('svg path')).toHaveLength(1);
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('[onload]').exists()).toBe(false);
    await wrapper.get('#floorplan-viewbox').setValue('0 0 400 240" onload="alert(1)');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.text()).toContain('viewBox は4つの数値');
  });

  it.each([
    ['viewbox', '', 'viewBox は4つの数値'],
    ['viewbox', '0 0 400', 'viewBox は4つの数値'],
    ['viewbox', '0 0 400 240 10', 'viewBox は4つの数値'],
    ['viewbox', '0 0 Infinity 240', 'viewBox は4つの数値'],
    ['viewbox', '0 0 1e999 240', 'viewBox は4つの数値'],
    ['viewbox', '0 0 0x10 240', 'viewBox は4つの数値'],
    ['viewbox', '0,,0 400 240', 'viewBox は4つの数値'],
    ['viewbox', '0 0 0 240', '幅と高さは正の数'],
    ['viewbox', '0 0 400 -1', '幅と高さは正の数'],
    ['d', '  \n ', 'path の d を入力'],
    ['north', '', 'すべて数値'],
    ['south', 'abc', 'すべて数値'],
    ['east', 'Infinity', 'すべて数値'],
    ['west', '1e999', 'すべて数値'],
    ['north', '37.4244', 'north > south'],
    ['south', '38', 'north > south'],
    ['east', '138.7776', 'east > west'],
    ['west', '139', 'east > west'],
    ['north', '90.001', '-90〜90'],
    ['north', '-90.001', '-90〜90'],
    ['south', '90.001', '-90〜90'],
    ['south', '-90.001', '-90〜90'],
    ['east', '180.001', '-180〜180'],
    ['east', '-180.001', '-180〜180'],
    ['west', '180.001', '-180〜180'],
    ['west', '-180.001', '-180〜180'],
    ['floor', '', '階は -5〜20 の整数'],
    ['floor', '-6', '階は -5〜20 の整数'],
    ['floor', '21', '階は -5〜20 の整数'],
    ['floor', '1.5', '階は -5〜20 の整数'],
  ])('%s が %j のときは理由を示し、プレビューと PUT を止める', async (field, value, reason) => {
    const { wrapper } = await render();
    await choose(wrapper);
    await wrapper.get(`#floorplan-${field}`).setValue(value);
    expect(wrapper.get('#floorplan-validation').text()).toContain(reason);
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('緯度経度の境界と d の 200000 文字を受け付け、200001 文字は送らない', async () => {
    const { wrapper } = await render();
    await choose(wrapper);
    const boundaryPlan = { ...plan, plan: { ...plan.plan, d: 'M' + '0'.repeat(199999) },
      bounds: { north: 90, south: -90, east: 180, west: -180 } };
    await enterPlan(wrapper, boundaryPlan);
    expect(wrapper.get('#floorplan-validation').text()).toBe('');
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    fetchMock.mockResolvedValueOnce(json(boundaryPlan));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ plan: boundaryPlan.plan, bounds: boundaryPlan.bounds });
    await wrapper.get('#floorplan-d').setValue(boundaryPlan.plan.d + '0');
    expect(wrapper.get('#floorplan-validation').text()).toContain('200000 文字以下');
    expect(wrapper.get('#floorplan-d').attributes('aria-invalid')).toBe('true');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('JSON 本文がちょうど 1 MB なら送り、1 バイトでも超えれば止める', async () => {
    const { wrapper } = await render();
    await choose(wrapper);
    const originalBytes = new TextEncoder().encode(JSON.stringify({ plan: plan.plan, bounds: plan.bounds })).byteLength;
    const viewBox = '0' + ' '.repeat(1024 * 1024 - originalBytes + 1) + '0 400 240';
    await wrapper.get('#floorplan-viewbox').setValue(viewBox);
    expect(wrapper.get('#floorplan-validation').text()).toBe('');
    fetchMock.mockResolvedValueOnce(json({ ...plan, plan: { ...plan.plan, viewBox } }));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(new TextEncoder().encode(String(fetchMock.mock.calls[1][1]?.body)).byteLength).toBe(1024 * 1024);
    await wrapper.get('#floorplan-viewbox').setValue(viewBox.replace('0 400', '0  400'));
    expect(wrapper.get('#floorplan-validation').text()).toContain('見取り図は 1 MB 以下');
    expect(wrapper.get('#floorplan-payload-error').text()).toContain('見取り図は 1 MB 以下');
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('svg').exists()).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['viewbox', '0' + '\u3000'.repeat(350000) + '0 400 240'],
    ['d', '\u0001'.repeat(190000)],
  ])('%s の UTF-8 または JSON のエスケープによるサイズ超過も送らない', async (field, value) => {
    const { wrapper } = await render();
    await choose(wrapper);
    await wrapper.get(`#floorplan-${field}`).setValue(value);
    expect(wrapper.get('#floorplan-validation').text()).toBe('見取り図は 1 MB 以下にしてください。');
    await wrapper.get('form').trigger('submit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['plan', ['viewbox', 'd']],
    ['plan.viewBox', ['viewbox']],
    ['plan.d', ['d']],
    ['bounds', ['north', 'south', 'east', 'west']],
    ['bounds.north', ['north']],
    ['bounds.south', ['south']],
    ['bounds.east', ['east']],
    ['bounds.west', ['west']],
    ['floor', ['floor']],
    ['body', ['viewbox', 'd', 'north', 'south', 'east', 'west']],
  ])('400 の field=%s を対応する入力と項目横のエラーに結ぶ', async (field, invalidFields) => {
    const { wrapper, feedback } = await render();
    await choose(wrapper);
    fetchMock.mockResolvedValueOnce(problem(400, field));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(feedback.reportError).toHaveBeenCalledWith(expect.objectContaining({ status: 400, field }));
    expect(wrapper.get('[role="alert"]').text()).toContain('見取り図を確認してください');
    for (const key of ['floor', 'viewbox', 'd', 'north', 'south', 'east', 'west']) {
      const input = wrapper.get(`#floorplan-${key}`);
      expect(input.attributes('aria-invalid')).toBe(String(invalidFields.includes(key)));
      const descriptions = input.attributes('aria-describedby')!.split(' ').map((id) => wrapper.get(`#${id}`));
      expect(descriptions.some((description) => description.text().includes('見取り図を確認してください'))).toBe(invalidFields.includes(key));
      if (invalidFields.includes(key)) expect(input.element.parentElement?.textContent).toContain('見取り図を確認してください');
    }
    // 修正後に前のサーバーエラーを項目に残さない。
    await wrapper.get('#floorplan-d').setValue('M1 1 L20 20');
    expect(wrapper.findAll('form [aria-invalid="true"]')).toHaveLength(0);
  });

  it('413 は共通バナーに加えてフォーム付近に容量の案内を表示する', async () => {
    const { wrapper, feedback } = await render();
    await choose(wrapper);
    fetchMock.mockResolvedValueOnce(problem(413));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(feedback.reportError).toHaveBeenCalledWith(expect.objectContaining({ status: 413, code: 'payload_too_large' }));
    expect(wrapper.get('[role="alert"]').text()).toContain('payload_too_large');
    expect(wrapper.get('form #floorplan-payload-error').text()).toBe('見取り図は 1 MB 以下にしてください。');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await choose(wrapper, 'lm_b');
    expect(wrapper.find('#floorplan-payload-error').exists()).toBe(false);
  });

  it.each([-5, 0, 20])('%i 階の登録を契約どおりの PUT 本文で送り、応答を store に反映する', async (floor) => {
    const { wrapper, store, feedback } = await render();
    await choose(wrapper, 'lm_b', floor);
    await enterPlan(wrapper);
    // 入力値ではなく API が返した値を保存後の表示と store に使う。
    const saved = { ...plan, floor, plan: { viewBox: '0 0 500 300', d: 'M1 1 L20 20' } };
    fetchMock.mockResolvedValueOnce(json(saved));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toBe(`/api/landmarks/lm_b/floors/${floor}/plan`);
    expect(options).toMatchObject({ method: 'PUT', credentials: 'include' });
    expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(options?.body))).toEqual({ plan: plan.plan, bounds: plan.bounds });
    expect(store.items[1].floors).toEqual([saved]);
    expect(store.items[0]).toEqual(buildings[0]);
    expect(wrapper.get('svg').attributes('viewBox')).toBe(saved.plan.viewBox);
    expect(wrapper.get('[role="status"]').text()).toContain('保存しました');
    expect(feedback.error.value).toBeNull();
    expect(feedback.clearError).toHaveBeenCalledTimes(4);
  });

  it('登録済みの階を差し替え、他の階の見取り図を保つ', async () => {
    const { wrapper, store } = await render();
    await choose(wrapper);
    const saved = { ...plan, plan: { ...plan.plan, d: 'M0 0 L50 50' } };
    await wrapper.get('#floorplan-d').setValue(saved.plan.d);
    expect(wrapper.get('button[type="submit"]').text()).toBe('差し替えて保存');
    fetchMock.mockResolvedValueOnce(json(saved));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(store.items[0].floors).toEqual([buildings[0].floors[1], saved]);
    await wrapper.get('#floorplan-floor').setValue('-1');
    await wrapper.get('#floorplan-floor').setValue('1');
    expect(wrapper.get('path').attributes('d')).toBe(saved.plan.d);
  });

  it('編集中の値が不正でも登録済みの階を DELETE し、フォームと store を更新する', async () => {
    const { wrapper, store, feedback } = await render();
    await choose(wrapper);
    await wrapper.get('#floorplan-d').setValue('');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await confirmDelete(wrapper);
    await flushPromises();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/landmarks/lm_a/floors/1/plan');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE', credentials: 'include', body: undefined });
    expect(store.items[0].floors).toEqual([buildings[0].floors[1]]);
    expect(store.items[1]).toEqual(buildings[1]);
    expect(wrapper.find('svg').exists()).toBe(false);
    expect((wrapper.get('#floorplan-viewbox').element as HTMLInputElement).value).toBe('');
    expect(deleteButton(wrapper).attributes('disabled')).toBeDefined();
    expect(wrapper.get('[role="status"]').text()).toContain('削除しました');
    expect(feedback.clearError).toHaveBeenCalledTimes(4);
    await wrapper.get('#floorplan-floor').setValue('-1');
    await wrapper.get('#floorplan-floor').setValue('1');
    expect(wrapper.text()).toContain('未登録');
  });

  it('削除前に対象と影響を確認し、やめる操作では送信せず入力を保つ', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const { wrapper, store } = await render();
    await choose(wrapper);
    await wrapper.get('#floorplan-d').setValue('M1 1 L20 20');
    await deleteButton(wrapper).trigger('click');
    const panel = wrapper.get('[role="alertdialog"]');
    expect(panel.get(`#${panel.attributes('aria-labelledby')}`).text()).toContain('A 棟 の 1 階の見取り図');
    expect(panel.get(`#${panel.attributes('aria-describedby')}`).text()).toContain('来場者の画面から消えます');
    const cancel = panel.findAll('button').find((button) => button.text() === 'やめる')!;
    expect(document.activeElement).toBe(cancel.element);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await wrapper.get('form').trigger('submit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await cancel.trigger('click');
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(deleteButton(wrapper).element);
    expect(store.items).toEqual(buildings);
    expect(wrapper.get('path').attributes('d')).toBe('M1 1 L20 20');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('登録済みの階を表で表示し、編集ボタンから選択する', async () => {
    const { wrapper } = await render();
    await choose(wrapper);
    expect(wrapper.get('table caption').text()).toContain('A 棟');
    expect(wrapper.get('tbody tr[aria-current="true"]').text()).toContain('1 階');
    await wrapper.get('button[aria-label="-1 階を編集"]').trigger('click');
    expect(wrapper.get('tbody tr[aria-current="true"]').text()).toContain('-1 階');
    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 200 100');
    await choose(wrapper, 'lm_b');
    expect(wrapper.get('table').text()).toContain('まだ登録されていません');
  });

  it('建物が0件なら登録先の案内を表示する', async () => {
    const { wrapper } = await render([]);
    expect(wrapper.text()).toContain('建物がありません');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('一覧取得の失敗を reportError へ渡し、再試行前と成功時に clearError を呼ぶ', async () => {
    const error = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValueOnce(error);
    const { wrapper, feedback, store } = await mountScreen();
    expect(feedback.reportError).toHaveBeenCalledWith(error);
    expect(wrapper.get('[role="alert"]').text()).toContain('通信に失敗');
    expect(wrapper.text()).toContain('建物一覧を読み込めませんでした');
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await reloadButton(wrapper).trigger('click');
    expect(feedback.error.value).toBeNull();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(reloadButton(wrapper).attributes('disabled')).toBeDefined();
    finish(json({ items: buildings }));
    await flushPromises();
    expect(store.items).toEqual(buildings);
    expect(feedback.clearError).toHaveBeenCalledTimes(3);
  });

  it.each(['PUT', 'DELETE'] as const)('%s の失敗を報告し、既存データと入力を保持して手動で再試行する', async (method) => {
    const { wrapper, feedback, store } = await render();
    await choose(wrapper);
    await wrapper.get('#floorplan-d').setValue('M0 0 L100 100');
    fetchMock.mockResolvedValueOnce(problem());
    const act = () => method === 'PUT' ? wrapper.get('form').trigger('submit') : confirmDelete(wrapper);
    await act();
    await flushPromises();
    expect(feedback.reportError).toHaveBeenCalledWith(expect.any(ApiError));
    expect(feedback.error.value).toMatchObject({ status: 400, code: 'invalid_input', field: 'plan' });
    expect(wrapper.get('[role="alert"]').text()).toContain('見取り図を確認してください');
    expect(store.items).toEqual(buildings);
    expect(wrapper.get('path').attributes('d')).toBe('M0 0 L100 100');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await act();
    expect(feedback.error.value).toBeNull();
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
    expect(wrapper.get('#floorplan-building').attributes('disabled')).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    finish(method === 'PUT' ? json(plan) : new Response(null, { status: 204 }));
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain(method === 'PUT' ? '保存しました' : '削除しました');
    expect(feedback.clearError).toHaveBeenCalledTimes(5);
  });

  it('401 を共通フィードバックへ渡し、自動再送しない', async () => {
    const { wrapper, feedback } = await render();
    await choose(wrapper);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'unauthorized', message: '権限が必要です' }), {
      status: 401, headers: { 'Content-Type': 'application/problem+json' },
    }));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(feedback.reportError).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: 'unauthorized' }));
    expect(wrapper.get('[role="alert"]').text()).toContain('運営の権限が必要');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('画面を離れたときはリクエストを中断し、失敗として報告しない', async () => {
    let reject!: (reason: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const { wrapper, feedback } = await mountScreen();
    const signal = fetchMock.mock.calls[0][1]?.signal;
    wrapper.unmount();
    expect(signal?.aborted).toBe(true);
    reject(new DOMException('Aborted', 'AbortError'));
    await flushPromises();
    expect(feedback.reportError).not.toHaveBeenCalled();
  });
});
