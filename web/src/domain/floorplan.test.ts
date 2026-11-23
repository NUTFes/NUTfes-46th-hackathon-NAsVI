import { describe, expect, it } from 'vitest';
import type { FloorPlan } from '../types';
import { floorplanXY } from './floorplan';

const bounds: FloorPlan['bounds'] = { north: 38, south: 36, east: 140, west: 138 };
const viewBox: FloorPlan['plan']['viewBox'] = '-20 10 240 120';

describe('見取り図の座標換算', () => {
  it.each([
    ['北西', { lat: 38, lng: 138 }, { x: -20, y: 10 }],
    ['北東', { lat: 38, lng: 140 }, { x: 220, y: 10 }],
    ['南西', { lat: 36, lng: 138 }, { x: -20, y: 130 }],
    ['南東', { lat: 36, lng: 140 }, { x: 220, y: 130 }],
    ['中心', { lat: 37, lng: 139 }, { x: 100, y: 70 }],
  ])('%s を viewBox 上へ換算する', (_name, point, expected) => {
    expect(floorplanXY(point, bounds, viewBox)).toEqual(expected);
  });

  it('範囲外の点をクランプせず外挿する', () => {
    expect(floorplanXY({ lat: 39, lng: 137 }, bounds, viewBox)).toEqual({ x: -140, y: -50 });
    expect(floorplanXY({ lat: 35, lng: 141 }, bounds, viewBox)).toEqual({ x: 340, y: 190 });
  });

  it('viewBox の空白やカンマによる区切りを受け付ける', () => {
    expect(floorplanXY({ lat: 37, lng: 139 }, bounds, ' \t-20, 10\n240  120 '))
      .toEqual({ x: 100, y: 70 });
  });
});
