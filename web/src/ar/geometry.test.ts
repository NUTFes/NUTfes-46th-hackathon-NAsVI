// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromXY, toXY } from '../domain/geo';
import type { Landmark, Place } from '../types';
import {
  castRay,
  DEFAULT_LONG_FOV_DEG,
  describePlaces,
  describeTarget,
  FRONT_MAX_M,
  pickFront,
  RAY_MIN_T,
  VERTEX_MARGIN_M,
  VERTEX_MIN_DIST_M,
  visibility,
  wrap180,
} from './geometry';
import { buildings, eastBuilding, northBuilding, places, shapelessBuilding } from './fixtures/buildings';

const pos = fromXY(0, 0);

function rectangle(id: string, left: number, bottom: number, right: number, top: number): Landmark {
  return {
    id,
    name: id,
    location: fromXY((left + right) / 2, (bottom + top) / 2),
    footprint: [[left, bottom], [right, bottom], [right, top], [left, top]]
      .map(([x, y]) => fromXY(x, y)),
    floors: [],
  };
}

function outdoor(x: number, y: number): Place {
  return { ...places[2], location: fromXY(x, y) };
}

describe('AR の依存と初期値', () => {
  it('DOM に触れる API に依存しない', () => {
    const source = readFileSync(new URL('./geometry.ts', import.meta.url), 'utf8');
    for (const word of ['document', 'window', 'fetch', 'navigator', 'localStorage']) {
      expect(source).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it('PR #4 の通常版に合わせた仮置きの距離と画角を保つ', () => {
    expect([
      RAY_MIN_T, FRONT_MAX_M,
      VERTEX_MARGIN_M, VERTEX_MIN_DIST_M, DEFAULT_LONG_FOV_DEG,
    ]).toEqual([0.5, 300, 1.5, 1, 65]);
  });
});

describe('正面の建物', () => {
  it.each([
    [0, northBuilding, 10],
    [90, eastBuilding, 15],
    [360, northBuilding, 10],
    [-270, eastBuilding, 15],
  ])('方位 %s° の建物と交点までの距離を返す', (heading, building, distance) => {
    const hit = pickFront(pos, heading, buildings);
    expect(hit?.building).toBe(building);
    expect(hit?.distance).toBeCloseTo(distance, 6);
  });

  it('原点以外の現在地からも計算する', () => {
    expect(pickFront(fromXY(0, -10), 0, buildings)?.distance).toBeCloseTo(20, 6);
  });

  it.each([0, 90, 180, 270])('輪郭の内側から方位 %s° に出る辺に当たる', heading => {
    const hit = pickFront(fromXY(0, 15), heading, buildings);
    expect(hit?.building).toBe(northBuilding);
    expect(hit?.distance).toBeCloseTo(5, 6);
  });

  it('手前の輪郭なしの建物を飛ばして奥の北棟を選ぶ', () => {
    expect(pickFront(pos, 0, buildings)?.building).toBe(northBuilding);
    expect(pickFront(pos, 0, [shapelessBuilding])).toBeNull();
  });

  it.each([180, 270, 45])('方位 %s° に建物がなければ null', heading => {
    expect(pickFront(pos, heading, buildings)).toBeNull();
  });

  it('最大距離より先の建物を選ばない', () => {
    expect(pickFront(fromXY(0, -FRONT_MAX_M), 0, buildings)).toBeNull();
    expect(pickFront(pos, 0, [])).toBeNull();
  });
});

describe('レイと輪郭の交差', () => {
  it('平行な縦辺を飛ばし、横辺までの距離を返す', () => {
    const hit = castRay([0, 0], 0, 1, 100, buildings);
    expect(hit?.building).toBe(northBuilding);
    expect(hit?.distance).toBeCloseTo(10, 6);
  });

  it('最後の頂点から最初の頂点への辺も調べる', () => {
    const hit = castRay([-20, 15], 1, 0, 100, buildings);
    expect(hit?.building).toBe(northBuilding);
    expect(hit?.distance).toBeCloseTo(15, 6);
  });

  it('建物の順序によらず最も近い交点を選ぶ', () => {
    const far = rectangle('far', -5, 30, 5, 40);
    for (const ordered of [[far, northBuilding], [northBuilding, far]]) {
      expect(castRay([0, 0], 0, 1, 100, ordered)?.building).toBe(northBuilding);
    }
  });

  it('maxT と同距離の交点は含めない', () => {
    const hit = castRay([0, 0], 0, 1, 100, [northBuilding])!;
    expect(castRay([0, 0], 0, 1, hit.distance, [northBuilding])).toBeNull();
    expect(castRay([0, 0], 0, 1, hit.distance + 0.01, [northBuilding])?.distance)
      .toBeCloseTo(10, 6);
  });

  it('最小距離以下の交点と、現在地での交点を除外する', () => {
    const vertex = northBuilding.footprint![0];
    const [, bottom] = toXY(vertex.lat, vertex.lng);
    for (const gap of [0, RAY_MIN_T / 2, RAY_MIN_T]) {
      expect(castRay([0, bottom - gap], 0, 1, 5, [northBuilding])).toBeNull();
    }
    expect(castRay([0, bottom - RAY_MIN_T - 0.01], 0, 1, 5, [northBuilding])?.distance)
      .toBeCloseTo(RAY_MIN_T + 0.01, 6);
    expect(castRay([0, bottom], 0, 1, 100, [northBuilding])?.distance).toBeCloseTo(10, 6);
  });

  it('辺の延長線上やレイの後方にある交点は含めない', () => {
    expect(castRay([6, 0], 0, 1, 100, [northBuilding])).toBeNull();
    expect(castRay([0, 0], 0, -1, 100, [northBuilding])).toBeNull();
  });

  it('頂点への交差を含め、同一直線の平行辺は飛ばす', () => {
    const vertex = northBuilding.footprint![0];
    const [left] = toXY(vertex.lat, vertex.lng);
    expect(castRay([left, 0], 0, 1, 100, [northBuilding])?.distance).toBeCloseTo(10, 6);
  });
});

describe('可視頂点と anchor', () => {
  it('輪郭の内側でも自身の頂点を可視とし、その平均を返す', () => {
    const result = visibility(fromXY(0, 15), northBuilding, buildings);
    expect(result.occluded).toBe(false);
    expect(result.anchor?.[0]).toBeCloseTo(0, 6);
    expect(result.anchor?.[1]).toBeCloseTo(15, 6);
    expect(result.nearD).toBeCloseTo(Math.hypot(5, 5), 6);
    expect(result.span?.[0]).toBeCloseTo(-135, 6);
    expect(result.span?.[1]).toBeCloseTo(135, 6);
    expect(describePlaces(fromXY(0, 15), [places[0]], buildings)[0])
      .toMatchObject({ ...result, place: places[0], distance: expect.closeTo(0, 6) });
  });

  it('自身の輪郭への衝突は遮蔽にせず、全可視頂点の平均を返す', () => {
    const result = visibility(pos, northBuilding, buildings);
    expect(result.occluded).toBe(false);
    expect(result.anchor?.[0]).toBeCloseTo(0, 6);
    expect(result.anchor?.[1]).toBeCloseTo(15, 6);
    expect(result.nearD).toBeCloseTo(Math.hypot(5, 10), 6);
    const halfSpan = Math.atan2(5, 10) * 180 / Math.PI;
    expect(result.span?.[0]).toBeCloseTo(-halfSpan, 6);
    expect(result.span?.[1]).toBeCloseTo(halfSpan, 6);
  });

  it('北棟の奥の建物はすべての頂点が遮蔽される', () => {
    const far = rectangle('far', -5, 30, 5, 40);
    expect(visibility(pos, far, [...buildings, far]))
      .toEqual({ occluded: true, anchor: null, span: null, nearD: null });
  });

  it('部分的に遮蔽されると見える頂点だけで集計する', () => {
    const partial = rectangle('partial', 10, 30, 30, 40);
    const result = visibility(pos, partial, [...buildings, partial]);
    expect(result.occluded).toBe(false);
    expect(result.anchor?.[0]).toBeCloseTo(30, 6);
    expect(result.anchor?.[1]).toBeCloseTo(35, 6);
    expect(result.nearD).toBeCloseTo(Math.hypot(30, 30), 6);
    const anchorBearing = Math.atan2(30, 35) * 180 / Math.PI;
    expect(result.span?.[0]).toBeCloseTo(Math.atan2(30, 40) * 180 / Math.PI - anchorBearing, 6);
    expect(result.span?.[1]).toBeCloseTo(45 - anchorBearing, 6);
  });

  it('点の手前 1.5 m 以内の輪郭にはレイを伸ばさない', () => {
    expect(visibility(pos, outdoor(0, 11), buildings).occluded).toBe(false);
    expect(visibility(pos, outdoor(0, 12), buildings).occluded).toBe(true);
  });

  it('1 m 未満の点は除外し、見える点がなければ anchor は null', () => {
    expect(visibility(pos, outdoor(0, 0.5), []))
      .toEqual({ occluded: true, anchor: null, span: null, nearD: null });
    expect(visibility(pos, outdoor(0, 1.01), []).occluded).toBe(false);
    expect(visibility(pos, shapelessBuilding, buildings).anchor).toBeNull();
  });
});

describe('位置と企画の記述', () => {
  it.each([
    [0, 10, 0], [10, 0, 90], [0, -10, 180], [-10, 0, 270],
  ])('位置 (%s, %s) への絶対方位は %s°', (x, y, bearing) => {
    for (const target of [fromXY(x, y), [x, y] as const]) {
      const result = describeTarget(pos, target, true);
      expect(result.distance).toBeCloseTo(10, 6);
      expect(result.bearing).toBeCloseTo(bearing, 6);
      expect(result.bearing).toBeGreaterThanOrEqual(0);
      expect(result.bearing).toBeLessThan(360);
      expect(result.occluded).toBe(true);
    }
  });

  it('同じ位置への距離と方位は 0', () => {
    expect(describeTarget(pos, pos)).toEqual({ distance: 0, bearing: 0, occluded: false });
  });

  it('所属建物、遮蔽された企画、屋外、輪郭なしを入力順に記述する', () => {
    const result = describePlaces(pos, places, buildings);
    expect(result.map(item => item.place)).toEqual(places);
    expect(result.map(item => item.occluded)).toEqual([false, true, false, false]);
    expect(result[0].distance).toBeCloseTo(15, 6);
    expect(result[0].bearing).toBeCloseTo(0, 6);
    expect(result[0].nearD).toBeCloseTo(Math.hypot(5, 10), 6);
    expect(result[1]).toMatchObject({ anchor: null, span: null, nearD: null });
    expect(result[1].distance).toBeCloseTo(30, 6);
    expect(result[2].distance).toBeCloseTo(10, 6);
    expect(result[2].bearing).toBeCloseTo(180, 6);
    expect(result[2].nearD).toBeNull();
    expect(result[2].span).toEqual([0, 0]);
    expect(result[3].distance).toBeCloseTo(5, 6);
    expect(result[3].nearD).toBeNull();
  });

  it('所属建物が一覧にない場合も企画の位置で判定する', () => {
    const place = { ...outdoor(0, -10), landmarkId: 'missing' };
    expect(describePlaces(pos, [place], buildings)[0].occluded).toBe(false);
    expect(describePlaces(pos, [], buildings)).toEqual([]);
  });

  it('同じ建物の企画は同じ可視頂点を使う', () => {
    const second = { ...places[0], id: 'second', location: fromXY(0, 19) };
    const [a, b] = describePlaces(pos, [places[0], second], buildings);
    expect(a.anchor).toEqual(b.anchor);
    expect(a.distance).toBe(b.distance);
  });

  it('入力の位置・建物・企画を変更しない', () => {
    const before = JSON.stringify({ pos, buildings, places });
    pickFront(pos, 0, buildings);
    visibility(pos, northBuilding, buildings);
    describePlaces(pos, places, buildings);
    expect(JSON.stringify({ pos, buildings, places })).toBe(before);
  });
});

describe('非有限値の入力', () => {
  const hidden = { occluded: true, anchor: null, span: null, nearD: null };

  it.each([NaN, Infinity, -Infinity])('現在地の値 %s を可視として扱わない', value => {
    for (const invalidPos of [{ ...pos, lat: value }, { ...pos, lng: value }]) {
      expect(pickFront(invalidPos, 0, buildings)).toBeNull();
      for (const target of [northBuilding, places[2], shapelessBuilding]) {
        expect(visibility(invalidPos, target, buildings)).toEqual(hidden);
      }
      expect(describePlaces(invalidPos, places, buildings)).toEqual(places.map(place => ({
        place,
        distance: Infinity,
        bearing: 0,
        ...hidden,
      })));
      expect(describePlaces(invalidPos, [], buildings)).toEqual([]);
    }
  });

  it.each([NaN, Infinity, -Infinity])('向き %s では正面の建物を選ばない', heading => {
    expect(pickFront(pos, heading, buildings)).toBeNull();
  });
});

describe('方位差の折り返し', () => {
  it.each([
    [0, 0], [180, -180], [-180, -180], [359, -1], [-359, 1], [360, 0],
  ])('%s° を %s° にする', (angle, expected) => {
    expect(wrap180(angle)).toBe(expected);
  });
});
