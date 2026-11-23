import { afterEach, describe, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import Icon, { ICON_NAMES, type IconName } from './Icon.vue';

enableAutoUnmount(afterEach);

// Figma の Icon ページ（22:189）の 29 種。star・bookmark・navigation の filled は prop で出す
const FIGMA_NAMES = [
  'search', 'search-off', 'close', 'locate', 'locate-off', 'zoom-in', 'zoom-out', 'plus', 'layers', 'stamp',
  'list', 'map', 'camera', 'filter', 'star', 'bookmark', 'tag', 'check', 'chevron-right', 'navigation', 'flag',
  'info', 'wc', 'rest', 'trash', 'fun', 'food', 'good', 'alert',
];

describe('Icon', () => {
  it('Figma の 29 種を持つ', () => {
    expect([...ICON_NAMES].sort()).toEqual([...FIGMA_NAMES].sort());
  });

  it.each(FIGMA_NAMES)('%s を 24 の格子の SVG で出す', name => {
    const svg = mount(Icon, { props: { name: name as IconName } }).get('svg');
    expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    expect(svg.attributes('stroke')).toBe('currentColor');
    expect(svg.findAll('path, circle').length).toBeGreaterThan(0);
  });

  it('size の既定は 20、指定で変わる', () => {
    expect(mount(Icon, { props: { name: 'check' } }).get('svg').attributes('width')).toBe('20');
    const big = mount(Icon, { props: { name: 'check', size: 40 } }).get('svg');
    expect([big.attributes('width'), big.attributes('height')]).toEqual(['40', '40']);
  });

  it('label が無ければ飾り、あれば読み上げる', () => {
    const decorative = mount(Icon, { props: { name: 'check' } }).get('svg');
    expect(decorative.attributes('aria-hidden')).toBe('true');
    expect(decorative.attributes('role')).toBeUndefined();
    const labelled = mount(Icon, { props: { name: 'check', label: '済み' } }).get('svg');
    expect(labelled.attributes('role')).toBe('img');
    expect(labelled.attributes('aria-label')).toBe('済み');
    expect(labelled.attributes('aria-hidden')).toBeUndefined();
  });

  it.each(['star', 'bookmark', 'navigation'] as const)('%s は filled で塗りつぶす', name => {
    expect(mount(Icon, { props: { name } }).get('path').attributes('fill')).toBeUndefined();
    const filled = mount(Icon, { props: { name, filled: true } });
    expect(filled.get('path').attributes('fill')).toBe('currentColor');
    expect(filled.get('svg').attributes('data-filled')).toBe('true');
  });

  it('塗りに対応しないアイコンは filled を無視し、wc は常に塗る', () => {
    expect(mount(Icon, { props: { name: 'check', filled: true } }).get('path').attributes('fill')).toBeUndefined();
    expect(mount(Icon, { props: { name: 'wc' } }).get('path').attributes('fill')).toBe('currentColor');
  });

  it('strokeWidth と rotate を受ける', () => {
    expect(mount(Icon, { props: { name: 'check' } }).get('svg').attributes('stroke-width')).toBe('2.6');
    const svg = mount(Icon, { props: { name: 'navigation', strokeWidth: 3, rotate: 90 } }).get('svg');
    expect(svg.attributes('stroke-width')).toBe('3');
    expect(svg.attributes('style')).toContain('rotate(90deg)');
  });

  it('色を直書きしない', () => {
    const html = mount(Icon, { props: { name: 'tag' } }).html();
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb/i);
  });
});
