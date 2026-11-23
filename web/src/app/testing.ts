import { createPinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { reactive, ref } from 'vue';
import { vi } from 'vitest';
import App from '../App.vue';
import { routes } from '../router';
import * as storageModule from '../storage';
import * as syncModule from './sync';
import { useLabelsStore, useLandmarksStore, usePlacesStore } from '../stores';
import type { CacheKey } from '../sync/cache';
import type { Landmark, Place } from '../types';

export const event: Place = {
  id: 'event-1', name: 'お化け屋敷', kind: 'event', location: { lat: 37.4252, lng: 138.7788 },
  landmarkId: 'building-1', floor: 2, description: '研究棟の企画です', hours: [], labelIds: ['play'],
};
export const building: Landmark = {
  id: 'building-1', name: '研究棟', location: event.location, footprint: null, floors: [],
};
export const facilities: Place[] = (['info', 'wc', 'rest', 'trash'] as const).map(kind => ({
  ...event, id: kind, kind, name: `設備-${kind}`,
}));
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function syncDouble() {
  const start = deferred<void>();
  const state = reactive({
    mode: 'memory' as 'memory' | 'indexeddb' | null, writeNotPersisted: false,
    syncing: true, failedKeys: [] as CacheKey[], error: null as Error | null,
  });
  const sync = {
    state, hasSnapshot: ref(true), start: vi.fn(() => start.promise),
    refresh: vi.fn(async (_keys: readonly CacheKey[]) => {}), resync: vi.fn(async () => {}),
    close: vi.fn(), flush: vi.fn(async () => {}),
  };
  return { sync, finish(keys: CacheKey[] = [], error: Error | null = null) {
    state.failedKeys = keys;
    state.error = error;
    state.syncing = false;
    start.resolve();
  } };
}
export async function appHarness(path = '/', items: Place[] = [event], double = syncDouble()) {
  const pinia = createPinia();
  usePlacesStore(pinia).setAll(items);
  useLandmarksStore(pinia).setAll([building]);
  useLabelsStore(pinia).setAll([{ id: 'play', title: '遊び' }]);
  const storage = await storageModule.createStorage({ memory: true });
  vi.spyOn(storageModule, 'getStorage').mockResolvedValue(storage);
  vi.spyOn(syncModule, 'createAppSync').mockReturnValue(double.sync as ReturnType<typeof syncModule.createAppSync>);
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  await router.isReady();
  const host = document.createElement('div');
  document.body.append(host);
  const wrapper = mount(App, {
    attachTo: host,
    global: { plugins: [pinia, router], stubs: {
      MapCanvas: { name: 'MapCanvas', props: ['state'], emits: ['select'], template: '<div data-testid="map-canvas" />' },
      ArView: { template: '<div><slot /><slot name="location-help" /></div>' },
    } },
  });
  await flushPromises();
  const click = async (text: string, selector = 'button, a') => {
    const node = wrapper.findAll(selector).find(item => item.text().includes(text));
    if (!node) throw new Error(`操作が見つかりません: ${text}`);
    const href = node.element.tagName === 'A' ? node.attributes('href') : undefined;
    await node.trigger('click');
    if (href) await vi.waitFor(() => {
      if (router.currentRoute.value.fullPath !== href) throw new Error('経路の解決待ち');
    });
    await flushPromises();
  };
  return { wrapper, router, storage, pinia, host, ...double, click };
}
export type Harness = Awaited<ReturnType<typeof appHarness>>;
export function networkGuards() {
  const fetch = vi.fn<typeof globalThis.fetch>(() => { throw new Error('S-08: 外部通信は禁止'); });
  const network = vi.fn(() => { throw new Error('S-08: 外部接続は禁止'); });
  vi.stubGlobal('fetch', fetch);
  for (const name of ['EventSource', 'WebSocket', 'XMLHttpRequest']) vi.stubGlobal(name, network);
  return { fetch, network };
}
export async function disposeHarness(harness?: Harness) {
  harness?.wrapper.unmount();
  await harness?.storage.close();
  harness?.host.remove();
}
export function routeNames(wrapper: VueWrapper) {
  return wrapper.findAll('a').map(link => link.attributes('href'));
}
