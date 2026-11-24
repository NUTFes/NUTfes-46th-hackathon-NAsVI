import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import designTokens from '../../../design-system/claude-design/tokens.json';
import { appColors, useAppTokens } from './tokens';
import { useThemeAttribute } from './useThemeAttribute';

type Entry = { name: string; value: string | { dark: string; light: string } };
const entries = designTokens.color.tokens as Entry[];
// claude-design/tokens.json の値を、tokens.ts とは別の経路（パレットの項目を直接引く）で解く。
function expected(name: string, theme: 'dark' | 'light'): string {
  const raw = entries.find(entry => entry.name === name)!.value;
  const value = typeof raw === 'string' ? raw : raw[theme];
  const ref = /^\{(.+)\}$/.exec(value);
  return ref ? (entries.find(entry => entry.name === ref[1])!.value as string) : value;
}

describe('I-0 トークン', () => {
  it.each([
    ['border-control', { dark: '#a78bfa99', light: '#1e0b3a80' }],
    ['danger-on', { dark: '#1e0b3a', light: '#ffffff' }],
    ['destination-text', { dark: '#ffd84a', light: '#7c2d12' }],
  ] as const)('仮置きの %s は両テーマで claude-design/tokens.json と一致する', (name, fixed) => {
    for (const theme of ['dark', 'light'] as const) {
      const color = appColors(theme)[`--app-${name}`];
      expect(color).toBe(expected(name, theme));
      expect(color.toLowerCase()).toBe(fixed[theme]);
    }
  });

  it('意味の色がダーク・ライトの両方で出る', () => {
    for (const theme of ['dark', 'light'] as const) {
      const colors = appColors(theme);
      for (const name of [
        'destination', 'facility', 'parking', 'feeling', 'stale', 'state-pressed', 'skeleton',
        'action-selected-bg', 'congestion-1', 'congestion-5-on', 'border-control', 'danger-on',
        'destination-text',
      ]) expect(colors[`--app-${name}`]).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      expect(colors['--app-destination'].toLowerCase()).toBe(expected('destination', theme).toLowerCase());
      expect(colors['--app-skeleton'].toLowerCase()).toBe(expected('skeleton', theme).toLowerCase());
    }
  });

  it('既存の色は変わらない', () => {
    expect(appColors('dark')['--app-bg-page']).toBe('#130a22');
    expect(appColors('light')['--app-bg-page']).toBe('#f6f4fa');
  });

  it('--app-destination などが getComputedStyle で取れる', async () => {
    const Host = defineComponent({
      setup() {
        const root = ref<HTMLElement>();
        const style = useAppTokens(root);
        return () => h('div', { ref: root, style: style.value, 'data-theme': 'light' });
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await nextTick();
    const style = getComputedStyle(wrapper.element);
    expect(style.getPropertyValue('--app-destination').toLowerCase()).toBe(expected('destination', 'light').toLowerCase());
    expect(style.getPropertyValue('--app-destination-text').toLowerCase()).toBe(expected('destination-text', 'light'));
    wrapper.unmount();
  });
});

describe('useThemeAttribute', () => {
  function stubMedia(matches: boolean) {
    let listener: (() => void) | undefined;
    const query = {
      matches,
      addEventListener: (_: string, fn: () => void) => { listener = fn; },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => query);
    return { change(next: boolean) { query.matches = next; listener?.(); }, query };
  }
  function host() {
    return defineComponent({
      setup() {
        const root = ref<HTMLElement>();
        useThemeAttribute(root);
        return () => h('div', { ref: root });
      },
    });
  }

  it('OS の設定に追従して data-theme を書き、外すと購読を解く', () => {
    const media = stubMedia(false);
    const wrapper = mount(host());
    expect(wrapper.element.getAttribute('data-theme')).toBe('dark');
    media.change(true);
    expect(wrapper.element.getAttribute('data-theme')).toBe('light');
    media.change(false);
    expect(wrapper.element.getAttribute('data-theme')).toBe('dark');
    wrapper.unmount();
    expect(media.query.removeEventListener).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('OS がライトなら最初から light', () => {
    stubMedia(true);
    const wrapper = mount(host());
    expect(wrapper.element.getAttribute('data-theme')).toBe('light');
    wrapper.unmount();
    vi.unstubAllGlobals();
  });
});
