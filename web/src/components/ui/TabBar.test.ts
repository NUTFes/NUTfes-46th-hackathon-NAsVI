import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import TabBar from './TabBar.vue';

const items = [
  { name: 'list', label: '一覧' }, { name: 'map', label: 'マップ' }, { name: 'camera', label: 'カメラ' },
] as const;

async function setup() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: items.map(item => ({ name: item.name, path: `/${item.name}`, component: { template: '<div />' } })),
  });
  await router.push('/map');
  await router.isReady();
  const wrapper = mount(TabBar, { props: { items, current: 'map' }, global: { plugins: [router] } });
  return { wrapper, router };
}

describe('TabBar', () => {
  it('3つの飾りアイコン・ラベルとリンク先を表示する', async () => {
    const { wrapper } = await setup();
    expect(wrapper.attributes('aria-label')).toBe('表示を切り替える');
    expect(wrapper.findAll('svg').map(icon => [icon.attributes('data-icon'), icon.attributes('aria-hidden')]))
      .toEqual([['list', 'true'], ['map', 'true'], ['camera', 'true']]);
    expect(wrapper.findAll('a').map(link => [link.text(), link.attributes('href')]))
      .toEqual([['一覧', '/list'], ['マップ', '/map'], ['カメラ', '/camera']]);
    wrapper.unmount();
  });

  it('current の変更で aria-current を選択先だけに移す', async () => {
    const { wrapper } = await setup();
    expect(wrapper.findAll('[aria-current="page"]').map(link => link.text())).toEqual(['マップ']);
    await wrapper.setProps({ current: 'camera' });
    expect(wrapper.findAll('[aria-current="page"]').map(link => link.text())).toEqual(['カメラ']);
    wrapper.unmount();
  });

  it('クリックでルートを遷移する', async () => {
    const { wrapper, router } = await setup();
    await wrapper.get('a[href="/camera"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('camera');
    wrapper.unmount();
  });
});
