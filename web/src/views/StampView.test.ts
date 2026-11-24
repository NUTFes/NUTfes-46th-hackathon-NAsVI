import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { IDBFactory } from 'fake-indexeddb';
import { CLOSING_TIME, configureConfig } from '../../../api/src/config';
import { appColors } from '../app/tokens';
import { createStorage, getStorage, type StorageRepositories } from '../storage';
import { useStampsStore } from '../stores/stamps';
import type { Position, Stamp, StampKind } from '../types';
import StampView from './StampView.vue';

vi.mock('../services/position', () => ({ usePosition: () => location }));
vi.mock('../storage', async importOriginal => ({
  ...await importOriginal<typeof import('../storage')>(),
  getStorage: vi.fn(),
}));

const NOW = Date.parse('2026-11-24T03:00:00Z');
const location = {
  position: ref<Position | null>(null),
  status: ref('granted'),
  allow: vi.fn(),
};
const kinds = [
  ['congestion-1', '混雑1 空いている'], ['congestion-2', '混雑2'],
  ['congestion-3', '混雑3'], ['congestion-4', '混雑4'],
  ['congestion-5', '混雑5 とても混んでいる'],
  ['fun', '面白い'], ['food', '美味しい'], ['good', 'よさ'],
] as const;
let repo: StorageRepositories;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let pinia: ReturnType<typeof createPinia>;
let router: ReturnType<typeof createRouter>;
const wrappers: VueWrapper[] = [];
const themeElements: HTMLElement[] = [];

function stamp(id = 's-04-mine', kind: StampKind = 'congestion-3', expiresAt = NOW + 30 * 60_000): Stamp {
  return {
    id, kind, at: { lat: 37.4252, lng: 138.7788 },
    pressedAt: new Date(NOW).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
  };
}

function json(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function problem(code: string, message: string, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ code, message }), {
    status, headers: { 'Content-Type': 'application/problem+json', ...headers },
  });
}

async function render(attachTo?: HTMLElement, attrs?: Record<string, string>) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/stamp', '/noloc'].map(path => ({ path, component: { template: '<div />' } })),
  });
  await router.push('/stamp');
  const wrapper = mount(StampView, { attachTo, attrs, global: { plugins: [pinia, router] } });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

async function pick(wrapper: VueWrapper, label = '混雑3') {
  await wrapper.get(`button[aria-label="${label}"]`).trigger('click');
  await flushPromises();
}

