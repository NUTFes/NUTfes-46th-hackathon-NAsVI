import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import screensYaml from '../../../concept-design/screens.yaml?raw';
import AdminLayout from '../views/admin/AdminLayout.vue';
import { routes } from './index';

// screens.yaml の画面 ID と URL の対応。
// labels / floorplans は WBS の独立した View で、元の運営画面から分ける。
const screenRoutes = [
  { screenId: 'map', name: 'map', path: '/' },
  { screenId: 'search', name: 'search', path: '/search' },
  { screenId: 'card', name: 'card', path: '/places/test-place' },
  { screenId: 'tags', name: 'tags', path: '/places/test-place/tags' },
  { screenId: 'guide', name: 'guide', path: '/guide' },
  { screenId: 'stamp', name: 'stamp', path: '/stamp' },
  { screenId: 'noloc', name: 'noloc', path: '/noloc' },
  { screenId: 'building', name: 'building', path: '/buildings/test-building' },
  { screenId: 'list', name: 'list', path: '/list' },
  { screenId: 'camera', name: 'camera', path: '/camera' },
  { screenId: 'op_places', name: 'admin-places', path: '/admin/places' },
  { screenId: 'op_places', name: 'admin-labels', path: '/admin/labels' },
  { screenId: 'op_landmarks', name: 'admin-landmarks', path: '/admin/landmarks' },
  { screenId: 'op_landmarks', name: 'admin-floorplans', path: '/admin/floorplans' },
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

  // 画面内容は各画面のタスクのテストで検証する。
  it.each(screenRoutes)('$screenId: $path は正しい名前・パラメータ・レイアウトに解決される', async (screen) => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    await router.push(screen.path);
    await router.isReady();

    expect(router.currentRoute.value.name).toBe(screen.name);
    expect(router.currentRoute.value.matched.some((record) => record.components?.default === AdminLayout))
      .toBe(screen.path.startsWith('/admin/'));
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

    expect(router.currentRoute.value.path).toBe('/admin/places');
  });
});
