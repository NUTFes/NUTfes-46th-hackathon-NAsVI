// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { IDBDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import tokensJson from '../../../design-system/tokens.json?raw';
import * as localStorage from '../storage';
import { usePlacesStore } from '../stores/places';
import type { Place } from '../types';
import TagsView from './TagsView.vue';

const first: Place = {
  id: 'place-1', name: 'たこ焼き', kind: 'event', location: { lat: 37.4252, lng: 138.7788 },
  description: '', landmarkId: null, floor: null, hours: [], labelIds: [],
};
const second: Place = { ...first, id: 'place-2', name: 'クレープ' };
let storage: localStorage.StorageRepositories;
let instances: localStorage.StorageRepositories[];
let wrappers: VueWrapper[];
const fetchMock = vi.fn(() => { throw new Error('External communication is forbidden'); });
const colorTokens = {
  '--page': 'bg-page', '--surface': 'bg-surface', '--text': 'text-primary',
  '--secondary': 'text-secondary', '--primary': 'action-primary', '--on-primary': 'action-on-primary',
  '--border': 'border-subtle', '--pressed': 'state-pressed', '--danger': 'danger',
  '--danger-bg': 'danger-bg', '--danger-text': 'danger-text',
};
function expectTheme(wrapper: VueWrapper, theme: 'light' | 'dark') {
  const tokens: unknown = JSON.parse(tokensJson);
  function resolve(path: string): string {
    const node = path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], tokens);
    const value = (node as { $value: string | { components: number[]; alpha?: number } }).$value;
    if (typeof value === 'string') return resolve(value.slice(1, -1));
    return `rgb(${value.components.map(component => component * 255).join(' ')} / ${value.alpha ?? 1})`;
  }
  const style = wrapper.get<HTMLElement>('.tags-page').element.style;
  for (const [property, name] of Object.entries(colorTokens)) {
    expect(style.getPropertyValue(property), property).toBe(resolve(`color.${theme}.${name}`));
  }
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  wrappers = [];
  instances = [];
  storage = await localStorage.getStorage();
  instances.push(storage);
});
afterEach(async () => {
  wrappers.forEach(wrapper => wrapper.unmount());
  vi.restoreAllMocks();
  await Promise.all(instances.map(instance => instance.close()));
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  expect(fetchMock).not.toHaveBeenCalled();
});

async function render(id = first.id, items = [first, second], attachTo = document.body) {
  const pinia = createPinia();
  const places = usePlacesStore(pinia);
  places.setAll(items);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'map', component: { template: '<main>地図</main>' } },
      { path: '/places/:id', name: 'card', component: { template: '<main>場所</main>' } },
      { path: '/places/:id/tags', name: 'tags', component: TagsView },
    ],
  });
  await router.push({ name: 'tags', params: { id } });
  const wrapper = mount(TagsView, { attachTo, global: { plugins: [pinia, router] } });
  wrappers.push(wrapper);
  await vi.waitFor(() => expect(wrapper.find('[role="status"]').exists()).toBe(false));
  return { wrapper, router, places };
}
function row(wrapper: VueWrapper, title: string) {
  return wrapper.get(`[role="checkbox"][aria-label="${title}"]`);
}
async function submit(wrapper: VueWrapper, title: string) {
  await wrapper.get('input').setValue(title);
  await wrapper.get('form').trigger('submit');
}
async function idle(wrapper: VueWrapper) {
  await vi.waitFor(() => expect(wrapper.get('input').attributes('disabled')).toBeUndefined());
}
async function pressEnter(wrapper: VueWrapper, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
  // happy-dom は Enter による暗黙の submit を行わないため、既定動作だけ補う。
  if (wrapper.get('input').element.dispatchEvent(event)) await wrapper.get('form').trigger('submit');
  return event;
}

