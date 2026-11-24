import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import DestinationBar from './DestinationBar.vue';
enableAutoUnmount(afterEach);
describe('DestinationBar', () => {
  it('距離を丸めて案内へのリンクを残し、解除を独立して通知する', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/guide', name: 'guide', component: { template: '<div />' } }] });
    const wrapper = mount(DestinationBar, { props: { placeName: 'お化け屋敷', remainingM: 150.2 }, global: { plugins: [router] } });
    expect(wrapper.text()).toContain('お化け屋敷まで 150 m');
    expect(wrapper.get('a').attributes('href')).toBe('/guide');
    expect(wrapper.get('a').attributes('aria-label')).toContain('150 メートル');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('stop')).toHaveLength(1);
    await wrapper.setProps({ remainingM: undefined, stopping: true });
    expect(wrapper.text()).toBe('お化け屋敷まで');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('stop')).toHaveLength(1);
  });
});

import { flushPromises } from '@vue/test-utils';
import { vi } from 'vitest';
import { appHarness, disposeHarness, event, networkGuards } from '../../app/testing';
import { usePosition } from '../../services/position';

it('地図で位置なしの距離を省き、解除後は保存先も空にしてフォーカスを戻す', async () => {
  networkGuards();
  const position = usePosition();
  position.refuse();
  const app = await appHarness('/');
  try {
    app.finish();
    await app.storage.destination.save({ placeId: event.id });
    await app.router.replace('/?q=test');
    await flushPromises();
    const bar = app.wrapper.get('.destination-bar');
    expect(bar.text()).toBe(`${event.name}まで`);
    expect(bar.get('a').attributes('href')).toBe('/guide');
    const stop = bar.get<HTMLButtonElement>('button');
    stop.element.focus();
    await stop.trigger('click');
    await flushPromises();
    expect(await app.storage.destination.get()).toBeNull();
    expect(app.wrapper.find('.destination-bar').exists()).toBe(false);
    expect(document.activeElement).toBe(app.wrapper.get('button[aria-haspopup="dialog"]').element);
  } finally {
    await disposeHarness(app);
    position.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
