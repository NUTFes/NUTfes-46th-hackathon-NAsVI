import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import tokenSource from '../../../../design-system/tokens.json?raw';
import { fromXY, toXY } from '../../domain/geo';
import type { Landmark, Place } from '../../types';
import { project, TILT } from '../core';
import buildings, { buildingHeight, buildingHighlight, canvasSize, mapColors, pointInPolygon, resolveColors, sortByDepth } from './buildings';
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
    expect(fills[4]).toBe(mapColors.event[theme]);
    const next = theme === 'dark' ? 'light' : 'dark';
    inner.setAttribute('data-theme', next);
    buildings.draw(ctx, view, state({ places: [place('event')] }), 1);
    expect(fills[9]).toBe(mapColors.event[next]);
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
  it('初回 draw 前は当たり判定が空', async () => {
    vi.resetModules();
    const { default: fresh } = await import('./buildings');
    expect(fresh.hitTest!(200, 300)).toBeNull();
  });

  it('Layer 型を満たし、スタブ ctx で壁 4 面と屋根を描く', () => {
    expectTypeOf(buildings).toMatchTypeOf<Layer>();
    expect(buildings.name).toBe('buildings');
    const { ctx, fills } = canvas();
    expect(() => buildings.draw(ctx, view, state(), 0)).not.toThrow();
    expect(fills).toEqual([
      ...Array(5).fill(mapColors['bg-surface'].dark),
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
    // 地面の下端は屋根に入らないが、壁の辺として選べる。
    const edge = data.landmarks[0].footprint!.slice(0, 2).map((p) =>
      project(view, 400, 600, ...toXY(p.lat, p.lng)));
    const bx = (edge[0][0] + edge[1][0]) / 2;
    const by = (edge[0][1] + edge[1][1]) / 2;
    expect(buildings.hitTest!(bx, by)).toEqual({ kind: 'building', id: 'a' });
  });

  it.each([0, Math.PI / 2, Math.PI])('回転 %s でも屋根の外にある壁の内側・辺が当たる', (th) => {
    const { ctx } = canvas();
    const rotated = { ...view, th };
    const data = state();
    buildings.draw(ctx, rotated, data, 0);
    const points = data.landmarks[0].footprint!.map((p) => toXY(p.lat, p.lng));
    const hgt = buildingHeight(points);
    const top = points.map(([x, y]): [number, number] => {
      const [px, py] = project(rotated, 400, 600, x, y, hgt);
      return [px, py];
    });
    const base = points.map(([x, y]) => project(rotated, 400, 600, x, y));
    const front = base.reduce((best, p, i) => p[1] > base[best][1] ? i : best, 0);
    const next = (front + 1) % base.length;
    const x = (base[front][0] + base[next][0]) / 2;
    const y = (base[front][1] + base[next][1]) / 2;
    // 最前面の頂点から壁の中へ少し進む。屋根だけの実装では当たらない。
    const bx = base[front][0] * 0.9 + x * 0.1;
    const by = base[front][1] * 0.9 + y * 0.1;
    expect(pointInPolygon(bx, by - 1, top)).toBe(false);
    expect(buildings.hitTest!(bx, by - 1)).toEqual({ kind: 'building', id: 'a' });
    expect(buildings.hitTest!(base[front][0], base[front][1])).toEqual({ kind: 'building', id: 'a' });
    expect(buildings.hitTest!(base[front][0], base[front][1] + 1)).toBeNull();
  });

  it.each([1, 2, 3])('輪郭なしでは企画の location に高さなしの印を描き、円内だけ建物を返す (DPR=%s)', (dpr) => {
    const { ctx, fills, strokes } = canvas(dpr);
    const event = place('event', { location: fromXY(60, -30), labelIds: ['show'] });
    const data = state({ landmarks: [{ ...landmark('a'), footprint: null }], places: [event] });
    buildings.draw(ctx, view, data, 0);
    const [wx, wy] = toXY(event.location.lat, event.location.lng);
    const [x, y] = project(view, 400, 600, wx, wy);
    // EventMark: k=2 は拡大扱いで 20 px(r=10)。画面に平行。押下領域は 44 px 角。
    expect(ctx.ellipse).toHaveBeenCalledExactlyOnceWith(x, y, 10, 10, 0, 0, Math.PI * 2);
    expect(fills).toEqual([mapColors.event.dark]);
    expect(strokes).toEqual([mapColors['map-ring'].dark]);
    expect(ctx.closePath).not.toHaveBeenCalled();
    expect(buildings.hitTest!(x, y)).toEqual({ kind: 'building', id: 'a' });
    expect(buildings.hitTest!(x + 22, y + 22)).toEqual({ kind: 'building', id: 'a' });
    expect(buildings.hitTest!(x + 22.1, y)).toBeNull();
    expect(buildings.hitTest!(x, y - 22)).toEqual({ kind: 'building', id: 'a' });
    expect(buildings.hitTest!(x, y + 22.1)).toBeNull();
    expect(buildings.hitTest!(200, 300)).toBeNull();
    buildings.draw(ctx, view, { ...data, filter: { labelIds: ['hidden'], tagIds: [] } }, 1);
    expect(buildings.hitTest!(x, y)).toBeNull();
    buildings.draw(ctx, view, data, 2);
    buildings.draw(ctx, { ...view, fx: 1000 }, data, 3);
    expect(buildings.hitTest!(x, y)).toBeNull();
    buildings.draw(ctx, view, data, 4);
    buildings.draw(ctx, view, state({ landmarks: [] }), 5);
    expect(buildings.hitTest!(x, y)).toBeNull();
  });

  it('輪郭なしの建物内に行き先があれば企画の印を強調し、絞り込み外の行き先も描く', () => {
    const { ctx, fills, strokes } = canvas();
    const data = state({
      landmarks: [{ ...landmark('a'), footprint: null }],
      places: [place('shown', { labelIds: ['show'] }),
        place('dest', { labelIds: ['hidden'], location: fromXY(60, 0) })],
      destination: { placeId: 'dest' }, filter: { labelIds: ['show'], tagIds: ['ignored'] },
    });
    buildings.draw(ctx, view, data, 0);
    expect(fills).toEqual([mapColors.destination.dark, mapColors.destination.dark]);
    expect(strokes).toEqual(Array(2).fill(mapColors['map-ring'].dark));
    expect(buildings.hitTest!(320, 300)).toEqual({ kind: 'building', id: 'a' });
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

  it('解決済み hex と描画時の alpha を分けて壁・屋根を描く', () => {
    const { ctx, alphas } = canvas();
    buildings.draw(ctx, view, state(), 0);
    expect(alphas).toEqual([0.36, 0.36, 0.36, 0.36, 0.9]);
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
    expect(fills[4]).toBe(mapColors.destination.dark);
    expect(fills[9]).toBe(mapColors.event.dark);
    const [x, y] = project(view, 400, 600, 0, 0, buildingHeight(square));
    expect(buildings.hitTest!(x, y)).toEqual({ kind: 'building', id: 'near' });
  });

  it('企画のない null の輪郭は描かず、描き直すたびに以前の当たり判定を捨てる', () => {
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
    expect(fills[4]).toBe(mapColors['bg-surface'].dark);
  });

  it('labelIds で絞り、MapState にリンクのない tagIds は適用しない', () => {
    const { ctx, fills } = canvas();
    const data = state({ places: [place('event', { labelIds: ['selected'] })],
      filter: { labelIds: ['selected'], tagIds: ['unknown-tag'] } });
    buildings.draw(ctx, view, data, 0);
    expect(fills[4]).toBe(mapColors.event.dark);
    fills.length = 0;
    buildings.draw(ctx, view, { ...data, filter: { labelIds: ['other'], tagIds: [] } }, 1);
    expect(fills[4]).toBe(mapColors['bg-surface'].dark);
  });

  it.each([[0.5, 0.6], [2, 0.9], [10, 1.3]])('倍率 %s の線幅は %s', (k, expected) => {
    const { ctx, widths } = canvas();
    buildings.draw(ctx, { ...view, k }, state(), 0);
    expect(widths).toEqual(Array(5).fill(expected));
  });
});
