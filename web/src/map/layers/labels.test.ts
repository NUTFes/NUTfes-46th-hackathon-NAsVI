import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { fromXY, toXY } from '../../domain/geo';
import type { Landmark, Place } from '../../types';
import { project, TILT } from '../core';
import { buildingHeight } from './buildings';
import labels, { hitLabel, placeLabels, rectsOverlap } from './labels';
import type { LabelCandidate, LabelHit, Rect } from './labels';
import type { Layer, MapState, View } from './types';

const view: View = { fx: 0, fy: 0, k: 2, th: 0, cy: 300 };

function candidate(id: string, overrides: Partial<LabelCandidate> = {}): LabelCandidate {
  return { placeId: id, text: id, textWidth: 40, x: 200, y: 200, depth: 0, isDestination: false, ...overrides };
}

function place(id: string, overrides: Partial<Place> = {}): Place {
  return {
    id, name: id, kind: 'event', location: fromXY(0, 0), description: '',
    landmarkId: null, floor: null, hours: [], labelIds: [], ...overrides,
  };
}

function landmark(): Landmark {
  return {
    id: 'a', name: '建物', location: fromXY(0, 0), floors: [],
    footprint: [[-20, -20], [20, -20], [20, 20], [-20, 20]].map(([x, y]) => fromXY(x, y)),
  };
}

function state(overrides: Partial<MapState> = {}): MapState {
  return {
    places: [], landmarks: [], stamps: [], position: null, destination: null,
    filter: { labelIds: [], tagIds: [] }, now: 0, ...overrides,
  };
}

function canvas(dpr = 1) {
  const ctx = {
    canvas: { width: 400 * dpr, height: 600 * dpr },
    getTransform: () => ({ a: dpr, b: 0 }),
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), ellipse: vi.fn(), roundRect: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
  } as unknown as CanvasRenderingContext2D;
  return ctx;
}

describe('rectsOverlap', () => {
  const rect: Rect = { x: 10, y: 10, w: 20, h: 20 };

  it.each<[Rect, boolean]>([
    [{ x: 10, y: 10, w: 20, h: 20 }, true],
    [{ x: 33.9, y: 10, w: 20, h: 20 }, true],
    [{ x: 34, y: 10, w: 20, h: 20 }, false],
    [{ x: 10, y: 32.9, w: 20, h: 20 }, true],
    [{ x: 10, y: 33, w: 20, h: 20 }, false],
    [{ x: 100, y: 100, w: 20, h: 20 }, false],
  ])('横 4・縦 3 の余白で %j を判定', (other, expected) => {
    expect(rectsOverlap(rect, other)).toBe(expected);
    expect(rectsOverlap(other, rect)).toBe(expected);
  });
});

describe('placeLabels', () => {
  it('行き先が最優先で、重なる通常ラベルを省く。入力は変えない', () => {
    const input = [candidate('far', { depth: 100 }), candidate('dest', { isDestination: true, depth: -100 })];
    const before = structuredClone(input);
    const placed = placeLabels(input, 2, 400, 600);
    expect(placed.map((p) => p.placeId)).toEqual(['dest']);
    expect(placed[0]).toMatchObject({ rect: { x: 170, y: 152, w: 60, h: 26 }, stem: 22 });
    expect(input).toEqual(before);
  });

  it('行き先以外は奥行きが大きいものを先に置く', () => {
    expect(placeLabels([candidate('near', { depth: -10 }), candidate('far', { depth: 10 })], 2, 400, 600)
      .map((p) => p.placeId)).toEqual(['far']);
    expect(placeLabels([
      candidate('near', { depth: -10, x: 80 }), candidate('far', { depth: 10, x: 320 }),
    ], 2, 400, 600).map((p) => p.placeId)).toEqual(['far', 'near']);
  });

  it('通常ラベルの測定幅に 14 px を足し、余白の端で置ける', () => {
    const input = [candidate('a'), candidate('b', { x: 258 })];
    const placed = placeLabels(input, 2, 400, 600);
    expect(placed).toHaveLength(2);
    expect(placed[0].rect).toEqual({ x: 173, y: 164, w: 54, h: 22 });
    expect(placed[0].stem).toBe(14);
    expect(placeLabels([input[0], { ...input[1], x: 257.9 }], 2, 400, 600)).toHaveLength(1);
  });

  it('倍率 1.25 未満では行き先のみ。境界 1.25 で通常ラベルを出す', () => {
    const input = [candidate('normal', { x: 80 }), candidate('dest', { x: 320, isDestination: true })];
    expect(placeLabels(input, 1.249, 400, 600).map((p) => p.placeId)).toEqual(['dest']);
    expect(placeLabels(input, 1.25, 400, 600).map((p) => p.placeId)).toEqual(['dest', 'normal']);
  });

  it.each([
    { x: 30.9 }, { x: 369.1 }, { y: 105.9 }, { y: 600.1 },
  ])('画面外や上部の通常ラベルを省くが行き先は残す: %j', (position) => {
    const p = candidate('a', position);
    expect(placeLabels([p], 2, 400, 600)).toEqual([]);
    expect(placeLabels([{ ...p, isDestination: true }], 2, 400, 600)).toHaveLength(1);
  });

  it.each([{ x: 31 }, { x: 369 }, { y: 106 }, { y: 600 }])('画面の境界は表示できる: %j', (position) => {
    expect(placeLabels([candidate('a', position)], 2, 400, 600)).toHaveLength(1);
  });

  it('空なら配置しない', () => {
    expect(placeLabels([], 2, 400, 600)).toEqual([]);
  });
});

