import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import tokenSource from '../../../../design-system/tokens.json?raw';
import { fromXY, toXY } from '../../domain/geo';
import type { Landmark, Place } from '../../types';
import { project, TILT } from '../core';
import buildings, { buildingHighlight, canvasSize, mapColors, planColors, pointInPolygon, resolveColors, sortByDepth } from './buildings';
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
  const alphas: number[] = [];
  const strokes: unknown[] = [];
  const fill = vi.fn();
  const stroke = vi.fn();
  const ctx = {
    canvas: { width: 400 * dpr, height: 600 * dpr },
    getTransform: () => ({ a: dpr, b: 0 }),
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), ellipse: vi.fn(), fill, stroke,
  } as unknown as CanvasRenderingContext2D;
  fill.mockImplementation(() => { fills.push(ctx.fillStyle); alphas.push(ctx.globalAlpha); });
  stroke.mockImplementation(() => { widths.push(ctx.lineWidth); strokes.push(ctx.strokeStyle); });
  return { ctx, fills, widths, alphas, strokes };
}

describe('mapColors / resolveColors', () => {
  it('トークン名をキーとし、両テーマの値が design-system の出典と一致する', () => {
    expect(Object.keys(mapColors).sort()).toEqual([
      'destination', 'destination-border', 'destination-on', 'event', 'event-on',
      'parking', 'parking-on', 'facility', 'facility-on', 'map-ring', 'bg-surface', 'border-subtle',
      'text-primary', 'text-disabled',
    ].sort());
    const tokens = JSON.parse(tokenSource);
    // Vitest は CSS import を空にするため、出典のファイルを直接読む。
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),
      '../../../../design-system/claude-design/tokens.css'), 'utf8');
    for (const theme of ['dark', 'light'] as const) {
      for (const [key, colors] of Object.entries(mapColors)) {
        const value: string | { hex: string } = tokens.color[theme][key].$value;
        if (typeof value === 'string') {
          const [, , hue, shade] = value.slice(1, -1).split('.');
          expect(colors[theme]).toBe(tokens.color.palette[hue][shade].$value.hex);
          expect(css).toContain(`--${hue === 'white' ? 'white' : `${hue}-${shade}`}: ${colors[theme]};`);
        } else {
          // border-subtle は alpha を含むトークン。Canvas 用定数には hex だけを保存する。
          expect(colors[theme]).toBe(value.hex);
        }
        expect(colors[theme]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it.each(['dark', 'light'] as const)('最寄りの data-theme=%s を解決し、描き直し時に切り替える', (theme) => {
    const { ctx, fills } = canvas();
    const outer = document.createElement('div');
    outer.setAttribute('data-theme', theme === 'light' ? 'dark' : 'light');
    const inner = document.createElement('div');
    inner.setAttribute('data-theme', theme);
    const element = document.createElement('canvas');
    outer.append(inner);
    inner.append(element);
    Object.defineProperty(ctx, 'canvas', { value: element });
    const expected = Object.fromEntries(Object.entries(mapColors).map(([key, values]) => [key, values[theme]]));
    expect(resolveColors(ctx)).toEqual(expected);
    buildings.draw(ctx, view, state({ places: [place('event')] }), 0);
    expect(fills[0]).toBe(mapColors.event[theme]);
    const next = theme === 'dark' ? 'light' : 'dark';
    inner.setAttribute('data-theme', next);
    buildings.draw(ctx, view, state({ places: [place('event')] }), 1);
    expect(fills[1]).toBe(mapColors.event[next]);
  });

  it.each([undefined, null, '', 'unknown', 'dark'])('closest の結果が %s ならダークにする', (theme) => {
    const { ctx } = canvas();
    if (theme !== undefined) {
      ctx.canvas.closest = vi.fn().mockReturnValue(theme === null ? null : { getAttribute: () => theme });
    }
    expect(resolveColors(ctx)).toEqual(Object.fromEntries(
      Object.entries(mapColors).map(([key, values]) => [key, values.dark]),
    ));
    if (theme !== undefined) expect(ctx.canvas.closest).toHaveBeenCalledWith('[data-theme]');
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
  it('初回 draw 前は当たり判定が空', async () => {
    vi.resetModules();
    const { default: fresh } = await import('./buildings');
    expect(fresh.hitTest!(200, 300)).toBeNull();
  });

  it('Layer 型を満たし、スタブ ctx で平面の輪郭を 1 つだけ描く', () => {
    expectTypeOf(buildings).toMatchTypeOf<Layer>();
    expect(buildings.name).toBe('buildings');
    const { ctx, fills } = canvas();
    expect(() => buildings.draw(ctx, view, state(), 0)).not.toThrow();
    expect(fills).toEqual([planColors.fill.dark]);
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2, 3])('DPR=%s でも投影と hitTest は CSS ピクセル', (dpr) => {
    const { ctx } = canvas(dpr);
    expect(canvasSize(ctx)).toEqual({ width: 400, height: 600 });
    const data = state();
    buildings.draw(ctx, view, data, 0);
    const [x, y] = project(view, 400, 600, 0, 0);
    expect(buildings.hitTest!(x, y)).toEqual({ kind: 'building', id: 'a' });
    // 平面の輪郭の辺も選べる。
    const edge = data.landmarks[0].footprint!.slice(0, 2).map((p) =>
      project(view, 400, 600, ...toXY(p.lat, p.lng)));
    const bx = (edge[0][0] + edge[1][0]) / 2;
    const by = (edge[0][1] + edge[1][1]) / 2;
    expect(buildings.hitTest!(bx, by)).toEqual({ kind: 'building', id: 'a' });
  });

  it.each([0, Math.PI / 2, Math.PI])('回転 %s でも平面の輪郭の内側・頂点が当たり、輪郭から離れた点は当たらない', (th) => {
    const { ctx } = canvas();
    const rotated = { ...view, th };
    const data = state();
    buildings.draw(ctx, rotated, data, 0);
    const points = data.landmarks[0].footprint!.map((p) => toXY(p.lat, p.lng));
    const base = points.map(([x, y]) => project(rotated, 400, 600, x, y));
    const [cx, cy] = project(rotated, 400, 600, 0, 0);
    expect(buildings.hitTest!(cx, cy)).toEqual({ kind: 'building', id: 'a' });
    for (const [x, y] of base) expect(buildings.hitTest!(x, y)).toEqual({ kind: 'building', id: 'a' });
    const outside = project(rotated, 400, 600, 100, 100);
    expect(pointInPolygon(outside[0], outside[1], base.map(([x, y]): [number, number] => [x, y]))).toBe(false);
    expect(buildings.hitTest!(outside[0], outside[1])).toBeNull();
  });

  it('平面: z を付けず project(z=0) の頂点だけを結び、輪郭の線は 1 本(壁・屋根の別描きなし)', () => {
    const { ctx } = canvas();
    buildings.draw(ctx, { ...view, th: 0.7 }, state(), 0);
    const base = square.map(([x, y]) => project({ ...view, th: 0.7 }, 400, 600, x, y));
    const moves = vi.mocked(ctx.moveTo).mock.calls;
    const lines = vi.mocked(ctx.lineTo).mock.calls;
    expect(moves).toHaveLength(1);
    const drawn = [moves[0], ...lines];
    expect(drawn).toHaveLength(base.length);
    drawn.forEach((d, i) => { expect(d[0]).toBeCloseTo(base[i][0], 4); expect(d[1]).toBeCloseTo(base[i][1], 4); });
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('planColors: ダークは ink-700 の塗りと violet-400 の縁、ライトの塗りは bg-surface', () => {
    const tokens = JSON.parse(tokenSource);
    expect(planColors.fill.dark).toBe('#2a1650');
    expect(planColors.edge.dark).toBe('#a78bfa');
    expect(planColors.fill.light).toBe(mapColors['bg-surface'].light);
    expect(planColors.edge.light).toBe(tokens.color.palette.violet['400'].$value.hex);
  });

  it.each(['dark', 'light'] as const)('通常の建物の塗り・縁は planColors(%s)', (theme) => {
    const { ctx, fills, strokes } = canvas();
    const el = document.createElement('div');
    el.setAttribute('data-theme', theme);
    const element = document.createElement('canvas');
    el.append(element);
    Object.defineProperty(ctx, 'canvas', { value: element });
    buildings.draw(ctx, view, state(), 0);
    expect(fills).toEqual([planColors.fill[theme]]);
    expect(strokes).toEqual([planColors.edge[theme]]);
  });

  it.each([1, 2, 3])('輪郭なしの建物では buildings は何も描かず、押下領域も持たない(BuildingFlag と二重にしない) (DPR=%s)', (dpr) => {
    const { ctx, fills, strokes } = canvas(dpr);
    const event = place('event', { location: fromXY(60, -30), labelIds: ['show'] });
    const data = state({
      landmarks: [{ ...landmark('a'), footprint: null }], places: [event],
      destination: { placeId: 'event' },
    });
    buildings.draw(ctx, view, data, 0);
    const [wx, wy] = toXY(event.location.lat, event.location.lng);
    const [x, y] = project(view, 400, 600, wx, wy);
    expect(ctx.ellipse).not.toHaveBeenCalled();
    expect(fills).toEqual([]);
    expect(strokes).toEqual([]);
    expect(buildings.hitTest!(x, y)).toBeNull();
  });

  it.each(['info', 'wc', 'rest', 'trash', 'parking'] as const)('輪郭なしでも %s の印を buildings では重複描画しない', (kind) => {
    const { ctx, fills } = canvas();
    buildings.draw(ctx, view, state({
      landmarks: [{ ...landmark('a'), footprint: null }], places: [place(kind, { kind })],
      destination: { placeId: kind },
    }), 0);
    expect(fills).toEqual([]);
    expect(buildings.hitTest!(200, 300)).toBeNull();
  });

  it.each([false, true])('通常終了・描画例外でも save/restore が対応し、alpha・色・線幅を復元する (例外=%s)', (fail) => {
    const { ctx } = canvas();
    const before = { globalAlpha: 0.63, fillStyle: '#123456', strokeStyle: '#abcdef', lineWidth: 7 };
    Object.assign(ctx, before);
    const stack: typeof before[] = [];
    vi.mocked(ctx.save).mockImplementation(() => { stack.push({
      globalAlpha: ctx.globalAlpha, fillStyle: String(ctx.fillStyle),
      strokeStyle: String(ctx.strokeStyle), lineWidth: ctx.lineWidth,
    }); });
    vi.mocked(ctx.restore).mockImplementation(() => { Object.assign(ctx, stack.pop()); });
    if (fail) vi.mocked(ctx.fill).mockImplementationOnce(() => { throw new Error('描画失敗'); });
    const draw = () => buildings.draw(ctx, view, state(), 0);
    if (fail) expect(draw).toThrow('描画失敗');
    else expect(draw).not.toThrow();
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(stack).toEqual([]);
    expect(ctx).toMatchObject(before);
  });

  it('解決済み hex と描画時の alpha を分けて平面を描く', () => {
    const { ctx, alphas } = canvas();
    buildings.draw(ctx, view, state(), 0);
    expect(alphas).toEqual([1]);
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
    expect(fills[0]).toBe(mapColors.destination.dark);
    expect(fills[1]).toBe(mapColors.event.dark);
    const [x, y] = project(view, 400, 600, 0, 0);
    expect(buildings.hitTest!(x, y)).toEqual({ kind: 'building', id: 'near' });
  });

  it('企画のない null の輪郭は描かず、描き直すたびに以前の当たり判定を捨てる', () => {
    const { ctx, fills } = canvas();
    buildings.draw(ctx, view, state(), 0);
    const [x, y] = project(view, 400, 600, 0, 0);
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
    expect(fills[0]).toBe(planColors.fill.dark);
  });

  it('labelIds で絞り、MapState にリンクのない tagIds は適用しない', () => {
    const { ctx, fills } = canvas();
    const data = state({ places: [place('event', { labelIds: ['selected'] })],
      filter: { labelIds: ['selected'], tagIds: ['unknown-tag'] } });
    buildings.draw(ctx, view, data, 0);
    expect(fills[0]).toBe(mapColors.event.dark);
    fills.length = 0;
    buildings.draw(ctx, view, { ...data, filter: { labelIds: ['other'], tagIds: [] } }, 1);
    expect(fills[0]).toBe(planColors.fill.dark);
  });

  it.each([[0.5, 0.6], [2, 0.9], [10, 1.3]])('倍率 %s の線幅は %s', (k, expected) => {
    const { ctx, widths } = canvas();
    buildings.draw(ctx, { ...view, k }, state(), 0);
    expect(widths).toEqual([expected]);
  });
});
