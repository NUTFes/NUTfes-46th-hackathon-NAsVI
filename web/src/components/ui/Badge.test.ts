import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import Badge from './Badge.vue';

enableAutoUnmount(afterEach);

describe('Badge', () => {
  it('既定は neutral で label を出す', () => {
    const wrapper = mount(Badge, { props: { label: '体験' } });
    expect(wrapper.text()).toBe('体験');
    expect(wrapper.attributes('data-tone')).toBe('neutral');
    expect(wrapper.classes()).toEqual(['nv-badge']);
  });

  it.each(['parking', 'ok', 'warn'] as const)('tone %s', tone => {
    const wrapper = mount(Badge, { props: { label: 'x', tone } });
    expect(wrapper.attributes('data-tone')).toBe(tone);
    expect(wrapper.classes()).toContain(`nv-badge--${tone}`);
  });

  it('押せない（button ではない）', () => {
    expect(mount(Badge, { props: { label: '駐車場', tone: 'parking' } }).element.tagName).toBe('SPAN');
  });
});
