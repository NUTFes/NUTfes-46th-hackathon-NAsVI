import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import source from './FloorPlan.vue?raw';
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
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('コンポーネントからの通信は禁止'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('FloorPlan', () => {
  it('色は --app-* だけを参照し、旧 --building-* を使わない', () => {
    const wrapper = mount(FloorPlan, { props: { plan, places: [place] } });
    expect(wrapper.get('svg').element.style.getPropertyValue('--building-bg-page')).toBe('');
    expect(source).not.toContain('--building-');
    for (const token of ['--app-event', '--app-facility', '--app-facility-on', '--app-map-ring', '--app-bg-surface']) {
      expect(source).toContain(`var(${token})`);
    }
  });

  it('右上に「階・見取り図は仮」の札を出す', async () => {
    const wrapper = mount(FloorPlan, { props: { plan, places: [] } });
    expect(wrapper.get('.floor-plan__note').text()).toBe('2階・見取り図は仮');
    await wrapper.setProps({ plan: { ...plan, floor: -1 } });
    expect(wrapper.get('.floor-plan__note').text()).toBe('地下1階・見取り図は仮');
  });

  it('設備を白い丸とアイコンの印で出し、位置は floorplanXY の割合に合わせる', () => {
    const wc = { ...place, id: 'wc-1', name: '1号館のトイレ', kind: 'wc' as const, location: { lat: 37, lng: 139 } };
    const parking = { ...place, id: 'p', kind: 'parking' as const };
    const wrapper = mount(FloorPlan, { props: { plan, places: [place], facilities: [wc, parking, place] } });
    const marks = wrapper.findAll('.floor-plan__facility');
    expect(marks).toHaveLength(1);
    expect(marks[0].attributes('role')).toBe('img');
    expect(marks[0].attributes('aria-label')).toBe('1号館のトイレ');
    expect(marks[0].find('svg').exists()).toBe(true);
    expect(marks[0].attributes('style')).toContain('left: 50%');
    expect(marks[0].attributes('style')).toContain('top: 50%');
    expect(wrapper.findAll('[role="button"]')).toHaveLength(1);
  });

  it('企画の印に触れるかフォーカスすると名前の吹き出しを出し、離れると消す', async () => {
    const wrapper = mount(FloorPlan, { props: { plan, places: [place] } });
    expect(wrapper.find('.floor-plan__bubble').exists()).toBe(false);
    const target = wrapper.get('[role="button"]');
    await target.trigger('focus');
    expect(wrapper.get('.floor-plan__bubble').text()).toBe('お化け屋敷');
    expect(wrapper.get('.floor-plan__bubble').attributes('aria-hidden')).toBe('true');
    await target.trigger('blur');
    expect(wrapper.find('.floor-plan__bubble').exists()).toBe(false);
    await target.trigger('pointerenter');
    expect(wrapper.find('.floor-plan__bubble').exists()).toBe(true);
    await target.trigger('pointerleave');
    expect(wrapper.find('.floor-plan__bubble').exists()).toBe(false);
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
    const wrapper = mount(FloorPlan, { props: { plan: undefined, places: [place], facilities: [] } });
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.find('.floor-plan__note').exists()).toBe(false);
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
