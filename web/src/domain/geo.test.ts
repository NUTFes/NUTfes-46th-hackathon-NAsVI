import { describe, expect, it } from 'vitest';
import { fromXY, ORIGIN, toXY } from './geo';

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
