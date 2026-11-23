import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import Toast from './Toast.vue';

enableAutoUnmount(afterEach);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Toast', () => {
  it('message を role=status で出す', () => {
    const wrapper = mount(Toast, { props: { message: '混雑3 を足元に押しました' } });
    expect(wrapper.attributes('role')).toBe('status');
    expect(wrapper.text()).toBe('混雑3 を足元に押しました');
  });

  it('onUndo が無ければ取り消すを出さない', () => {
    expect(mount(Toast, { props: { message: 'x' } }).find('button').exists()).toBe(false);
  });

  it('取り消す（既定の文言）を押すと onUndo を呼ぶ。undoLabel で変えられる', async () => {
    const calls: string[] = [];
    const wrapper = mount(Toast, { props: { message: 'x', onUndo: () => calls.push('undo') } });
    expect(wrapper.get('button').text()).toBe('取り消す');
    await wrapper.get('button').trigger('click');
    expect(calls).toEqual(['undo']);
    await wrapper.setProps({ undoLabel: '元に戻す' });
    expect(wrapper.get('button').text()).toBe('元に戻す');
  });

  it('既定の 6000ms で dismiss を出す', () => {
    const wrapper = mount(Toast, { props: { message: 'x' } });
    vi.advanceTimersByTime(5999);
    expect(wrapper.emitted('dismiss')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('durationMs を変えられ、0 なら消さない', () => {
    const short = mount(Toast, { props: { message: 'x', durationMs: 1000 } });
    vi.advanceTimersByTime(1000);
    expect(short.emitted('dismiss')).toHaveLength(1);
    const keep = mount(Toast, { props: { message: 'x', durationMs: 0 } });
    vi.advanceTimersByTime(60_000);
    expect(keep.emitted('dismiss')).toBeUndefined();
  });

  it('message が変わると時間を数え直す', async () => {
    const wrapper = mount(Toast, { props: { message: 'a' } });
    vi.advanceTimersByTime(5000);
    await wrapper.setProps({ message: 'b' });
    vi.advanceTimersByTime(5000);
    expect(wrapper.emitted('dismiss')).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('外した後は dismiss を出さない', () => {
    const wrapper = mount(Toast, { props: { message: 'x' } });
    wrapper.unmount();
    vi.advanceTimersByTime(10_000);
    expect(wrapper.emitted('dismiss')).toBeUndefined();
  });

  it('floating で浮かぶ', () => {
    expect(mount(Toast, { props: { message: 'x' } }).classes()).not.toContain('nv-toast--floating');
    expect(mount(Toast, { props: { message: 'x', floating: true } }).classes()).toContain('nv-toast--floating');
  });
});
