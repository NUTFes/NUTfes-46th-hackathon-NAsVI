import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { floorplanXY } from '../domain/floorplan';
import type { FloorPlan as FloorPlanData, Place } from '../types';
import FloorPlan from './FloorPlan.vue';

enableAutoUnmount(afterEach);

const plan: FloorPlanData = {
  floor: 2,
  bounds: { north: 38, south: 36, east: 140, west: 138 },
  plan: { viewBox: '-20 10 240 120', d: 'M-20 10H220V130H-20Z' },
};
const place: Place = {
  id: 'event-1', name: 'お化け屋敷', kind: 'event',
  location: { lat: 37.5, lng: 138.5 }, description: '',
  landmarkId: 'building-1', floor: 2, hours: [], labelIds: [],
};
const hosts: HTMLElement[] = [];

function themeHost(theme?: string) {
  const host = document.createElement('div');
  if (theme !== undefined) host.dataset.theme = theme;
  document.body.append(host);
  hosts.push(host);
  return host;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('コンポーネントからの通信は禁止'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  hosts.splice(0).forEach((host) => host.remove());
});

describe('FloorPlan', () => {
  it.each([
    ['light', '#f6f4fa', '#ffffff', '#1e0b3a', '#5b5274', '#6d28d9', '#ffffff', 'rgba(30, 11, 58, 0.15)', '#0f766e'],
    ['dark', '#130a22', '#1c1032', '#f4f0ff', '#b4a9cf', '#a78bfa', '#1e0b3a', 'rgba(167, 139, 250, 0.28)', '#5eead4'],
    [undefined, '#130a22', '#1c1032', '#f4f0ff', '#b4a9cf', '#a78bfa', '#1e0b3a', 'rgba(167, 139, 250, 0.28)', '#5eead4'],
    ['unknown', '#130a22', '#1c1032', '#f4f0ff', '#b4a9cf', '#a78bfa', '#1e0b3a', 'rgba(167, 139, 250, 0.28)', '#5eead4'],
  ])('テーマ %s に対応するデザイントークンを使う', async (theme, bg, surface, text, secondary, action, onAction, border, event) => {
    const wrapper = mount(FloorPlan, { attachTo: themeHost(theme), props: { plan, places: [place] } });
    await nextTick();
    const style = wrapper.get('svg').element.style;
    const expected = {
      'bg-page': bg, 'bg-surface': surface, 'text-primary': text, 'text-secondary': secondary,
      'action-primary': action, 'action-on-primary': onAction, 'border-subtle': border,
      event, 'map-ring': bg,
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(style.getPropertyValue(`--building-${token}`)).toBe(value);
    }
  });

  it('最寄りのテーマを優先し、ライト・ダークの切替と属性の削除に追従する', async () => {
    const outer = themeHost('light');
    const inner = document.createElement('div');
    inner.dataset.theme = 'dark';
    outer.append(inner);
    const wrapper = mount(FloorPlan, { attachTo: inner, props: { plan, places: [] } });
    await nextTick();
    const color = () => wrapper.get('svg').element.style.getPropertyValue('--building-event');
    expect(color()).toBe('#5eead4');
    inner.dataset.theme = 'light';
    await flushPromises();
    expect(color()).toBe('#0f766e');
    inner.dataset.theme = 'dark';
    await flushPromises();
    expect(color()).toBe('#5eead4');
    inner.removeAttribute('data-theme');
    await flushPromises();
    expect(color()).toBe('#0f766e');
  });

  it('後から見取り図が届いた場合も祖先のライト配色を使う', async () => {
    const wrapper = mount(FloorPlan, {
      attachTo: themeHost('light'), props: { plan: undefined, places: [place] },
    });
    await wrapper.setProps({ plan });
    await nextTick();
    expect(wrapper.get('svg').element.style.getPropertyValue('--building-event')).toBe('#0f766e');
  });

  it('指定の形を描き、floorplanXY の位置に企画の円を重ねる', () => {
    const second = { ...place, id: 'event-2', location: { lat: 36.5, lng: 139.5 } };
    const wrapper = mount(FloorPlan, { props: { plan, places: [place, second] } });
    expect(wrapper.get('svg').attributes('viewBox')).toBe(plan.plan.viewBox);
    expect(wrapper.get('path').attributes('d')).toBe(plan.plan.d);
    const markers = wrapper.findAll('circle[role="button"]');
    expect(markers).toHaveLength(2);
    [place, second].forEach((item, index) => {
      const expected = floorplanXY(item.location, plan.bounds, plan.plan.viewBox);
      expect(Number(markers[index].attributes('cx'))).toBe(expected.x);
      expect(Number(markers[index].attributes('cy'))).toBe(expected.y);
      expect(markers[index].attributes('aria-label')).toBe(item.name);
      expect(markers[index].attributes('tabindex')).toBe('0');
    });
    expect(wrapper.get('svg').attributes('aria-label')).toContain('2階の見取り図');
    expect(wrapper.get('title').text()).toContain('円は企画の位置');
  });

  it.each(['click', 'keydown.enter', 'keydown.space'])('%s で企画の id を select に渡す', async (action) => {
    const wrapper = mount(FloorPlan, { props: { plan, places: [place] } });
    await wrapper.get('[role="button"]').trigger(action);
    expect(wrapper.emitted('select')).toEqual([[place.id]]);
  });

  it.each([
    { viewBox: '-20 10 240 120', width: 390 },
    { viewBox: '0 0 1200 600', width: 240 },
    { viewBox: '0 0 240 120', width: 120 },
  ])('viewBox=$viewBox、表示幅 $width px に縮小しても押下領域を44px以上に保つ', ({ viewBox, width }) => {
    const wrapper = mount(FloorPlan, {
      props: { plan: { ...plan, plan: { ...plan.plan, viewBox } }, places: [place] },
    });
    const marker = wrapper.get('.floor-plan__marker');
    const target = wrapper.get('circle[role="button"]');
    expect(target.attributes('cx')).toBe(marker.attributes('cx'));
    expect(target.attributes('cy')).toBe(marker.attributes('cy'));
    expect(target.attributes('r')).toBe(marker.attributes('r'));
    expect(marker.attributes('aria-hidden')).toBe('true');
    expect(marker.attributes('pointer-events')).toBe('none');
    expect(target.attributes('fill')).toBe('transparent');
    expect(target.attributes('stroke')).toBe('transparent');
    expect(target.attributes('pointer-events')).toBe('all');
    expect(target.attributes('vector-effect')).toBe('non-scaling-stroke');
    const scale = width / Number(viewBox.split(' ')[2]);
    // vector-effect により、線幅は viewBox の倍率の影響を受けない。
    const diameter = 2 * Number(target.attributes('r')) * scale + Number(target.attributes('stroke-width'));
    expect(diameter).toBeGreaterThanOrEqual(44);
    expect(wrapper.get('svg').attributes('overflow')).toBe('visible');
  });

  it('plan が無いとき SVG と印を出さない', async () => {
    const wrapper = mount(FloorPlan, { props: { plan: undefined, places: [place] } });
    expect(wrapper.find('svg').exists()).toBe(false);
    await wrapper.setProps({ plan });
    expect(wrapper.findAll('circle[role="button"]')).toHaveLength(1);
    await wrapper.setProps({ plan: undefined });
    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it('企画以外の設備と駐車場に企画の印を出さない', () => {
    const others = (['info', 'wc', 'rest', 'trash', 'parking'] as const)
      .map((kind) => ({ ...place, id: kind, kind }));
    const wrapper = mount(FloorPlan, { props: { plan, places: [place, ...others] } });
    expect(wrapper.findAll('circle[role="button"]')).toHaveLength(1);
    expect(wrapper.get('[role="button"]').attributes('aria-label')).toBe(place.name);
  });

  it('地下の見取り図の説明を付け、企画が空でも形を出す', () => {
    const wrapper = mount(FloorPlan, { props: { plan: { ...plan, floor: -1 }, places: [] } });
    expect(wrapper.get('svg').attributes('aria-label')).toContain('地下1階');
    expect(wrapper.find('path').exists()).toBe(true);
    expect(wrapper.find('circle').exists()).toBe(false);
  });
});
