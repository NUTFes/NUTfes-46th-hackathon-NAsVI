import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import Component from './MapEyeButton.vue';
enableAutoUnmount(afterEach);
describe('MapEyeButton', () => {
  it('名前付きのボタンで操作を通知する', async () => {
    const wrapper = mount(Component, { props: {} });
    expect(wrapper.get('button').attributes('aria-label')).toBeTruthy();
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('press')).toHaveLength(1);
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
  });
  it('シートの入口であり切替ボタンではない', () => {
    const wrapper = mount(Component);
    expect(wrapper.get('button').attributes('aria-haspopup')).toBe('dialog');
    expect(wrapper.get('button').attributes('aria-pressed')).toBeUndefined();
  });
});

// 地図でのシート接続も、実際の storage / MapState を使って確認する。
import { flushPromises } from '@vue/test-utils';
import { vi } from 'vitest';
import { appHarness, disposeHarness, event, facilities, networkGuards } from '../../app/testing';
import { usePosition } from '../../services/position';
import { useStampsStore } from '../../stores';

it('シートへフォーカスし、印を種類ごとに隠して閉じると入口へ戻る', async () => {
  const guards = networkGuards();
  const position = usePosition();
  position.refuse();
  const app = await appHarness('/', [event, ...facilities, { ...event, id: 'parking', kind: 'parking' }]);
  try {
    app.finish();
    await flushPromises();
    const stamp = { id: 'stamp', kind: 'fun' as const, at: event.location, pressedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
    useStampsStore(app.pinia).upsert(stamp);
    const button = app.wrapper.get<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    button.element.focus();
    await button.trigger('click');
    const dialog = app.wrapper.get<HTMLDialogElement>('dialog');
    expect(dialog.element.open).toBe(true);
    expect(document.activeElement).toBe(dialog.element);
    expect(dialog.findAll('input[type="checkbox"]')).toHaveLength(5);
    const map = app.wrapper.findComponent({ name: 'MapCanvas' });
    const checks = dialog.findAll('input');
    await checks[0].setValue(false);
    expect(map.props('state').places.map((p: { id: string }) => p.id)).toEqual([...facilities.map(p => p.id), 'parking']);
    await checks[1].setValue(false);
    expect(map.props('state').places.map((p: { id: string }) => p.id)).toEqual(['parking']);
    await checks[2].setValue(false);
    expect(map.props('state').places).toEqual([]);
    expect(map.props('state').stamps).toEqual([stamp]);
    await checks[3].setValue(false);
    await checks[4].setValue(false);
    expect(map.props('state').stamps).toEqual([]);
    expect(map.props('state').landmarks).toEqual([]);
    expect(await app.storage.filter.get()).toEqual({ labelIds: [], tagIds: [] });
    await dialog.get('button[aria-label="閉じる"]').trigger('click');
    await flushPromises();
    expect(dialog.element.open).toBe(false);
    expect(document.activeElement).toBe(button.element);
    expect(guards.network).not.toHaveBeenCalled();
  } finally {
    await disposeHarness(app);
    position.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
