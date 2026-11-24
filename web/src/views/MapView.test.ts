import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { building, event, facilities } from '../app/testing';
import { fromXY } from '../domain/geo';
import { usePosition } from '../services/position';
import * as storageModule from '../storage';
import { useLandmarksStore, usePlacesStore, useStampsStore } from '../stores';
import type { MapState } from '../map/layers/types';
import MapView from './MapView.vue';

const zoomBy = vi.fn();
const flyTo = vi.fn();
const Canvas = defineComponent({
  name: 'MapCanvas', props: ['state'], emits: ['zoomLimits'],
  setup(_props, { expose }) { expose({ zoomBy, flyTo }); return () => h('div'); },
});
let storage: storageModule.StorageRepositories;
let position: ReturnType<typeof usePosition>;
let wrapper: VueWrapper | undefined;
let host: HTMLElement;
let pinia: ReturnType<typeof createPinia>;

async function renderMap() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'map', component: MapView },
    ...['guide', 'noloc', 'stamp'].map(name => ({ path: `/${name}`, name, component: { template: '<p />' } })),
  ] });
  await router.push('/');
  await router.isReady();
  wrapper = mount(MapView, { attachTo: host, global: { plugins: [pinia, router], stubs: { MapCanvas: Canvas } } });
  await flushPromises();
  return wrapper;
}

beforeEach(async () => {
  vi.useFakeTimers();
  zoomBy.mockClear(); flyTo.mockClear();
  pinia = createPinia(); setActivePinia(pinia);
  storage = await storageModule.createStorage({ memory: true });
  vi.spyOn(storageModule, 'getStorage').mockResolvedValue(storage);
  usePlacesStore().setAll([event, ...facilities, { ...event, id: 'parking', kind: 'parking' }]);
  useLandmarksStore().setAll([building]);
  position = usePosition(); position.refuse();
  host = document.createElement('div'); document.body.append(host);
});
afterEach(async () => {
  wrapper?.unmount(); wrapper = undefined; host.remove();
  position.dispose(); await storage.close();
  vi.restoreAllMocks(); vi.useRealTimers();
});

describe('MapView の操作', () => {
  it.each(['button', 'escape'] as const)('%s で表示シートを閉じると Eye にフォーカスが戻る', async method => {
    const view = await renderMap();
    const eye = view.get<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    eye.element.focus(); await eye.trigger('click');
    const dialog = view.get<HTMLDialogElement>('dialog');
    expect(dialog.element.open).toBe(true);
    expect(document.activeElement).toBe(dialog.element);
    if (method === 'button') await dialog.get('button[aria-label="閉じる"]').trigger('click');
    // Esc のブラウザ既定動作が送る cancel を再現する（DOM 環境はキーの既定動作を実行しない）。
    else await dialog.trigger('cancel');
    await flushPromises();
    expect(dialog.element.open).toBe(false);
    expect(document.activeElement).toBe(eye.element);
  });

  it('5種類の印を個別に隠し、再表示した state を MapCanvas に渡す', async () => {
    const stamp = { id: 'stamp', kind: 'fun' as const, at: event.location, pressedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
    useStampsStore().upsert(stamp);
    const view = await renderMap();
    await view.get('button[aria-haspopup="dialog"]').trigger('click');
    const canvas = view.getComponent(Canvas);
    const state = () => canvas.props('state') as MapState;
    const original = state();
    const checks = view.findAll('dialog input');
    expect(checks).toHaveLength(5);
    for (const [index, key] of (['event', 'facility', 'parking', 'stamps', 'landmarks'] as const).entries()) {
      await checks[index].setValue(false);
      if (key === 'stamps' || key === 'landmarks') expect(state()[key]).toEqual([]);
      else expect(state().places).toEqual(original.places.filter(p => key === 'facility' ? p.kind === 'event' || p.kind === 'parking' : p.kind !== key));
      await checks[index].setValue(true);
      expect(state()).toEqual(original);
    }
    expect(original.stamps).toEqual([stamp]);
    expect(original.landmarks).toEqual([building]);
    expect(await storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
  });

  it('案内をやめると保存先と DestinationBar を解除し、Eye へフォーカスを移さない', async () => {
    await storage.destination.save({ placeId: event.id });
    const clear = vi.spyOn(storage.destination, 'clear');
    const view = await renderMap();
    const stop = view.get<HTMLButtonElement>('button[aria-label="案内をやめる"]');
    stop.element.focus(); await stop.trigger('click'); await flushPromises();
    expect(clear).toHaveBeenCalledOnce();
    expect(await storage.destination.get()).toBeNull();
    expect(view.find('.destination-bar').exists()).toBe(false);
    expect(view.getComponent(Canvas).props('state').destination).toBeNull();
    expect(document.activeElement).not.toBe(view.get('button[aria-haspopup="dialog"]').element);
  });

  it('Zoom と Locate を Canvas に接続し、倍率上限・下限では操作を無効にする', async () => {
    const point = fromXY(10, 20); position.setManually(point.lat, point.lng, 8);
    const view = await renderMap();
    await view.get('button[aria-label="地図を拡大"]').trigger('click');
    await view.get('button[aria-label="地図を縮小"]').trigger('click');
    await view.get('button[aria-label="現在地へ戻る"]').trigger('click');
    expect(zoomBy.mock.calls).toEqual([[1], [-1]]);
    expect(flyTo).toHaveBeenCalledOnce();
    const canvas = view.getComponent(Canvas);
    for (const limits of [{ zoomInDisabled: true, zoomOutDisabled: false }, { zoomInDisabled: false, zoomOutDisabled: true }]) {
      canvas.vm.$emit('zoomLimits', limits); await flushPromises();
      const buttons = view.findAll('.zoom button');
      expect((buttons[0].element as HTMLButtonElement).disabled).toBe(limits.zoomInDisabled);
      expect((buttons[1].element as HTMLButtonElement).disabled).toBe(limits.zoomOutDisabled);
      await buttons[limits.zoomInDisabled ? 0 : 1].trigger('click');
    }
    expect(zoomBy).toHaveBeenCalledTimes(2);
    position.refuse(); await flushPromises();
    const locate = view.get<HTMLButtonElement>('.locate-button');
    expect(locate.element.disabled).toBe(true); await locate.trigger('click');
    expect(flyTo).toHaveBeenCalledOnce();
  });

  it('位置がなければ StampFab は無効になり、押しても遷移しない', async () => {
    const view = await renderMap();
    const stamp = view.get<HTMLButtonElement>('.map-view__stamp');
    expect(stamp.element.disabled).toBe(true);
    await stamp.trigger('click');
    expect(view.vm.$router.currentRoute.value.name).toBe('map');
  });
});