describe('TagsView', () => {
  it.each(['light', 'dark', undefined, 'unknown'])('data-theme=%s の色をトークンから解決する', async theme => {
    const host = document.createElement('div');
    if (theme !== undefined) host.dataset.theme = theme;
    document.body.append(host);
    const { wrapper } = await render(first.id, [first, second], host);
    expectTheme(wrapper, theme === 'light' ? 'light' : 'dark');
  });

  it('最寄りの data-theme を優先し、属性の追加・切替・削除に追従する', async () => {
    const outer = document.createElement('div');
    outer.dataset.theme = 'light';
    const inner = document.createElement('div');
    outer.append(inner);
    document.body.append(outer);
    const { wrapper } = await render(first.id, [first, second], inner);
    expectTheme(wrapper, 'light');
    inner.dataset.theme = 'dark';
    await flushPromises();
    expectTheme(wrapper, 'dark');
    inner.dataset.theme = 'light';
    await flushPromises();
    expectTheme(wrapper, 'light');
    inner.dataset.theme = 'unknown';
    await flushPromises();
    expectTheme(wrapper, 'dark');
    inner.removeAttribute('data-theme');
    await flushPromises();
    expectTheme(wrapper, 'light');
    outer.dataset.theme = 'dark';
    await flushPromises();
    expectTheme(wrapper, 'dark');
    wrapper.get<HTMLElement>('.tags-page').element.dataset.theme = 'light';
    await flushPromises();
    expectTheme(wrapper, 'light');
  });

  it('ストアの場所名と、最初からある2タグを規定順で表示する', async () => {
    const { wrapper, places } = await render();
    expect(wrapper.get('h1').text()).toBe('タグを付ける・作る');
    expect(wrapper.get('#tags-place').text()).toBe(first.name);
    expect(wrapper.findAll('[role="checkbox"]').map(item => item.attributes('aria-label')))
      .toEqual(localStorage.BUILTIN_TAGS.map(tag => tag.title));
    for (const tag of localStorage.BUILTIN_TAGS) {
      expect(row(wrapper, tag.title).text()).toContain('最初からあるタグ');
      expect(row(wrapper, tag.title).attributes('aria-checked')).toBe('false');
    }
    expect(wrapper.text()).not.toMatch(/名前を変更|タグを削除/);
    expect((wrapper.element as HTMLElement).style.getPropertyValue('--row-height')).toBe('54px');
    places.upsert({ ...first, name: 'たこ焼き屋台' });
    await flushPromises();
    expect(wrapper.get('#tags-place').text()).toBe('たこ焼き屋台');
  });

  it.each(localStorage.BUILTIN_TAGS)('$title をこの場所だけに付け外しし、再表示でも保存値を使う', async tag => {
    await storage.tagLinks.save({ placeId: second.id, tagId: tag.id });
    const { wrapper } = await render();
    await row(wrapper, tag.title).trigger('click');
    await idle(wrapper);
    expect(row(wrapper, tag.title).attributes('aria-checked')).toBe('true');
    expect(row(wrapper, tag.title).get('.check-mark').text()).toBe('✓');
    expect(await storage.tagLinks.list(first.id)).toEqual([{ placeId: first.id, tagId: tag.id }]);
    const { wrapper: reopened } = await render();
    expect(row(reopened, tag.title).attributes('aria-checked')).toBe('true');
    await row(reopened, tag.title).trigger('click');
    await idle(reopened);
    expect(row(reopened, tag.title).attributes('aria-checked')).toBe('false');
    expect(await storage.tagLinks.list(first.id)).toEqual([]);
    expect(await storage.tagLinks.list(second.id)).toEqual([{ placeId: second.id, tagId: tag.id }]);
    expect(await storage.tags.get(tag.id)).toEqual(tag);
  });

  it('自作タグは前後の空白を除いて作り、開いている場所にそのまま付ける', async () => {
    const { wrapper } = await render();
    await submit(wrapper, '  お昼に行く　');
    await idle(wrapper);
    const custom = (await storage.tags.list()).find(tag => !tag.builtin)!;
    expect(custom).toMatchObject({ title: 'お昼に行く', builtin: false });
    expect(custom.id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
    expect(await storage.tagLinks.list(first.id)).toEqual([{ placeId: first.id, tagId: custom.id }]);
    expect(await storage.tagLinks.list(second.id)).toEqual([]);
    expect(row(wrapper, custom.title).attributes('aria-checked')).toBe('true');
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('');
    await row(wrapper, custom.title).trigger('click');
    await idle(wrapper);
    expect(await storage.tagLinks.list(first.id)).toEqual([]);
  });

  it.each(['isComposing', 'composition', 'keyCode229'])('%s による変換中の Enter は作らず、確定後の Enter で作る', async method => {
    const { wrapper } = await render();
    const input = wrapper.get('input');
    await input.setValue('変換したタグ');
    if (method === 'composition') await input.trigger('compositionstart');
    const event = await pressEnter(wrapper, {
      isComposing: method === 'isComposing', keyCode: method === 'keyCode229' ? 229 : 13,
    });
    expect(event.defaultPrevented).toBe(true);
    if (method === 'composition') await wrapper.get('form').trigger('submit');
    expect(await storage.tags.list()).toHaveLength(2);
    expect(await storage.tagLinks.list()).toEqual([]);
    expect((input.element as HTMLInputElement).value).toBe('変換したタグ');

    if (method === 'composition') await input.trigger('compositionend');
    await input.trigger('keyup', { key: 'Enter' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((await pressEnter(wrapper)).defaultPrevented).toBe(false);
    await idle(wrapper);
    expect(await storage.tags.list()).toHaveLength(3);
    expect(row(wrapper, '変換したタグ').attributes('aria-checked')).toBe('true');
    expect(await storage.tagLinks.list(first.id)).toHaveLength(1);
  });

  it('compositionend 直後に isComposing=false の同じ Enter が来ても作成しない', async () => {
    const { wrapper } = await render();
    const input = wrapper.get('input');
    await input.trigger('compositionstart');
    (input.element as HTMLInputElement).value = '確定したタグ';
    await input.trigger('input');
    await input.trigger('compositionend');
    const event = await pressEnter(wrapper, { isComposing: false });
    expect(event.defaultPrevented).toBe(true);
    await wrapper.get('form').trigger('submit');
    expect(await storage.tags.list()).toHaveLength(2);
    expect(await storage.tagLinks.list()).toEqual([]);
    expect((input.element as HTMLInputElement).value).toBe('確定したタグ');

    await input.trigger('keyup', { key: 'Enter' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((await pressEnter(wrapper)).defaultPrevented).toBe(false);
    await idle(wrapper);
    expect(await storage.tags.list()).toHaveLength(3);
    expect(row(wrapper, '確定したタグ').attributes('aria-checked')).toBe('true');
    expect(await storage.tagLinks.list(first.id)).toHaveLength(1);
  });

  it.each(['', '  　\n'])('空欄 %j は作らず、入力欄に結び付いたエラーで知らせる（OQ-13 仮置き）', async title => {
    const { wrapper } = await render();
    await submit(wrapper, title);
    expect(wrapper.get('#tag-input-error').text()).toContain('名前を入力');
    expect(wrapper.get('#tag-input-error').attributes('role')).toBe('alert');
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('input').attributes('aria-describedby')).toContain('tag-input-error');
    expect(await storage.tags.list()).toHaveLength(2);
    expect(await storage.tagLinks.list()).toEqual([]);
    await wrapper.get('input').setValue('入力し直す');
    expect(wrapper.find('#tag-input-error').exists()).toBe(false);
  });

  it.each(['行きたい場所', '自作タグ'])('既存名 %s と重なる名前は作らない（OQ-13 仮置き）', async title => {
    await storage.tags.save({ id: 'custom', title: '自作タグ', builtin: false });
    const { wrapper } = await render();
    await submit(wrapper, ` ${title} `);
    expect(wrapper.get('#tag-input-error').text()).toContain('同じ名前');
    expect(await storage.tags.list()).toHaveLength(3);
    expect(await storage.tagLinks.list()).toEqual([]);
  });

  it('作成欄の補足で端末内限定・他の人には非公開・消失の可能性・作成時の付与を説明する', async () => {
    const { wrapper } = await render();
    const help = wrapper.get('form #tag-help');
    expect(help.text()).toContain('この端末の中にだけ保存');
    expect(help.text()).toContain('他の来場者には見えません');
    expect(help.text()).toContain('消えることがあります');
    expect(help.text()).toContain('この場所にそのまま付きます');
    expect(help.classes()).not.toContain('banner');
    expect(wrapper.get('label').attributes('for')).toBe(wrapper.get('input').attributes('id'));
    expect(wrapper.get('input').attributes('aria-describedby')).toBe('tag-help');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('最初からメモリ保存でも警告し、タグを作って付けられる', async () => {
    const memory = await localStorage.createStorage({ memory: true });
    instances.push(memory);
    vi.spyOn(localStorage, 'getStorage').mockResolvedValue(memory);
    const { wrapper } = await render();
    expect(wrapper.get('[role="alert"]').text()).toContain('端末に保存できていません');
    expect(wrapper.get('[role="alert"]').text()).toContain('再読み込みすると消えます');
    await submit(wrapper, 'メモリのタグ');
    await idle(wrapper);
    expect(row(wrapper, 'メモリのタグ').attributes('aria-checked')).toBe('true');
    expect(await memory.tagLinks.list(first.id)).toHaveLength(1);
    expect(wrapper.get('[role="alert"]').text()).toContain('メモリにだけ');
  });

  it('IndexedDBが書き込み途中で使えなくなると、メモリで続けて警告する', async () => {
    const { wrapper } = await render();
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await row(wrapper, 'お気に入り').trigger('click');
    await idle(wrapper);
    expect(storage.mode).toBe('memory');
    expect(row(wrapper, 'お気に入り').attributes('aria-checked')).toBe('true');
    expect(wrapper.get('[role="alert"]').text()).toContain('端末に保存できていません');
    expect(await storage.tagLinks.list(first.id)).toEqual([{ placeId: first.id, tagId: 'favorite' }]);
  });

  it('未保存通知と保存先の復旧通知を反映し、閉じる際は両方の購読を解除する', async () => {
    let notifyLost!: () => void;
    let notifyMode!: (mode: 'memory' | 'indexeddb') => void;
    const offLost = vi.fn();
    const offMode = vi.fn();
    vi.spyOn(storage, 'onWriteNotPersisted').mockImplementation(listener => { notifyLost = listener; return offLost; });
    vi.spyOn(storage, 'onModeChange').mockImplementation(listener => { notifyMode = listener; return offMode; });
    const close = vi.spyOn(storage, 'close');
    const { wrapper } = await render();
    notifyLost();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('メモリにだけ');
    notifyMode('indexeddb');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
    wrappers = wrappers.filter(item => item !== wrapper);
    expect(offLost).toHaveBeenCalledOnce();
    expect(offMode).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('同じ画面で場所を移動したら、場所名とその場所の付与状態を読み直す', async () => {
    await storage.tagLinks.save({ placeId: first.id, tagId: 'favorite' });
    const { wrapper, router } = await render();
    expect(row(wrapper, 'お気に入り').attributes('aria-checked')).toBe('true');
    await router.push({ name: 'tags', params: { id: second.id } });
    await idle(wrapper);
    expect(wrapper.get('#tags-place').text()).toBe(second.name);
    expect(row(wrapper, 'お気に入り').attributes('aria-checked')).toBe('false');
    await row(wrapper, '行きたい場所').trigger('click');
    await idle(wrapper);
    expect(await storage.tagLinks.list(first.id)).toEqual([{ placeId: first.id, tagId: 'favorite' }]);
    expect(await storage.tagLinks.list(second.id)).toEqual([{ placeId: second.id, tagId: 'want-to-go' }]);
  });

  it('場所がなければタグの操作を出さず、地図へ戻れる', async () => {
    const { wrapper, router } = await render('unknown');
    expect(wrapper.get('#missing-place-title').text()).toBe('場所の情報がありません');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false);
    await wrapper.get('.empty-state button').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('map'));
    expect(await storage.tagLinks.list()).toEqual([]);
  });

  it.each(['button', 'escape', 'swipe'])('%s でシートを閉じて元の場所へ戻る', async method => {
    const { wrapper, router } = await render();
    expect(document.activeElement).toBe(wrapper.get('[role="dialog"]').element);
    if (method === 'button') await wrapper.get('[aria-label="閉じる"]').trigger('click');
    if (method === 'escape') await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    if (method === 'swipe') {
      await wrapper.get('header').trigger('touchstart', { touches: [{ clientX: 20, clientY: 20 }] });
      await wrapper.get('header').trigger('touchend', { changedTouches: [{ clientX: 20, clientY: 90 }] });
    }
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(`/places/${first.id}`));
  });

  it('読み込み失敗を通知し、再読み込みで操作できるようになる', async () => {
    vi.spyOn(localStorage, 'getStorage').mockRejectedValueOnce(new Error('unavailable'));
    const { wrapper } = await render();
    expect(wrapper.get('[role="alert"]').text()).toContain('タグを読み込めませんでした');
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
    await wrapper.get('.banner button').trigger('click');
    await idle(wrapper);
    expect(wrapper.findAll('[role="checkbox"]')).toHaveLength(2);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('付け外しが失敗したら選択状態を変えず、理由を通知する', async () => {
    const { wrapper } = await render();
    vi.spyOn(storage.tagLinks, 'save').mockRejectedValueOnce(new Error('failed'));
    await row(wrapper, 'お気に入り').trigger('click');
    await idle(wrapper);
    expect(row(wrapper, 'お気に入り').attributes('aria-checked')).toBe('false');
    expect(wrapper.get('[role="alert"]').text()).toContain('タグを付け外しできませんでした');
    expect(await storage.tagLinks.list()).toEqual([]);
  });

  it('作成だけ成功した場合は一覧に残し、付与だけをやり直せる', async () => {
    const { wrapper } = await render();
    vi.spyOn(storage.tagLinks, 'save').mockRejectedValueOnce(new Error('failed'));
    await submit(wrapper, '付与をやり直す');
    await idle(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('タグは作れましたが');
    expect(row(wrapper, '付与をやり直す').attributes('aria-checked')).toBe('false');
    await row(wrapper, '付与をやり直す').trigger('click');
    await idle(wrapper);
    expect(row(wrapper, '付与をやり直す').attributes('aria-checked')).toBe('true');
    expect(await storage.tags.list()).toHaveLength(3);
    expect(await storage.tagLinks.list(first.id)).toHaveLength(1);
  });
});