describe('hitLabel', () => {
  const hits: LabelHit[] = [{ placeId: 'a', rect: { x: 10, y: 20, w: 30, h: 40 } }];

  it.each([[10, 20], [40, 60], [20, 30]])('矩形内と辺 (%s, %s) で場所を返す', (x, y) => {
    expect(hitLabel(hits, x, y)).toEqual({ kind: 'place', id: 'a' });
  });

  it.each([[9.9, 30], [40.1, 30], [20, 19.9], [20, 60.1]])('矩形外 (%s, %s) は当たらない', (x, y) => {
    expect(hitLabel(hits, x, y)).toBeNull();
  });

  it('配置の先頭を優先し、空なら当たらない', () => {
    expect(hitLabel([...hits, { ...hits[0], placeId: 'b' }], 20, 30)).toEqual({ kind: 'place', id: 'a' });
    expect(hitLabel([], 20, 30)).toBeNull();
  });
});

describe('labels Layer', () => {
  it('Layer 型を満たし、空や印・ラベルのある状態をスタブ ctx で描ける', () => {
    expectTypeOf(labels).toMatchTypeOf<Layer>();
    expect(labels.name).toBe('labels');
    const ctx = canvas();
    expect(() => labels.draw(ctx, view, state(), 0)).not.toThrow();
    expect(() => labels.draw(ctx, view, state({ places: [place('企画')] }), 0)).not.toThrow();
    expect(ctx.ellipse).toHaveBeenCalledTimes(2);
    expect(ctx.measureText).toHaveBeenCalledWith('企画');
    expect(ctx.roundRect).toHaveBeenCalledWith(183, 264, 34, 22, 6);
    expect(ctx.fillText).toHaveBeenCalledWith('企画', 200, 275.5);
  });

  it.each([1, 2, 3])('DPR=%s でもラベルと円のタップは CSS ピクセル', (dpr) => {
    const ctx = canvas(dpr);
    labels.draw(ctx, view, state({ places: [place('企画')] }), 0);
    expect(labels.hitTest!(200, 275)).toEqual({ kind: 'place', id: '企画' });
    expect(labels.hitTest!(200, 300)).toEqual({ kind: 'place', id: '企画' });
    expect(labels.hitTest!(222, 300)).toBeNull();
    expect(labels.hitTest!(221.9, 300)).toEqual({ kind: 'place', id: '企画' });
    expect(labels.hitTest!(200, 300 + 21.9 * TILT)).toEqual({ kind: 'place', id: '企画' });
    expect(labels.hitTest!(200, 300 + 22.1 * TILT)).toBeNull();
  });

  it('ラベルを屋外の円より優先し、建物は返さない', () => {
    const ctx = canvas();
    const outdoor = place('outdoor', { location: fromXY(0, 68) });
    labels.draw(ctx, view, state({
      landmarks: [landmark()], places: [outdoor, place('indoor', { landmarkId: 'a' })],
      destination: { placeId: 'indoor' },
    }), 0);
    const [wx, wy] = toXY(outdoor.location.lat, outdoor.location.lng);
    const [x, y] = project(view, 400, 600, wx, wy);
    // 屋内の行き先の吹き出しと、別の屋外企画の円が同じ点を含む。
    expect(labels.hitTest!(x, y)).toEqual({ kind: 'place', id: 'indoor' });
    labels.draw(ctx, view, state({ landmarks: [landmark()] }), 1);
    expect(labels.hitTest!(200, 264)).toBeNull();
  });

  it('屋外の円とラベルの判定を、絞り込み・空・視点変更で更新する', () => {
    const ctx = canvas();
    const data = state({ places: [place('outdoor', { labelIds: ['food'] })] });
    labels.draw(ctx, view, data, 0);
    expect(labels.hitTest!(200, 275)).not.toBeNull();
    expect(labels.hitTest!(200, 300)).not.toBeNull();
    labels.draw(ctx, view, { ...data, filter: { labelIds: ['other'], tagIds: [] } }, 1);
    expect(labels.hitTest!(200, 275)).toBeNull();
    expect(labels.hitTest!(200, 300)).toBeNull();
    labels.draw(ctx, view, data, 2);
    labels.draw(ctx, { ...view, fx: 1000 }, data, 3);
    expect(labels.hitTest!(200, 300)).toBeNull();
    labels.draw(ctx, view, state(), 4);
    expect(labels.hitTest!(200, 275)).toBeNull();
  });

  it.each(['info', 'wc', 'rest', 'trash'] as const)('%s は建物所属でも絞り込み後に地面の印を残す', (kind) => {
    const ctx = canvas();
    labels.draw(ctx, { ...view, k: 1 }, state({
      landmarks: [landmark()], places: [place('facility', { kind, landmarkId: 'a' })],
      filter: { labelIds: ['missing'], tagIds: ['missing'] },
    }), 0);
    expect(ctx.ellipse).toHaveBeenCalledTimes(2);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(labels.hitTest!(200, 300)).toEqual({ kind: 'place', id: 'facility' });
  });

  it('駐車場も地面の印を描く。絞り込みは applyFilter の規則に従う', () => {
    const ctx = canvas();
    const data = state({ places: [place('parking', { kind: 'parking', labelIds: ['parking'] })] });
    labels.draw(ctx, { ...view, k: 1 }, data, 0);
    expect(ctx.ellipse).toHaveBeenCalledTimes(2);
    expect(labels.hitTest!(200, 300)).toEqual({ kind: 'place', id: 'parking' });
    labels.draw(ctx, view, { ...data, filter: { labelIds: ['other'], tagIds: [] } }, 1);
    expect(labels.hitTest!(200, 300)).toBeNull();
  });

  it('Place.name を使い、同じ建物の絞り込み後の企画だけを +N に数える', () => {
    const ctx = canvas();
    labels.draw(ctx, view, state({
      landmarks: [landmark()],
      places: [
        place('first', { name: '展示', landmarkId: 'a', labelIds: ['show'] }),
        place('second', { landmarkId: 'a', labelIds: ['show'] }),
        place('hidden', { landmarkId: 'a', labelIds: ['food'] }),
        place('facility', { kind: 'wc', name: 'トイレ', landmarkId: 'a', location: fromXY(60, 0) }),
      ],
      filter: { labelIds: ['show'], tagIds: ['unknown-tag'] },
    }), 0);
    expect(ctx.fillText).toHaveBeenCalledWith('展示 +1', 200, expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith('トイレ', expect.closeTo(320, 8), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it('行き先は同じ建物の代表とし、絞り込み外・低倍率でも単独名と屋根の波紋を出す', () => {
    const ctx = canvas();
    const building = landmark();
    labels.draw(ctx, { ...view, k: 1 }, state({
      landmarks: [building], places: [
        place('shown', { landmarkId: 'a', labelIds: ['show'] }),
        place('dest', { name: '目的地', landmarkId: 'a', labelIds: ['hidden'] }),
      ], destination: { placeId: 'dest' }, filter: { labelIds: ['show'], tagIds: [] },
    }), 800);
    const hgt = buildingHeight(building.footprint!.map((p) => toXY(p.lat, p.lng)));
    const [x, y] = project({ ...view, k: 1 }, 400, 600, 0, 0, hgt);
    expect(ctx.ellipse).toHaveBeenCalledExactlyOnceWith(x, y, 33, 33 * TILT, 0, 0, 7);
    expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('目的地', x, y - 22 - 13 + 0.5);
    expect(labels.hitTest!(x, y - 35)).toEqual({ kind: 'place', id: 'dest' });
  });

  it('屋外の行き先の波紋は地面に描く。輪郭のない屋内企画でも例外にならない', () => {
    const ctx = canvas();
    labels.draw(ctx, view, state({ places: [place('dest')], destination: { placeId: 'dest' } }), 800);
    expect(ctx.ellipse).toHaveBeenLastCalledWith(200, 300, 33, 33 * TILT, 0, 0, 7);
    expect(() => labels.draw(ctx, view, state({
      landmarks: [{ ...landmark(), footprint: null }],
      places: [place('indoor', { landmarkId: 'a' })], destination: { placeId: 'indoor' },
    }), 0)).not.toThrow();
  });
});
