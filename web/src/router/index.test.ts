import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import screensYaml from '../../../concept-design/screens.yaml?raw';
import App from '../App.vue';
import AdminLayout from '../views/admin/AdminLayout.vue';
import { routes } from './index';

enableAutoUnmount(afterEach);

// screens.yaml の画面 ID と URL の対応。
// labels / floorplans は WBS の独立した View で、元の運営画面から分ける。
const screenRoutes = [
  { screenId: 'map', name: 'map', path: '/', title: 'マップ' },
  { screenId: 'search', name: 'search', path: '/search', title: '検索結果' },
  { screenId: 'card', name: 'card', path: '/places/test-place', title: '場所のカード' },
  { screenId: 'tags', name: 'tags', path: '/places/test-place/tags', title: 'タグを付ける・作る' },
  { screenId: 'guide', name: 'guide', path: '/guide', title: '案内中' },
  { screenId: 'stamp', name: 'stamp', path: '/stamp', title: 'スタンプを押す' },
  { screenId: 'noloc', name: 'noloc', path: '/noloc', title: '位置が使えない' },
  { screenId: 'building', name: 'building', path: '/buildings/test-building', title: '建物の中の地図' },
  { screenId: 'list', name: 'list', path: '/list', title: '一覧' },
  { screenId: 'camera', name: 'camera', path: '/camera', title: 'カメラ' },
  { screenId: 'op_places', name: 'admin-places', path: '/admin/places', title: '場所の登録・管理(運営)' },
  { screenId: 'op_places', name: 'admin-labels', path: '/admin/labels', title: '種類の定義・管理(運営)' },
  { screenId: 'op_landmarks', name: 'admin-landmarks', path: '/admin/landmarks', title: '建物の登録・管理(運営)' },
  { screenId: 'op_landmarks', name: 'admin-floorplans', path: '/admin/floorplans', title: '見取り図の登録・管理(運営)' },
];

describe('画面のルーター', () => {
  it('対応表が screens.yaml のすべての画面と登録済みの全 View を網羅する', () => {
    // YAML 全体ではなく screens 節の画面 ID だけを読む。
    const screens = screensYaml.split(/^screens:\s*$/m)[1].split(/^excluded_actions:/m)[0];
    const ids = [...screens.matchAll(/^  - id: (\w+)\s*$/gm)].map((match) => match[1]);
    expect(ids).toHaveLength(12);
    expect([...new Set(screenRoutes.map((screen) => screen.screenId))].sort()).toEqual(ids.sort());

    const router = createRouter({ history: createMemoryHistory(), routes });
    const names = router.getRoutes().flatMap((route) => route.name ? [route.name] : []);
    expect(names.sort()).toEqual(screenRoutes.map((screen) => screen.name).sort());
    expect(screenRoutes).toHaveLength(14);
  });

  it.each(screenRoutes)('$screenId: $path で対応する未実装 View を表示する', async (screen) => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push(screen.path);
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } });
    expect(router.currentRoute.value.name).toBe(screen.name);
    expect(wrapper.get('main h1').text()).toBe(screen.title);
    expect(wrapper.get('main p').text()).toBe('未実装');
    expect(wrapper.findComponent(AdminLayout).exists()).toBe(screen.path.startsWith('/admin/'));
    if (screen.name === 'card' || screen.name === 'tags') {
      expect(router.currentRoute.value.params.id).toBe('test-place');
    }
    if (screen.name === 'building') {
      expect(router.currentRoute.value.params.id).toBe('test-building');
    }
  });

  it('/admin は運営の場所管理へ移動する', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/admin');
    await router.isReady();

    const wrapper = mount(App, { global: { plugins: [createPinia(), router] } });
    expect(router.currentRoute.value.path).toBe('/admin/places');
    expect(wrapper.get('main h1').text()).toBe('場所の登録・管理(運営)');
    expect(wrapper.get('main p').text()).toBe('未実装');
    expect(wrapper.findComponent(AdminLayout).exists()).toBe(true);
  });
});
