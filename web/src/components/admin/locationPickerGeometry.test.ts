import { describe, expect, it } from 'vitest';
import { ORIGIN, fromXY } from '../../domain/geo';
import { getPickerBounds, inputToPoint, isPointInBounds, locationToPoint, outlinePath, pointToLocation } from './locationPickerGeometry';

describe('locationPickerGeometry', () => {
  it('データなしではORIGINを中心とする400m×200m', () => {
    const bounds = getPickerBounds([]);
    expect(bounds).toEqual({ west: -200, north: 100, width: 400, height: 200 });
    expect(pointToLocation({ x: 50, y: 50 }, bounds)).toEqual(ORIGIN);
  });

  it('小さいデータ範囲を最低400m×200mに拡張する', () => {
    const bounds = getPickerBounds([fromXY(40, 20), fromXY(60, 40)]);
    expect(bounds.width).toBe(400);
    expect(bounds.height).toBe(200);
    const center = locationToPoint(fromXY(50, 30), bounds);
    expect(center.x).toBeCloseTo(50, 8);
    expect(center.y).toBeCloseTo(50, 8);
  });

  it.each([[1000, 100, 1200], [100, 1000, 2400]])('データの広がり(%s, %s)mと周囲10%を含む', (x, y, width) => {
    const points = [fromXY(0, 0), fromXY(x, y)];
    const bounds = getPickerBounds(points);
    expect(bounds.width).toBeCloseTo(width, 7);
    expect(bounds.height).toBeCloseTo(width / 2, 7);
    for (const point of points) expect(isPointInBounds(locationToPoint(point, bounds))).toBe(true);
  });

  it.each([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 100, y: 0 }])('端の割合%jを北が上の座標に変換する', point => {
    const bounds = getPickerBounds([]);
    expect(pointToLocation(point, bounds)).toEqual(fromXY(-200 + point.x * 4, 100 - point.y * 2));
    expect(isPointInBounds(point)).toBe(true);
  });

  it('座標→割合→座標が許容誤差内で戻る', () => {
    const bounds = getPickerBounds([ORIGIN]);
    for (const location of [ORIGIN, fromXY(123, -45), fromXY(-180, 90)]) {
      const result = pointToLocation(locationToPoint(location, bounds), bounds);
      expect(result.lat).toBeCloseTo(location.lat, 10);
      expect(result.lng).toBeCloseTo(location.lng, 10);
    }
  });

  it('輪郭pathを生成し、頂点不足は描画しない', () => {
    const bounds = getPickerBounds([]);
    expect(outlinePath([fromXY(0, 0), fromXY(100, 0), fromXY(0, 50)], bounds)).toMatch(/^M .+ L .+ L .+ Z$/);
    expect(outlinePath([ORIGIN, ORIGIN], bounds)).toBe('');
  });

  it('空欄・不正な座標と範囲外を区別する', () => {
    const bounds = getPickerBounds([]);
    for (const [lat, lng] of [['', '139'], ['35', ' '], ['NaN', '139'], ['91', '139'], ['35', '181']]) {
      expect(inputToPoint(lat, lng, bounds)).toBeNull();
    }
    expect(isPointInBounds(inputToPoint('35', '139', bounds)!)).toBe(false);
    expect(isPointInBounds({ x: -1, y: 50 })).toBe(false);
    expect(isPointInBounds({ x: 50, y: 101 })).toBe(false);
  });
});
