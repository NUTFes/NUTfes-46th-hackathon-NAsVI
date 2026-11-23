import { describe, expect, it } from 'vitest';
import { bearingDeg, distanceM, fromXY, ORIGIN, toXY } from './geo';

describe('会場の座標変換', () => {
  it('原点は (0, 0) になる', () => {
    expect(toXY(ORIGIN.lat, ORIGIN.lng)).toEqual([0, 0]);
    expect(fromXY(0, 0)).toEqual(ORIGIN);
  });

  it.each([
    { lat: 37.426, lng: 138.78 },
    { lat: 37.424, lng: 138.777 },
    { lat: 37.4255, lng: 138.778 },
  ])('緯度経度を往復して元に戻す: %o', ({ lat, lng }) => {
    const point = fromXY(...toXY(lat, lng));
    expect(point.lat).toBeCloseTo(lat, 10);
    expect(point.lng).toBeCloseTo(lng, 10);
  });

  it.each([[100, 200], [-100, -200], [100, -200]])(
    '平面座標を往復して元に戻す: (%s, %s)',
    (x, y) => {
      const point = fromXY(x, y);
      const result = toXY(point.lat, point.lng);
      expect(result[0]).toBeCloseTo(x, 6);
      expect(result[1]).toBeCloseTo(y, 6);
    },
  );

  it('北へ 1 m 進むと y が +1 になる', () => {
    const [x, y] = toXY(ORIGIN.lat + 1 / 110540, ORIGIN.lng);
    expect(x).toBe(0);
    expect(y).toBeCloseTo(1, 6);
  });

  it('東へ進むと x が正になり、緯度による縮尺がかかる', () => {
    const [x, y] = toXY(ORIGIN.lat, ORIGIN.lng + 0.001);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeCloseTo(88.4045, 4);
    expect(y).toBe(0);
  });
});

describe('直線距離', () => {
  it('既知の緯度経度 2 点の距離をメートルで返す', () => {
    const point = { lat: 37.4262, lng: 138.7798 };
    expect(distanceM(ORIGIN, point)).toBeCloseTo(141.54, 2);
    expect(distanceM(point, ORIGIN)).toBeCloseTo(141.54, 2);
  });

  it('同じ地点の距離は 0 m', () => {
    expect(distanceM(ORIGIN, ORIGIN)).toBe(0);
  });

  it('原点以外の 2 点の差から距離を求める', () => {
    expect(distanceM(fromXY(40, -30), fromXY(100, 50))).toBeCloseTo(100, 6);
  });

  it.each([
    [0, 100], [100, 0], [0, -100], [-100, 0],
  ])('各方角への距離: (%s, %s)', (x, y) => {
    expect(distanceM(ORIGIN, fromXY(x, y))).toBeCloseTo(100, 6);
  });
});

describe('方角', () => {
  it('既知の緯度経度 2 点の方角を返す', () => {
    expect(bearingDeg(ORIGIN, { lat: 37.4262, lng: 138.7798 })).toBeCloseTo(38.65, 2);
  });

  it.each([
    ['北', 0, 100, 0],
    ['東', 100, 0, 90],
    ['南', 0, -100, 180],
    ['西', -100, 0, 270],
    ['北東', 100, 100, 45],
    ['南東', 100, -100, 135],
    ['南西', -100, -100, 225],
    ['北西', -100, 100, 315],
  ])('%s の方角は %s, %s の座標から求まる', (_name, x, y, expected) => {
    const bearing = bearingDeg(ORIGIN, fromXY(x, y));
    expect(bearing).toBeCloseTo(expected, 6);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });

  it('原点以外からも進行方向を求める', () => {
    expect(bearingDeg(fromXY(100, 100), fromXY(0, 200))).toBeCloseTo(315, 6);
  });
});