async function own(value: Stamp, proof = `proof-${value.id}`) {
  useStampsStore().upsert(value);
  await repo.proofs.save({ stampId: value.id, proof, expiresAt: value.expiresAt });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
  pinia = createPinia();
  setActivePinia(pinia);
  repo = await createStorage({ memory: true });
  vi.mocked(getStorage).mockResolvedValue(repo);
  location.position.value = { lat: 37.4252, lng: 138.7788, accuracy: 8, takenAt: NOW - 10_000 };
  location.status.value = 'granted';
  location.allow.mockReset();
  fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('S-04: unmocked request'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  themeElements.splice(0).forEach(element => element.remove());
  await repo.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('StampView', () => {
  it.each(['dark', 'light'] as const)('%s は I-0 の --app-* を解決し、混雑ボタンにも適用する', async theme => {
    const host = document.createElement('div');
    host.setAttribute('data-theme', theme);
    document.body.append(host);
    themeElements.push(host);
    const wrapper = await render(host);
    const style = (wrapper.get('main').element as HTMLElement).style;
    expect(style.getPropertyValue('--app-bg-page')).toBe(appColors(theme)['--app-bg-page']);
    expect(style.getPropertyValue('--app-feeling')).toBe(appColors(theme)['--app-feeling']);
    expect(style.getPropertyValue('--app-congestion-3')).toBe('#f97316');
    expect(wrapper.get('button[aria-label="混雑3"]').attributes('style'))
      .toContain('var(--app-congestion-3)');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('シートの見出しを h1 にし、閉じるで地図へ戻る。位置は緯度・経度を出さず、公開を説明する', async () => {
    const wrapper = await render();
    expect(wrapper.findAll('h1').map(h => h.text())).toEqual(['混雑を足元に押す']);
    expect(wrapper.text()).toContain('いまいる場所の混み具合を、みんなに知らせます。');
    expect(wrapper.text()).not.toMatch(/緯度|経度|37\.4252/);
    expect(wrapper.findAll('[role="status"]').filter(el => el.element.querySelector('[role="status"]'))).toEqual([]);
    expect(wrapper.find('[aria-label]:not(button):not(section):not(svg)').exists()).toBe(false);
    await wrapper.get('button[aria-label="閉じる"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('8種類を表示し、押す地点・精度・取得からの経過時間と公開を説明する', async () => {
    const wrapper = await render();
    expect(wrapper.findAll('.choices button')).toHaveLength(8);
    for (const [, label] of kinds) expect(wrapper.get(`button[aria-label="${label}"]`).attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('精度 ±8 m・10 秒前に取得');
    expect(wrapper.text()).toContain('この地点が公開されます');
    expect(location.allow).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(kinds)('%s は1回で送信し、proof を端末だけに保存する', async (kind, label) => {
    const value = stamp('s-04-pressed', kind);
    fetchMock.mockResolvedValueOnce(json({ ...value, proof: 's-04-secret' }));
    const wrapper = await render();
    await pick(wrapper, label);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/stamps');
    expect(init?.method).toBe('POST');
    // 精度・取得時刻・方位や、API に無い項目を送らない。
    expect(JSON.parse(init!.body as string)).toEqual({ kind, at: { lat: 37.4252, lng: 138.7788 } });
    expect(await repo.proofs.get(value.id)).toEqual({
      stampId: value.id, proof: 's-04-secret', expiresAt: value.expiresAt,
    });
    expect(useStampsStore().items).toEqual([value]);
    expect(await repo.cache.get('stamps')).toBeUndefined();
    expect(wrapper.findAll('.my-stamp')).toHaveLength(1);
    expect(wrapper.get('.toast').text()).toContain('足元に押しました');
    expect(wrapper.html()).not.toContain('s-04-secret');
  });

  it('Toast は Figma の文言で floating、混雑の両端の文言は DS 仕様のまま、感想の札は Icon 付き', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...stamp(), proof: 'p' }));
    fetchMock.mockResolvedValueOnce(json({ ...stamp('s-04-fun', 'fun'), proof: 'p2' }));
    const wrapper = await render();
    expect(wrapper.get('.scale').text()).toBe('空いているとても混んでいる');
    await pick(wrapper);
    expect(wrapper.get('.toast').text()).toBe('混雑3 を足元に押しました取り消す');
    expect(wrapper.get('.toast').classes()).toContain('nv-toast--floating');
    await pick(wrapper, '面白い');
    expect(wrapper.get('.toast').text()).toContain('面白いを足元に押しました');
    expect(wrapper.findAll('.my-stamp .badge svg')).toHaveLength(1);
  });

  it.each(['idle', 'asking', 'denied', 'unavailable', 'timeout'])('位置がない (%s) ときは送信を止め、許可と位置設定へ案内する', async status => {
    location.position.value = null;
    location.status.value = status;
    const wrapper = await render();
    for (const button of wrapper.findAll('.choices button')) {
      expect(button.attributes('disabled')).toBeDefined();
      await button.trigger('click');
    }
    expect(wrapper.get('a[href="/noloc"]').text()).toContain('地図で指定');
    const allow = wrapper.findAll('button').find(button => button.text() === '位置の利用を許可する')!;
    await allow.trigger('click');
    expect(location.allow).toHaveBeenCalledTimes(status === 'asking' ? 0 : 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('位置と精度の変更を表示し、送信時の最新の地点を使う', async () => {
    const wrapper = await render();
    location.position.value = { lat: 37.4253, lng: 138.7789, accuracy: 12.1, takenAt: NOW };
    await flushPromises();
    expect(wrapper.text()).toContain('精度 ±13 m');
    fetchMock.mockResolvedValueOnce(json({ ...stamp(), proof: 'proof' }));
    await pick(wrapper);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).at).toEqual({ lat: 37.4253, lng: 138.7789 });
  });

  it('手動位置など精度が不明なとき、誤って精度0として表示しない', async () => {
    location.position.value!.accuracy = Infinity;
    const wrapper = await render();
    expect(wrapper.text()).toContain('精度は不明です');
    expect(wrapper.text()).not.toContain('Infinity');
    expect(wrapper.get('button[aria-label="混雑3"]').attributes('disabled')).toBeUndefined();
  });

  it('無効な地点は送信しない', async () => {
    location.position.value!.lat = NaN;
    const wrapper = await render();
    await pick(wrapper);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('通信中は連打・別の種類・取り消しの重複送信を防ぐ', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(response => { resolve = response; }));
    await own(stamp('s-04-existing'));
    const wrapper = await render();
    await pick(wrapper);
    for (const button of wrapper.findAll('.choices button, .my-stamp button')) {
      expect(button.attributes('disabled')).toBeDefined();
      await button.trigger('click');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(json({ ...stamp(), proof: 'proof' }));
    await flushPromises();
    expect(wrapper.get('button[aria-label="混雑3"]').attributes('disabled')).toBeUndefined();
  });

  it('自分の有効なスタンプを新しい順で3件表示し、残りも展開できる', async () => {
    for (let i = 0; i < 5; i++) {
      await own({ ...stamp(`s-04-${i}`, kinds[i][0]), pressedAt: new Date(NOW - i * 60_000).toISOString() });
    }
    useStampsStore().upsert(stamp('s-04-other', 'food'));
    await own(stamp('s-04-expired', 'fun', NOW));
    await own(stamp('s-04-feeling', 'good', NOW + 4 * 60 * 60_000));
    const wrapper = await render();
    expect(wrapper.findAll('.my-stamp .badge').map(row => row.text())).toEqual(['混雑1', 'よさ', '混雑2']);
    expect(wrapper.text()).toContain('あと 30 分で消えます');
    expect(wrapper.text()).toContain('あと 240 分で消えます');
    expect(wrapper.text()).not.toContain('面白いを取り消す');
    const more = wrapper.findAll('button').find(button => button.text() === 'ほか 3 件を見る')!;
    await more.trigger('click');
    expect(wrapper.findAll('.my-stamp')).toHaveLength(6);
    expect(wrapper.findAll('.my-stamp .badge').map(row => row.text())).not.toContain('美味しい');
    expect(await repo.proofs.get('s-04-expired')).toBeUndefined();
  });

  it('感想の期限は既存の閉場設定を案内し、押した後の残り時間はサーバーの expiresAt を使う', async () => {
    const original = CLOSING_TIME;
    try {
      configureConfig({ CLOSING_TIME: '17:45' });
      fetchMock.mockResolvedValueOnce(json({ ...stamp('s-04-closing', 'fun', NOW + 90 * 60_000), proof: 's-04-proof' }));
      const wrapper = await render();
      expect(wrapper.get('section[aria-labelledby="stamp-feeling-title"]').text())
        .toContain('その日の閉場（17:45）まで有効です');
      await pick(wrapper, '面白い');
      expect(wrapper.get('.my-stamp').text()).toContain('あと 90 分で消えます');
      expect(wrapper.get('.my-stamp').text()).not.toContain('17:45');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(wrapper.get('.my-stamp').text()).toContain('あと 89 分で消えます');
    } finally {
      configureConfig({ CLOSING_TIME: original });
    }
  });

  it('残り時間を更新し、expiresAt と同時刻に通知と一覧から消す', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...stamp('s-04-short', 'fun', NOW + 3000), proof: 'proof' }));
    const wrapper = await render();
    await pick(wrapper, '面白い');
    expect(wrapper.get('.my-stamp').text()).toContain('あと 3 秒で消えます');
    await vi.advanceTimersByTimeAsync(2000);
    expect(wrapper.get('.my-stamp').text()).toContain('あと 1 秒で消えます');
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.find('.my-stamp').exists()).toBe(false);
    expect(wrapper.find('.toast').exists()).toBe(false);
    expect(wrapper.find('#my-stamps-title').exists()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('通知は6秒で消え、一覧からは引き続き取り消せる', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...stamp(), proof: 'proof' }));
    const wrapper = await render();
    await pick(wrapper);
    await vi.advanceTimersByTimeAsync(6000);
    expect(wrapper.find('.toast').exists()).toBe(false);
    expect(wrapper.find('.my-stamp button').exists()).toBe(true);
  });

  it.each(['通知', '一覧'])('%s から、proof ヘッダーだけで取り消し、保存とストアから除く', async entry => {
    fetchMock.mockResolvedValueOnce(json({ ...stamp(), proof: 's-04-secret' }));
    const wrapper = await render();
    await pick(wrapper);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await wrapper.get(entry === '通知' ? '.toast button' : '.my-stamp button').trigger('click');
    await flushPromises();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/stamps/s-04-mine');
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('X-Stamp-Proof')).toBe('s-04-secret');
    expect(init?.body).toBeUndefined();
    expect(useStampsStore().items).toEqual([]);
    expect(await repo.proofs.list()).toEqual([]);
    expect(wrapper.find('.toast').exists()).toBe(false);
    expect(wrapper.find('.my-stamp').exists()).toBe(false);
  });

  it('IndexedDB に保存した proof を再表示時に読み込み、取り消せる', async () => {
    vi.useRealTimers();
    vi.stubGlobal('indexedDB', new IDBFactory());
    await repo.close();
    repo = await createStorage();
    vi.mocked(getStorage).mockResolvedValue(repo);
    expect(repo.mode).toBe('indexeddb');
    const value = stamp('s-04-reopen', 'food', Date.now() + 30 * 60_000);
    fetchMock.mockResolvedValueOnce(json({ ...value, proof: 's-04-persistent-proof' }));
    const first = await render();
    await vi.waitFor(() => expect(first.get('button[aria-label="美味しい"]').attributes('disabled')).toBeUndefined());
    await pick(first, '美味しい');
    await vi.waitFor(() => expect(first.find('.toast').exists()).toBe(true));
    first.unmount();
    wrappers.splice(wrappers.indexOf(first), 1);
    await repo.close();
    repo = await createStorage();
    vi.mocked(getStorage).mockResolvedValue(repo);
    const second = await render();
    await vi.waitFor(() => expect(second.find('.my-stamp').exists()).toBe(true));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await second.get('.my-stamp button').trigger('click');
    await vi.waitFor(() => expect(second.find('.my-stamp').exists()).toBe(false));
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('X-Stamp-Proof')).toBe('s-04-persistent-proof');
    expect(await repo.proofs.get(value.id)).toBeUndefined();
  });

  it('400 out_of_venue はサーバーの message に頼らず、会場外では押せないことを案内する', async () => {
    fetchMock.mockResolvedValueOnce(problem('out_of_venue', 'S-04: server detail', 400));
    const wrapper = await render();
    await pick(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toBe('会場の外にいるため、スタンプを押せません。会場内で現在地を確認してからお試しください。');
    expect(wrapper.text()).not.toContain('S-04: server detail');
    expect(wrapper.find('.toast').exists()).toBe(false);
    expect(await repo.proofs.list()).toEqual([]);
    expect(useStampsStore().items).toEqual([]);
    expect(wrapper.get('button[aria-label="混雑3"]').attributes('disabled')).toBeUndefined();
  });

  describe.each(['押す', '取り消す'])('429 (%s)', operation => {
    it.each([
      ['45', 'あと 45 秒ほどおいてからやり直してください。'],
      [' 12 ', 'あと 12 秒ほどおいてからやり直してください。'],
      ['0', 'あと 0 秒ほどおいてからやり直してください。'],
      [new Date(NOW + 45_000).toUTCString(), 'あと 45 秒ほどおいてからやり直してください。'],
      [new Date(NOW - 1000).toUTCString(), 'あと 0 秒ほどおいてからやり直してください。'],
      ...[undefined, '', '-1', 'invalid', '1.5', 'Infinity', '1e3', '9007199254740992', 'invalid GMT'].map(value =>
        [value, '短い間に送りすぎました。しばらく待ってからやり直してください。']),
    ])('Retry-After=%s に応じた待ち時間を案内する', async (value, message) => {
      if (operation === '取り消す') await own(stamp(), 's-04-keep');
      fetchMock.mockResolvedValueOnce(problem('too_many_requests', 'S-04: server detail', 429,
        value === undefined ? {} : { 'Retry-After': value }));
      const wrapper = await render();
      if (operation === '押す') await pick(wrapper);
      else {
        await wrapper.get('.my-stamp button').trigger('click');
        await flushPromises();
      }
      expect(wrapper.get('[role="alert"]').text()).toBe(message);
      expect(wrapper.find('.toast').exists()).toBe(false);
      expect(await repo.proofs.list()).toHaveLength(operation === '押す' ? 0 : 1);
      expect(useStampsStore().items).toHaveLength(operation === '押す' ? 0 : 1);
      if (operation === '取り消す') {
        expect(wrapper.findAll('.my-stamp')).toHaveLength(1);
        expect((await repo.proofs.get('s-04-mine'))?.proof).toBe('s-04-keep');
      }
      expect(wrapper.get('button[aria-label="混雑3"]').attributes('disabled')).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('通信エラー時は成功扱いせず再試行の案内を出す', async () => {
    const wrapper = await render();
    await pick(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('送信を確認できませんでした');
    expect(wrapper.find('.toast').exists()).toBe(false);
    expect(await repo.proofs.list()).toEqual([]);
  });

  it('取り消しが 403 not_stamp_owner のときは期限切れ・別端末の案内を出し、proof と一覧を残す', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...stamp(), proof: 's-04-keep' }));
    const wrapper = await render();
    await pick(wrapper);
    fetchMock.mockResolvedValueOnce(problem('not_stamp_owner', 'S-04: server detail', 403));
    await wrapper.get('.toast button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('期限切れか、別の端末で押したスタンプの可能性があります');
    expect(wrapper.findAll('.my-stamp')).toHaveLength(1);
    expect(wrapper.find('.toast').exists()).toBe(true);
    expect((await repo.proofs.get('s-04-mine'))?.proof).toBe('s-04-keep');
    expect(useStampsStore().items).toEqual([stamp()]);
    expect(wrapper.get('.my-stamp button').attributes('disabled')).toBeUndefined();
  });

  it('取り消しが 500 のときは proof と一覧を残す', async () => {
    await own(stamp(), 's-04-keep');
    fetchMock.mockResolvedValueOnce(problem('internal_error', '取り消せませんでした', 500));
    const wrapper = await render();
    await wrapper.get('.my-stamp button').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('取り消せませんでした');
    expect(wrapper.findAll('.my-stamp')).toHaveLength(1);
    expect((await repo.proofs.get('s-04-mine'))?.proof).toBe('s-04-keep');
    expect(useStampsStore().items).toHaveLength(1);
  });

  it('既に消えたスタンプ (404) は端末からも除く', async () => {
    await own(stamp());
    fetchMock.mockResolvedValueOnce(problem('not_found', 'スタンプがありません', 404));
    const wrapper = await render();
    await wrapper.get('.my-stamp button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.my-stamp').exists()).toBe(false);
    expect(await repo.proofs.list()).toEqual([]);
  });

  it('保存がメモリのみの場合、再読み込み後に取り消せなくなることを伝える', async () => {
    const wrapper = await render();
    expect(wrapper.get('.warning').text()).toContain('画面を再読み込みすると、取り消せなくなります');
  });

  it('proof の読み込み中は押せず、失敗したら端末の読み込みをやり直せる', async () => {
    let reject!: (cause: Error) => void;
    vi.mocked(getStorage).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const wrapper = await render();
    expect(wrapper.get('button[aria-label="混雑3"]').attributes('disabled')).toBeDefined();
    reject(new Error('storage failed'));
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('端末の保存を読み込めませんでした');
    await wrapper.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('button[aria-label="混雑3"]').attributes('disabled')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('送信後に proof の保存に失敗しても、その画面では取り消せる', async () => {
    vi.spyOn(repo.proofs, 'save').mockRejectedValueOnce(new Error('disk failed'));
    fetchMock.mockResolvedValueOnce(json({ ...stamp(), proof: 's-04-unsaved' }));
    const wrapper = await render();
    await pick(wrapper);
    expect(wrapper.get('.warning').text()).toContain('取り消しの証を端末に保存できませんでした');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await wrapper.get('.toast button').trigger('click');
    await flushPromises();
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('X-Stamp-Proof')).toBe('s-04-unsaved');
    expect(wrapper.find('.my-stamp').exists()).toBe(false);
  });

  it('画面を閉じると時刻・通知のタイマーを解除する', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...stamp(), proof: 'proof' }));
    const wrapper = await render();
    await pick(wrapper);
    expect(vi.getTimerCount()).toBe(2);
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
