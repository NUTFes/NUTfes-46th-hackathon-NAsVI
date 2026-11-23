import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { fromXY, toXY } from '../../domain/geo';
import type { Landmark, Place } from '../../types';
import { project } from '../core';
import buildings, { buildingHeight, buildingHighlight, canvasSize, pointInPolygon, sortByDepth } from './buildings';
import type { Layer, MapState, View } from './types';

const view: View = { fx: 0, fy: 0, k: 2, th: 0, cy: 300 };
const square: [number, number][] = [[-20, -20], [20, -20], [20, 20], [-20, 20]];

function landmark(id: string, x = 0, y = 0): Landmark {
  return {
    id, name: id, location: fromXY(x, y), floors: [],
    footprint: square.map(([dx, dy]) => fromXY(x + dx, y + dy)),
  };
}

function place(id: string, overrides: Partial<Place> = {}): Place {
  return {
    id, name: id, kind: 'event', location: fromXY(0, 0), description: '',
    landmarkId: 'a', floor: null, hours: [], labelIds: [], ...overrides,
  };
}

function state(overrides: Partial<MapState> = {}): MapState {
  return {
    landmarks: [landmark('a')], places: [], stamps: [], position: null,
    destination: null, filter: { labelIds: [], tagIds: [] }, now: 0, ...overrides,
  };
}

function canvas(dpr = 1) {
  const fills: unknown[] = [];
  const widths: number[] = [];
  const fill = vi.fn();
  const stroke = vi.fn();
  const ctx = {
    canvas: { width: 400 * dpr, height: 600 * dpr },
    getTransform: () => ({ a: dpr, b: 0 }),
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), fill, stroke,
  } as unknown as CanvasRenderingContext2D;
  fill.mockImplementation(() => { fills.push(ctx.fillStyle); });
  stroke.mockImplementation(() => { widths.push(ctx.lineWidth); });
  return { ctx, fills, widths };
}

describe('buildingHeight', () => {
  it('外積和の半分を面積とし、モックの固定値で高さを求める', () => {
    // 面積 100 m²。外積和 200 をそのまま使う実装とは異なる値になる。
    expect(buildingHeight([[0, 0], [10, 0], [10, 10], [0, 10]])).toBeCloseTo(10.2, 10);
    expect(buildingHeight([[0, 0], [10, 0], [0, 10]])).toBeCloseTo(7 + Math.sqrt(50) * 0.32, 10);
  });

  it('反転・閉じた輪郭・平行移動でも同じ高さ', () => {
    expect(buildingHeight([...square].reverse())).toBe(buildingHeight(square));
    expect(buildingHeight([...square, square[0]])).toBe(buildingHeight(square));
    expect(buildingHeight(square.map(([x, y]) => [x + 100, y - 50]))).toBe(buildingHeight(square));
  });

  it('下限 7 m と上限 30 m を守る', () => {
    expect(buildingHeight([])).toBe(7);
    expect(buildingHeight([[0, 0], [10, 0], [20, 0]])).toBe(7);
    expect(buildingHeight([[0, 0], [1000, 0], [1000, 1000], [0, 1000]])).toBe(30);
  });
});

describe('sortByDepth', () => {
  it('投影の奥行きの大きい順にし、入力を変えない', () => {
    for (const th of [0, Math.PI / 2, Math.PI]) {
      const input = [[0, -10], [0, 10], [20, 0]].map(([x, y], id) => ({
        id, depth: project({ ...view, th }, 400, 600, x, y)[2],
      }));
      const before = structuredClone(input);
      const sorted = sortByDepth(input);
      expect(sorted[0].depth).toBe(Math.max(...input.map((p) => p.depth)));
      expect(sorted[2].depth).toBe(Math.min(...input.map((p) => p.depth)));
      expect(input).toEqual(before);
    }
  });

  it('同じ奥行きの順を保ち、空でも動く', () => {
    const a = { id: 'a', depth: 1 };
    const b = { id: 'b', depth: 1 };
    expect(sortByDepth([a, b])).toEqual([a, b]);
    expect(sortByDepth([])).toEqual([]);
  });
});

describe('pointInPolygon', () => {
  it.each<[number, number, boolean]>([
    [0, 0, true], [20, 0, true], [-20, -20, true], [21, 0, false], [0, -21, false],
  ])('(%s, %s) の内外と境界を判定する', (x, y, expected) => {
    expect(pointInPolygon(x, y, square)).toBe(expected);
    expect(pointInPolygon(x, y, [...square].reverse())).toBe(expected);
    expect(pointInPolygon(x, y, [...square, square[0]])).toBe(expected);
  });

  it('凹多角形のくぼみは外、斜めの辺の上は内', () => {
    const concave: [number, number][] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    expect(pointInPolygon(2, 8, concave)).toBe(true);
    expect(pointInPolygon(8, 8, concave)).toBe(false);
    expect(pointInPolygon(5, 5, [[0, 0], [10, 0], [0, 10]])).toBe(true);
  });

  it('頂点が 3 個未満なら当たらない', () => {
    expect(pointInPolygon(0, 0, [])).toBe(false);
    expect(pointInPolygon(0, 0, [[0, 0], [1, 0]])).toBe(false);
  });
});

