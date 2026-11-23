import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, useRoute } from 'vue-router';
import { routes } from '../router';
import AdminLayout from '../views/admin/AdminLayout.vue';
import { ApiError } from './client';
import { useAdminFeedback } from './feedback';

enableAutoUnmount(afterEach);
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('外部通信は禁止'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderLayout(path = '/admin/places', error: unknown = new ApiError({
  code: 'unauthorized', message: '運営としてログインしてください',
}, 401)) {
  const Screen = defineComponent({
    setup() {
      const route = useRoute();
      const { reportError, clearError } = useAdminFeedback();
      return () => h('main', [
        h('h2', String(route.name)),
        h('button', { onClick: () => reportError(error) }, '失敗を表示'),
        h('button', { onClick: clearError }, '失敗を解消'),
      ]);
    },
  });
  const adminRoute = routes.find((route) => route.path === '/admin')!;
  // パス・名前・redirect は変更不可の既存ルーターを使い、業務画面だけを差し替える。
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: adminRoute.path, redirect: adminRoute.redirect, component: AdminLayout,
      children: adminRoute.children!.map((route) => ({ path: route.path, name: route.name, component: Screen })),
    }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(RouterView, { global: { plugins: [router] } });
  return { wrapper, router };
}

describe('運営画面の枠', () => {
  it.each([
    ['/admin/places', 'admin-places'],
    ['/admin/labels', 'admin-labels'],
    ['/admin/landmarks', 'admin-landmarks'],
    ['/admin/floorplans', 'admin-floorplans'],
  ])('%s に4項目のナビと RouterView の子画面を表示する', async (path, name) => {
    const { wrapper } = await renderLayout(path);
    expect(wrapper.get('header h1').text()).toBe('運営の画面');
    const links = wrapper.get('nav[aria-label="運営の管理メニュー"]').findAll('a');
    expect(links.map((link) => [link.attributes('href'), link.text()])).toEqual([
      ['/admin/places', '場所'], ['/admin/labels', '種類'],
      ['/admin/landmarks', '建物'], ['/admin/floorplans', '見取り図'],
    ]);
    expect(wrapper.get('a[aria-current="page"]').attributes('href')).toBe(path);
    expect(wrapper.findAll('a[aria-current="page"]')).toHaveLength(1);
    expect(wrapper.get('main h2').text()).toBe(name);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('/admin の既存の転送先は場所管理になる', async () => {
    const { router } = await renderLayout('/admin');
    expect(router.currentRoute.value.path).toBe('/admin/places');
  });

  it('子画面から401を受け取り、枠の上部に案内する', async () => {
    const { wrapper } = await renderLayout();
    await wrapper.get('main button').trigger('click');
    expect(wrapper.get('[role="alert"] h2').text()).toBe('運営の権限が必要です');
    expect(wrapper.get('[role="alert"]').text()).toContain('unauthorized');
    expect(wrapper.get('.admin-layout__content').element.firstElementChild?.getAttribute('role')).toBe('alert');
    expect(wrapper.find('nav').exists()).toBe(true);
    expect(wrapper.find('main').exists()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('子画面の problem を表示し、解消の通知で消す', async () => {
    const error = new ApiError({ code: 'invalid_input', message: '名前が必要です', field: 'name' }, 400);
    const { wrapper } = await renderLayout('/admin/places', error);
    await wrapper.get('main button').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('名前が必要です');
    expect(wrapper.get('[role="alert"]').text()).toContain('name');
    await wrapper.findAll('main button')[1].trigger('click');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('認証し直す操作はページを開き直し、API を自動再送しない', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    const { wrapper } = await renderLayout();
    await wrapper.get('main button').trigger('click');
    await wrapper.get('[role="alert"] button').trigger('click');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ナビで別の管理画面へ移ると選択状態が変わり、前のエラーを消す', async () => {
    const { wrapper, router } = await renderLayout();
    await wrapper.get('main button').trigger('click');
    await wrapper.get('a[href="/admin/landmarks"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/admin/landmarks');
    expect(wrapper.get('main h2').text()).toBe('admin-landmarks');
    expect(wrapper.get('a[aria-current="page"]').text()).toBe('建物');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('枠を作り直したときに前のエラーを引き継がない', async () => {
    const first = await renderLayout();
    await first.wrapper.get('main button').trigger('click');
    expect(first.wrapper.find('[role="alert"]').exists()).toBe(true);
    first.wrapper.unmount();
    const second = await renderLayout();
    expect(second.wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
