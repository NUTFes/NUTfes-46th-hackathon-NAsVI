import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
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

  it('plan が無いとき SVG と印を出さない', async () => {
    const wrapper = mount(FloorPlan, { props: { plan: undefined, places: [place] } });
    expect(wrapper.find('svg').exists()).toBe(false);
    await wrapper.setProps({ plan });
    expect(wrapper.findAll('circle')).toHaveLength(1);
    await wrapper.setProps({ plan: undefined });
    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it('企画以外の設備と駐車場に企画の印を出さない', () => {
    const others = (['info', 'wc', 'rest', 'trash', 'parking'] as const)
      .map((kind) => ({ ...place, id: kind, kind }));
    const wrapper = mount(FloorPlan, { props: { plan, places: [place, ...others] } });
    expect(wrapper.findAll('circle')).toHaveLength(1);
    expect(wrapper.get('[role="button"]').attributes('aria-label')).toBe(place.name);
  });

  it('地下の見取り図の説明を付け、企画が空でも形を出す', () => {
    const wrapper = mount(FloorPlan, { props: { plan: { ...plan, floor: -1 }, places: [] } });
    expect(wrapper.get('svg').attributes('aria-label')).toContain('地下1階');
    expect(wrapper.find('path').exists()).toBe(true);
    expect(wrapper.find('circle').exists()).toBe(false);
  });
});
