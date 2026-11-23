import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { fromXY, toXY } from '../../domain/geo';
import type { Landmark, Place } from '../../types';
import { project, TILT } from '../core';
import buildings, { buildingHeight, mapColors } from './buildings';
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
    moveTo: vi.fn(), lineTo: vi.fn(), ellipse: vi.fn(), roundRect: vi.fn(), rect: vi.fn(),
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

  it.each([
    { textWidth: NaN }, { textWidth: Infinity }, { textWidth: -1 },
    { x: NaN }, { y: NaN }, { depth: NaN }, { x: Infinity },
  ])('不正な値のラベル %j は行き先でも飛ばし、正常なラベルを残す', (bad) => {
    expect(placeLabels([
      candidate('bad', { ...bad, isDestination: true }), candidate('valid'),
    ], 2, 400, 600).map((p) => p.placeId)).toEqual(['valid']);
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
  it('初回 draw 前はラベルも印も当たらない', async () => {
    vi.resetModules();
    const { default: fresh } = await import('./labels');
    expect(fresh.hitTest!(200, 275)).toBeNull();
    expect(fresh.hitTest!(200, 300)).toBeNull();
  });

  it('roundRect がなくても rect の path で同じ吹き出し・タップ範囲を使う', () => {
    const ctx = canvas();
    Object.defineProperty(ctx, 'roundRect', { value: undefined });
    expect(() => labels.draw(ctx, view, state({ places: [place('企画')] }), 0)).not.toThrow();
    expect(ctx.rect).toHaveBeenCalledExactlyOnceWith(183, 264, 34, 22);
    expect(ctx.fillText).toHaveBeenCalledWith('企画', 200, 275.5);
    expect(labels.hitTest!(200, 275)).toEqual({ kind: 'place', id: '企画' });
    // 44px に広げず、既存の labelHits の矩形を保つ。
    expect(labels.hitTest!(200, 263.9)).toBeNull();
  });

  it('measureText が NaN のラベルを飛ばし、他のラベルは描画・選択できる', () => {
    const ctx = canvas();
    vi.mocked(ctx.measureText).mockImplementation((text) => ({
      width: text === 'bad' ? NaN : 40,
    }) as TextMetrics);
    expect(() => labels.draw(ctx, view, state({ places: [
      place('bad'), place('valid', { location: fromXY(60, 0) }),
    ], destination: { placeId: 'bad' } }), 0)).not.toThrow();
    expect(ctx.roundRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('valid', expect.closeTo(320, 8), 275.5);
    expect(labels.hitTest!(200, 265)).toBeNull();
    expect(labels.hitTest!(320, 275)).toEqual({ kind: 'place', id: 'valid' });
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it.each(['dark', 'light'] as const)('テーマ %s の企画・駐車場・設備と行き先に対応する色・文字色・縁を使う', (theme) => {
    for (const kind of ['event', 'parking', 'info', 'wc', 'rest', 'trash'] as const) {
      for (const isDestination of [false, true]) {
        const ctx = canvas();
        ctx.canvas.closest = vi.fn().mockReturnValue({ getAttribute: () => theme });
        const fills: { color: unknown; alpha: number }[] = [];
        const strokes: unknown[] = [];
        const texts: unknown[] = [];
        vi.mocked(ctx.fill).mockImplementation(() => { fills.push({ color: ctx.fillStyle, alpha: ctx.globalAlpha }); });
        vi.mocked(ctx.stroke).mockImplementation(() => { strokes.push(ctx.strokeStyle); });
        vi.mocked(ctx.fillText).mockImplementation(() => { texts.push(ctx.fillStyle); });
        labels.draw(ctx, view, state({ places: [place('p', { kind })],
          destination: isDestination ? { placeId: 'p' } : null }), 0);
        const token = isDestination ? 'destination' : kind === 'event' ? 'event' : kind === 'parking' ? 'parking' : 'facility';
        expect(fills).toEqual([
          { color: mapColors[token][theme], alpha: isDestination ? 0.3 : 0.18 },
          { color: mapColors[token][theme], alpha: 1 },
          { color: mapColors[token][theme], alpha: isDestination ? 1 : 0.94 },
        ]);
        expect(texts).toEqual([mapColors[`${token}-on`][theme]]);
        const border = mapColors[isDestination ? 'destination-border' : 'map-ring'][theme];
        expect(strokes).toEqual(isDestination ? [border, mapColors.destination[theme], border, border] : [border, border, border]);
      }
    }
  });

  it.each([false, true])('通常終了・描画例外でも save/restore が対応し、Canvas 状態を復元する (例外=%s)', (fail) => {
    const ctx = canvas();
    const before = {
      globalAlpha: 0.63, fillStyle: '#123456', strokeStyle: '#abcdef', lineWidth: 7,
      font: '10px serif', textAlign: 'left' as CanvasTextAlign, textBaseline: 'top' as CanvasTextBaseline,
    };
    Object.assign(ctx, before);
    const stack: typeof before[] = [];
    vi.mocked(ctx.save).mockImplementation(() => { stack.push({
      globalAlpha: ctx.globalAlpha, fillStyle: String(ctx.fillStyle), strokeStyle: String(ctx.strokeStyle),
      lineWidth: ctx.lineWidth, font: ctx.font, textAlign: ctx.textAlign, textBaseline: ctx.textBaseline,
    }); });
    vi.mocked(ctx.restore).mockImplementation(() => { Object.assign(ctx, stack.pop()); });
    if (fail) vi.mocked(ctx.fillText).mockImplementationOnce(() => { throw new Error('描画失敗'); });
    const draw = () => labels.draw(ctx, view, state({ places: [place('p')] }), 0);
    if (fail) expect(draw).toThrow('描画失敗');
    else expect(draw).not.toThrow();
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(stack).toEqual([]);
    expect(ctx).toMatchObject(before);
  });

  it('輪郭なしのラベル・波紋は企画の location に置き、印の建物判定を遮らない', () => {
    const ctx = canvas();
    const building = { ...landmark(), footprint: null };
    const event = place('indoor', { landmarkId: 'a', location: fromXY(60, -30) });
    const data = state({ landmarks: [building], places: [event], destination: { placeId: event.id } });
    const [wx, wy] = toXY(event.location.lat, event.location.lng);
    const [x, y] = project(view, 400, 600, wx, wy);
    buildings.draw(ctx, view, data, 800);
    labels.draw(ctx, view, data, 800);
    expect(ctx.ellipse).toHaveBeenCalledTimes(2); // buildings の印 1 個と labels の波紋 1 個。
    expect(ctx.ellipse).toHaveBeenLastCalledWith(x, y, 33, 33 * TILT, 0, 0, 7);
    expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('indoor', x, y - 35 + 0.5);
    expect(labels.hitTest!(x, y)).toBeNull();
    expect(buildings.hitTest!(x, y)).toEqual({ kind: 'building', id: 'a' });
    expect(labels.hitTest!(x, y - 35)).toEqual({ kind: 'place', id: 'indoor' });
  });

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
