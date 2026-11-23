import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { ApiError } from './client';
import AdminErrorBanner from './AdminErrorBanner.vue';

enableAutoUnmount(afterEach);

describe('運営のエラー表示', () => {
  it.each([null, undefined])('エラーがなければ表示しない: %s', (error) => {
    const wrapper = mount(AdminErrorBanner, { props: { error } });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('problem の code・message・field をテキストで表示する', async () => {
    const error = new ApiError({ code: 'invalid_input', message: '<script>名前を入力</script>', field: 'name' }, 400);
    const wrapper = mount(AdminErrorBanner, { props: { error } });
    expect(wrapper.get('[role="alert"]').attributes('data-tone')).toBe('error');
    expect(wrapper.text()).toContain(error.message);
    expect(wrapper.text()).toContain('invalid_input');
    expect(wrapper.text()).toContain('name');
    expect(wrapper.text()).toContain('入力内容を確認');
    expect(wrapper.find('script').exists()).toBe(false);
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('reload')).toHaveLength(1);
  });

  it('field がない problem に項目のラベルを表示しない', () => {
    const wrapper = mount(AdminErrorBanner, {
      props: { error: new ApiError({ code: 'label_in_use', message: '使用中の種類です' }, 409) },
    });
    expect(wrapper.findAll('dt').map((item) => item.text())).toEqual(['コード']);
    expect(wrapper.text()).toContain('使用中の種類です');
  });

  it.each(['unauthorized', 'internal_error'] as const)('401 は code=%s でも運営権限と次の手を案内する', async (code) => {
    const wrapper = mount(AdminErrorBanner, {
      props: { error: new ApiError({ code, message: '認証を確認してください' }, 401) },
    });
    expect(wrapper.get('h2').text()).toBe('運営の権限が必要です');
    expect(wrapper.text()).toContain('Cloudflare Access');
    expect(wrapper.text()).toContain('管理担当者に権限を確認');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.get('button').text()).toBe('認証し直す');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('reload')).toHaveLength(1);
  });

  it('通信エラーにはもう一度読み込む操作を示し、内部の例外文言は表示しない', () => {
    const wrapper = mount(AdminErrorBanner, { props: { error: new TypeError('Failed to fetch') } });
    expect(wrapper.get('h2').text()).toBe('通信に失敗しました');
    expect(wrapper.text()).toContain('通信環境を確認');
    expect(wrapper.get('button').text()).toBe('もう一度読み込む');
    expect(wrapper.text()).not.toContain('Failed to fetch');
    expect(wrapper.find('dl').exists()).toBe(false);
  });

  it('エラーが解消されたら alert を消す', async () => {
    const wrapper = mount(AdminErrorBanner, { props: { error: new Error('test') } });
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await wrapper.setProps({ error: null });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});
