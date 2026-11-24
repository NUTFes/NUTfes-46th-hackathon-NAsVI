import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import IconButton from './IconButton.vue';

enableAutoUnmount(afterEach);

describe('IconButton', () => {
  it('label を aria-label にし、アイコンは飾りにする', () => {
    const wrapper = mount(IconButton, { props: { icon: 'close', label: '閉じる' } });
    expect(wrapper.attributes('aria-label')).toBe('閉じる');
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
    expect(wrapper.get('svg').attributes('data-icon')).toBe('close');
  });

  it.each(['close', 'zoom-in', 'zoom-out', 'locate', 'layers'] as const)('%s を出せる', icon => {
    expect(mount(IconButton, { props: { icon, label: 'x' } }).get('svg').attributes('data-icon')).toBe(icon);
  });

  it('押下領域は 44px（--app-touch）', () => {
    const styles = import.meta.glob('./IconButton.vue', { query: '?raw', import: 'default', eager: true });
    const source = Object.values(styles)[0] as string;
    expect(source).toMatch(/width: var\(--app-touch, 44px\)/);
    expect(source).toMatch(/height: var\(--app-touch, 44px\)/);
  });

  it('default は押すと press。pressed は印を出す。disabled は押せない', async () => {
    const normal = mount(IconButton, { props: { icon: 'plus', label: '追加' } });
    expect(normal.attributes('data-pressed')).toBeUndefined();
    await normal.trigger('click');
    expect(normal.emitted('press')).toHaveLength(1);

    expect(mount(IconButton, { props: { icon: 'plus', label: '追加', pressed: true } }).attributes('data-pressed')).toBe('true');

    const disabled = mount(IconButton, { props: { icon: 'zoom-out', label: 'これ以上は縮小できません', disabled: true } });
    expect(disabled.attributes('disabled')).toBeDefined();
    expect(disabled.attributes('aria-label')).toBe('これ以上は縮小できません');
    await disabled.trigger('click');
    expect(disabled.emitted('press')).toBeUndefined();
  });

  it('plain は面を出さない印を持つ', () => {
    expect(mount(IconButton, { props: { icon: 'close', label: 'x', plain: true } }).classes()).toContain('nv-ibtn--plain');
  });
});