describe('buildingHighlight', () => {
  it.each(['info', 'wc', 'rest', 'trash'] as const)('%s は企画ありにも行き先の建物強調にも使わない', (kind) => {
    const facility = place(kind, { kind });
    expect(buildingHighlight('a', [facility], facility)).toEqual({ isDest: false, isP: false });
    expect(buildingHighlight('a', [place('event'), facility], facility)).toEqual({ isDest: false, isP: true });
  });

  it('企画は所属する建物だけを強調する。行き先は絞り込み外でも強調する', () => {
    const event = place('event');
    expect(buildingHighlight('a', [event], event)).toEqual({ isDest: true, isP: true });
    expect(buildingHighlight('b', [event], event)).toEqual({ isDest: false, isP: false });
    expect(buildingHighlight('a', [], event)).toEqual({ isDest: true, isP: false });
  });
});

describe('buildings Layer', () => {
  it('Layer 型を満たし、スタブ ctx で壁 4 面と屋根を描く', () => {
    expectTypeOf(buildings).toMatchTypeOf<Layer>();
    expect(buildings.name).toBe('buildings');
    const { ctx, fills } = canvas();
    expect(() => buildings.draw(ctx, view, state(), 0)).not.toThrow();
    expect(fills).toEqual([
      ...Array(4).fill('rgba(70,30,140,.36)'), 'rgba(60,30,120,.9)',
    ]);
    expect(ctx.closePath).toHaveBeenCalledTimes(5);
  });

  it.each([1, 2, 3])('DPR=%s でも投影と hitTest は CSS ピクセル', (dpr) => {
    const { ctx } = canvas(dpr);
    expect(canvasSize(ctx)).toEqual({ width: 400, height: 600 });
    const data = state();
    buildings.draw(ctx, view, data, 0);
    const hgt = buildingHeight(data.landmarks[0].footprint!.map((p) => toXY(p.lat, p.lng)));
    const [x, y] = project(view, 400, 600, 0, 0, hgt);
    expect(buildings.hitTest!(x, y)).toEqual({ kind: 'building', id: 'a' });
    // 地面の下端は屋根に入らない(壁だけでは選べない)。
    const [bx, by] = project(view, 400, 600, 0, -20);
    expect(buildings.hitTest!(bx, by)).toBeNull();
  });

  it('奥から描き、重なった屋根は手前の建物を選ぶ', () => {
    const { ctx, fills } = canvas();
    const near = landmark('near', 0, -5);
    const far = landmark('far', 0, 5);
    buildings.draw(ctx, view, state({
      landmarks: [near, far],
      places: [place('near-event', { landmarkId: 'near' }), place('far-event', { landmarkId: 'far' })],
      destination: { placeId: 'far-event' },
    }), 0);
    expect(fills[4]).toBe('#ffd84a');
    expect(fills[9]).toBe('#10b981');
    const [x, y] = project(view, 400, 600, 0, 0, buildingHeight(square));
    expect(buildings.hitTest!(x, y)).toEqual({ kind: 'building', id: 'near' });
  });

  it('null の輪郭は描かず、描き直すたびに以前の屋根を捨てる', () => {
    const { ctx, fills } = canvas();
    buildings.draw(ctx, view, state(), 0);
    const [x, y] = project(view, 400, 600, 0, 0, buildingHeight(square));
    expect(buildings.hitTest!(x, y)).not.toBeNull();
    fills.length = 0;
    buildings.draw(ctx, view, state({ landmarks: [{ ...landmark('a'), footprint: null }] }), 1);
    expect(fills).toEqual([]);
    expect(buildings.hitTest!(x, y)).toBeNull();
    buildings.draw(ctx, view, state(), 2);
    buildings.draw(ctx, { ...view, fx: 1000 }, state(), 3);
    expect(buildings.hitTest!(x, y)).toBeNull();
    buildings.draw(ctx, view, state({ landmarks: [] }), 4);
    expect(buildings.hitTest!(x, y)).toBeNull();
  });

  it.each(['info', 'wc', 'rest', 'trash'] as const)('%s が残っても絞り込み外の建物は企画色や行き先色にならない', (kind) => {
    const { ctx, fills } = canvas();
    buildings.draw(ctx, view, state({
      places: [place('hidden', { labelIds: ['other'] }), place('facility', { kind })],
      destination: { placeId: 'facility' }, filter: { labelIds: ['selected'], tagIds: [] },
    }), 0);
    expect(fills[4]).toBe('rgba(60,30,120,.9)');
  });

  it('labelIds で絞り、MapState にリンクのない tagIds は適用しない', () => {
    const { ctx, fills } = canvas();
    const data = state({ places: [place('event', { labelIds: ['selected'] })],
      filter: { labelIds: ['selected'], tagIds: ['unknown-tag'] } });
    buildings.draw(ctx, view, data, 0);
    expect(fills[4]).toBe('#10b981');
    fills.length = 0;
    buildings.draw(ctx, view, { ...data, filter: { labelIds: ['other'], tagIds: [] } }, 1);
    expect(fills[4]).toBe('rgba(60,30,120,.9)');
  });

  it.each([[0.5, 0.6], [2, 0.9], [10, 1.3]])('倍率 %s の線幅は %s', (k, expected) => {
    const { ctx, widths } = canvas();
    buildings.draw(ctx, { ...view, k }, state(), 0);
    expect(widths).toEqual(Array(5).fill(expected));
  });
});
