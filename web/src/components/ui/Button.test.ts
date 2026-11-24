import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import Button, { type ButtonSize, type ButtonVariant } from './Button.vue';

enableAutoUnmount(afterEach);

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'destination', 'danger'];

describe('Button', () => {
  it('既定は primary・md、label を出して押すと press を出す', async () => {
    const wrapper = mount(Button, { props: { label: 'ここへ向かう' } });
    expect(wrapper.text()).toBe('ここへ向かう');
    expect(wrapper.attributes('data-variant')).toBe('primary');
    expect(wrapper.attributes('data-size')).toBe('md');
    expect(wrapper.attributes('type')).toBe('button');
    await wrapper.trigger('click');
    expect(wrapper.emitted('press')).toHaveLength(1);
  });

  describe.each(VARIANTS)('%s', variant => {
    it('default: 押せて、押下の印も無効の印も無い', () => {
      const button = mount(Button, { props: { label: 'ボタン', variant } }).get('button');
      expect(button.classes()).toContain(`nv-btn--${variant}`);
      expect(button.attributes('disabled')).toBeUndefined();
      expect(button.attributes('data-pressed')).toBeUndefined();
    });
    it('pressed: 押下の見た目を固定で出す', () => {
      const button = mount(Button, { props: { label: 'ボタン', variant, pressed: true } }).get('button');
      expect(button.attributes('data-pressed')).toBe('true');
      expect(button.attributes('disabled')).toBeUndefined();
    });
    it('disabled: 押せず、press も出ない', async () => {
      const wrapper = mount(Button, { props: { label: 'ボタン', variant, disabled: true } });
      expect(wrapper.get('button').attributes('disabled')).toBeDefined();
      await wrapper.trigger('click');
      expect(wrapper.emitted('press')).toBeUndefined();
    });
  });

  it.each<[ButtonSize, string]>([['sm', 'nv-btn--sm'], ['md', 'nv-btn--md'], ['lg', 'nv-btn--lg']])('size %s', (size, cls) => {
    const wrapper = mount(Button, { props: { label: 'ボタン', size, icon: 'check' } });
    expect(wrapper.classes()).toContain(cls);
    expect(wrapper.get('svg').attributes('width')).toBe(size === 'lg' ? '18' : '16');
  });

  it('icon は文字の左に出す', () => {
    const wrapper = mount(Button, { props: { label: '追加', icon: 'plus' } });
    expect(wrapper.element.firstElementChild?.tagName.toLowerCase()).toBe('svg');
    expect(wrapper.get('svg').attributes('data-icon')).toBe('plus');
  });

  it('色を直書きしない（スタイルは --app-* のみ）', () => {
    expect(mount(Button, { props: { label: 'a' } }).html()).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
