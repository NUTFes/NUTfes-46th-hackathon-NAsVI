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
    translate: vi.fn(), scale: vi.fn(),
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
    expect(() => labels.draw(ctx, view, state({
      places: [place('企画')], destination: { placeId: '企画' },
    }), 0)).not.toThrow();
    expect(ctx.rect).toHaveBeenCalledExactlyOnceWith(180, 252, 40, 26);
    expect(ctx.fillText).toHaveBeenCalledWith('企画', 200, 265.5);
    expect(labels.hitTest!(200, 265)).toEqual({ kind: 'place', id: '企画' });
    // 行き先の吹き出しは 44px に広げず、描いた矩形のまま。
    expect(labels.hitTest!(200, 251.9)).toBeNull();
  });

  it('measureText が NaN のラベルを飛ばし、他のラベルは描画・選択できる', () => {
    const ctx = canvas();
    vi.mocked(ctx.measureText).mockImplementation((text) => ({
      width: text === 'bad' ? NaN : 40,
    }) as TextMetrics);
    const hgt = buildingHeight(landmark().footprint!.map((p) => toXY(p.lat, p.lng)));
    const [rx, ry] = project(view, 400, 600, 0, 0, hgt);
    expect(() => labels.draw(ctx, view, state({ landmarks: [landmark()], places: [
      place('bad'), place('valid', { landmarkId: 'a', location: fromXY(60, 0) }),
    ], destination: { placeId: 'bad' } }), 0)).not.toThrow();
    // 'bad' の吹き出しは省かれ、建物の企画数の丸薬(roundRect 1 回)だけが残る。
    expect(ctx.roundRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('1', expect.any(Number), expect.any(Number));
    expect(labels.hitTest!(200, 200)).toBeNull();
    expect(labels.hitTest!(rx, ry)).toEqual({ kind: 'place', id: 'valid' });
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it.each(['dark', 'light'] as const)('テーマ %s の企画・駐車場・設備と行き先に対応する色を使う', (theme) => {
    for (const kind of ['event', 'parking', 'info', 'wc', 'rest', 'trash'] as const) {
      for (const isDestination of [false, true]) {
        const ctx = canvas();
        ctx.canvas.closest = vi.fn().mockReturnValue({ getAttribute: () => theme });
        const fills: unknown[] = [];
        const strokes: unknown[] = [];
        const texts: unknown[] = [];
        vi.mocked(ctx.fill).mockImplementation(() => { fills.push(ctx.fillStyle); });
        vi.mocked(ctx.stroke).mockImplementation(() => { strokes.push(ctx.strokeStyle); });
        vi.mocked(ctx.fillText).mockImplementation(() => { texts.push(ctx.fillStyle); });
        labels.draw(ctx, view, state({ places: [place('p', { kind })],
          destination: isDestination ? { placeId: 'p' } : null }), 0);
        if (isDestination) {
          // 行き先の丸は route 層が描く。labels は名前の吹き出しだけ(destination 色、文字は destination-on)。
          expect(fills).toEqual([mapColors.destination[theme]]);
          expect(texts).toEqual([mapColors['destination-on'][theme]]);
          const border = mapColors['destination-border'][theme];
          expect(strokes).toEqual([mapColors.destination[theme], border, border]);
          continue;
        }
        const token = kind === 'event' ? 'event' : kind === 'parking' ? 'parking' : 'facility';
        expect(fills).toEqual([mapColors[token][theme]]);
        expect(strokes).toContain(mapColors['map-ring'][theme]);
        // 駐車場は P(parking-on)、企画は拡大時の名前(text-primary)、設備は文字なし。
        expect(texts).toEqual(kind === 'parking' ? [mapColors['parking-on'][theme]]
          : kind === 'event' ? [mapColors['text-primary'][theme]] : []);
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

  it('輪郭なしのラベル・波紋は企画の location に置く', () => {
    const ctx = canvas();
    const building = { ...landmark(), footprint: null };
    const event = place('indoor', { landmarkId: 'a', location: fromXY(60, -30) });
    const data = state({ landmarks: [building], places: [event], destination: { placeId: event.id } });
    const [wx, wy] = toXY(event.location.lat, event.location.lng);
    const [x, y] = project(view, 400, 600, wx, wy);
    buildings.draw(ctx, view, data, 800);
    labels.draw(ctx, view, data, 800);
    expect(ctx.ellipse).toHaveBeenCalledTimes(1); // labels の波紋 1 個だけ(buildings は印を描かない)。
    expect(ctx.ellipse).toHaveBeenLastCalledWith(x, y, 33, 33 * TILT, 0, 0, 7);
    expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('indoor', x, y - 35 + 0.5);
    expect(labels.hitTest!(x, y)).toBeNull();
    expect(buildings.hitTest!(x, y)).toBeNull();
    expect(labels.hitTest!(x, y - 35)).toEqual({ kind: 'place', id: 'indoor' });
  });

  it('Layer 型を満たし、空や印・ラベルのある状態をスタブ ctx で描ける', () => {
    expectTypeOf(labels).toMatchTypeOf<Layer>();
    expect(labels.name).toBe('labels');
    const ctx = canvas();
    expect(() => labels.draw(ctx, view, state(), 0)).not.toThrow();
    expect(() => labels.draw(ctx, view, state({ places: [place('企画')] }), 0)).not.toThrow();
    expect(ctx.ellipse).toHaveBeenCalledExactlyOnceWith(200, 300, 10, 10, 0, 0, Math.PI * 2);
    expect(ctx.measureText).toHaveBeenCalledWith('企画');
    expect(ctx.fillText).toHaveBeenCalledWith('企画', 200, 323.5);
  });

  it.each([1, 2, 3])('DPR=%s でもラベルと円のタップは CSS ピクセル', (dpr) => {
    const ctx = canvas(dpr);
    labels.draw(ctx, view, state({ places: [place('企画')] }), 0);
    // 押下領域は印の中心から 44 CSS px 角(±22)。
    expect(labels.hitTest!(200, 300)).toEqual({ kind: 'place', id: '企画' });
    expect(labels.hitTest!(222, 322)).toEqual({ kind: 'place', id: '企画' });
    expect(labels.hitTest!(222.1, 300)).toBeNull();
    expect(labels.hitTest!(200, 322.1)).toBeNull();
    expect(labels.hitTest!(178, 278)).toEqual({ kind: 'place', id: '企画' });
    expect(labels.hitTest!(200, 277.9)).toBeNull();
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
    expect(labels.hitTest!(200, 300)).not.toBeNull();
    labels.draw(ctx, view, { ...data, filter: { labelIds: ['other'], tagIds: [] } }, 1);
    expect(labels.hitTest!(200, 300)).toBeNull();
    labels.draw(ctx, view, data, 2);
    labels.draw(ctx, { ...view, fx: 1000 }, data, 3);
    expect(labels.hitTest!(200, 300)).toBeNull();
    labels.draw(ctx, view, state(), 4);
    expect(labels.hitTest!(200, 300)).toBeNull();
  });

  it.each(['info', 'wc', 'rest', 'trash'] as const)('%s は建物所属でも絞り込み後に地面の印を残す', (kind) => {
    const ctx = canvas();
    labels.draw(ctx, { ...view, k: 1 }, state({
      landmarks: [landmark()], places: [place('facility', { kind, landmarkId: 'a' })],
      filter: { labelIds: ['missing'], tagIds: ['missing'] },
    }), 0);
    expect(ctx.ellipse).toHaveBeenCalledExactlyOnceWith(200, 300, 10, 10, 0, 0, Math.PI * 2); // 20 px の丸
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(labels.hitTest!(200, 300)).toEqual({ kind: 'place', id: 'facility' });
  });

  it('駐車場も地面の印を描く。絞り込みは applyFilter の規則に従う', () => {
    const ctx = canvas();
    const data = state({ places: [place('parking', { kind: 'parking', labelIds: ['parking'] })] });
    labels.draw(ctx, { ...view, k: 1 }, data, 0);
    // ParkingMark: 22 px の角丸四角に P(丸は描かない)。
    expect(ctx.ellipse).not.toHaveBeenCalled();
    expect(ctx.roundRect).toHaveBeenCalledExactlyOnceWith(189, 289, 22, 22, 6);
    expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('P', 200, 300.5);
    expect(labels.hitTest!(200, 300)).toEqual({ kind: 'place', id: 'parking' });
    labels.draw(ctx, view, { ...data, filter: { labelIds: ['other'], tagIds: [] } }, 1);
    expect(labels.hitTest!(200, 300)).toBeNull();
  });

  it('同じ建物の絞り込み後の企画だけを BuildingFlag の数に数える', () => {
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
    // 建物は名前でなく「旗+絞り込み後の企画数」の丸薬。設備は数えず、文字も出さない。
    expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('2', expect.any(Number), expect.any(Number));
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

  describe('種類別の印', () => {
    it('EventMark: 通常は 16 px、拡大(k>=1.25)は 20 px で名前を丸の下に出す', () => {
      const ctx = canvas();
      const data = state({ places: [place('屋台')] });
      labels.draw(ctx, { ...view, k: 1.24 }, data, 0);
      expect(ctx.ellipse).toHaveBeenLastCalledWith(200, 300, 8, 8, 0, 0, Math.PI * 2);
      expect(ctx.fillText).not.toHaveBeenCalled();
      labels.draw(ctx, { ...view, k: 1.25 }, data, 0);
      expect(ctx.ellipse).toHaveBeenLastCalledWith(200, 300, 10, 10, 0, 0, Math.PI * 2);
      expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('屋台', 200, 323.5);
    });

    it('FacilityMark: 通常 20 px・拡大 26 px。ParkingMark は拡大しても 22 px', () => {
      const ctx = canvas();
      labels.draw(ctx, { ...view, k: 2 }, state({ places: [place('t', { kind: 'wc' })] }), 0);
      expect(ctx.ellipse).toHaveBeenLastCalledWith(200, 300, 13, 13, 0, 0, Math.PI * 2);
      labels.draw(ctx, { ...view, k: 2 }, state({ places: [place('p', { kind: 'parking' })] }), 0);
      expect(ctx.roundRect).toHaveBeenLastCalledWith(189, 289, 22, 22, 6);
    });

    it('Path2D があれば 設備の種類ごとのアイコン・企画の旗を 24 格子のパスで描く', () => {
      const made: string[] = [];
      vi.stubGlobal('Path2D', class { constructor(d: string) { made.push(d); } });
      try {
        for (const kind of ['info', 'wc', 'rest', 'trash', 'parking', 'event'] as const) {
          made.length = 0;
          const ctx = canvas();
          labels.draw(ctx, { ...view, k: 1 }, state({ places: [place('x', { kind })] }), 0);
          // parking は P の文字で、アイコンのパスは使わない。
          if (kind === 'parking') expect(made).toEqual([]);
          else expect(made.length).toBeGreaterThan(0);
          if (kind === 'event') expect(made).toEqual(['M6 21V4M6 4h11l-2.5 4L17 12H6']);
        }
        const wc: string[] = [];
        made.length = 0;
        labels.draw(canvas(), { ...view, k: 1 }, state({ places: [place('x', { kind: 'wc' })] }), 0);
        wc.push(...made);
        made.length = 0;
        labels.draw(canvas(), { ...view, k: 1 }, state({ places: [place('x', { kind: 'trash' })] }), 0);
        expect(made).not.toEqual(wc);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('BuildingFlag: 建物の企画を「旗+数」の丸薬 1 つにまとめ、低倍率でも出す。押下領域は 44 px 角', () => {
      const ctx = canvas();
      const building = landmark();
      const hgt = buildingHeight(building.footprint!.map((p) => toXY(p.lat, p.lng)));
      const [x, y] = project({ ...view, k: 1 }, 400, 600, 0, 0, hgt);
      labels.draw(ctx, { ...view, k: 1 }, state({
        landmarks: [building],
        places: ['a', 'b', 'c'].map((id) => place(id, { landmarkId: 'a' })),
      }), 0);
      // 丸薬は高さ 26・端が半円。数字は 13 px。
      const width = 9 * 2 + 12 + 3 + 10;
      expect(ctx.roundRect).toHaveBeenCalledExactlyOnceWith(x - width / 2, y - 13, width, 26, 13);
      expect(ctx.fillText).toHaveBeenCalledExactlyOnceWith('3', expect.any(Number), y + 0.5);
      expect(labels.hitTest!(x, y)).toEqual({ kind: 'place', id: 'a' });
      expect(labels.hitTest!(x + 22, y - 22)).toEqual({ kind: 'place', id: 'a' });
      expect(labels.hitTest!(x + 22.1, y)).toBeNull();
      expect(labels.hitTest!(x, y + 22.1)).toBeNull();
    });

    it.each([[2, 10], [3, 20]])('丸薬が 44 px を超える %s 桁の数でも、押下領域は max(44, 丸薬の幅)', (digits, textWidth) => {
      const ctx = canvas();
      vi.mocked(ctx.measureText).mockImplementation(() => ({ width: textWidth * digits }) as TextMetrics);
      const building = landmark();
      const hgt = buildingHeight(building.footprint!.map((p) => toXY(p.lat, p.lng)));
      const [x, y] = project({ ...view, k: 1 }, 400, 600, 0, 0, hgt);
      const places = Array.from({ length: 10 ** (digits - 1) }, (_, i) => place(`p${i}`, { landmarkId: 'a' }));
      labels.draw(ctx, { ...view, k: 1 }, state({ landmarks: [building], places }), 0);
      const pill = 9 * 2 + 12 + 3 + textWidth * digits;
      expect(pill).toBeGreaterThan(44);
      expect(labels.hitTest!(x + pill / 2, y)).toEqual({ kind: 'place', id: 'p0' });
      expect(labels.hitTest!(x - pill / 2, y)).toEqual({ kind: 'place', id: 'p0' });
      expect(labels.hitTest!(x + pill / 2 + 0.1, y)).toBeNull();
    });

    it('輪郭なしの建物は BuildingFlag の押下領域だけを持つ(EventMark と二重にならない)', () => {
      const ctx = canvas();
      const event = place('indoor', { landmarkId: 'a', location: fromXY(60, -30) });
      const data = state({ landmarks: [{ ...landmark(), footprint: null }], places: [event] });
      const [wx, wy] = toXY(event.location.lat, event.location.lng);
      const [x, y] = project(view, 400, 600, wx, wy);
      buildings.draw(ctx, view, data, 0);
      labels.draw(ctx, view, data, 0);
      expect(ctx.ellipse).not.toHaveBeenCalled(); // 丸(EventMark)は重ねない
      expect(ctx.roundRect).toHaveBeenCalledOnce(); // 丸薬 1 つ
      expect(buildings.hitTest!(x, y)).toBeNull();
      expect(labels.hitTest!(x, y)).toEqual({ kind: 'place', id: 'indoor' });
    });

    it('広げた丸薬の押下領域は、描いた丸薬の外では近いほうの地面の印に譲る', () => {
      const ctx = canvas();
      const building = landmark();
      const hgt = buildingHeight(building.footprint!.map((p) => toXY(p.lat, p.lng)));
      const [x, y] = project({ ...view, k: 1 }, 400, 600, 0, 0, hgt);
      // 丸薬(中心 (x, y))の右 20px 先に、地面の印(施設)を置く。丸薬の描いた幅は 40 なので x+20 が縁。
      const facility = place('wc', { kind: 'wc', location: fromXY(0, 0) });
      labels.draw(ctx, { ...view, k: 1 }, state({ landmarks: [building], places: [
        place('a', { landmarkId: 'a' }), facility,
      ] }), 0);
      // 施設の印は地面 (200, 300)。丸薬は屋根の位置にある。
      expect(labels.hitTest!(200, 300)).toEqual({ kind: 'place', id: 'wc' });
      expect(labels.hitTest!(x, y)).toEqual({ kind: 'place', id: 'a' });
    });

    it('描いた丸薬の矩形の内側は、地面の印のほうが近くても丸薬を優先する', () => {
      const ctx = canvas();
      const building = landmark();
      const hgt = buildingHeight(building.footprint!.map((p) => toXY(p.lat, p.lng)));
      const [x, y] = project({ ...view, k: 1 }, 400, 600, 0, 0, hgt);
      // 丸薬(幅 43・高さ 26)の中心から右へ 7px の点に、地面の印を 8px 離して置く。
      // 地面の印の中心 = (x + 15, y)、タップ点 = (x + 7, y)。
      const v = { ...view, k: 1 };
      const [, y0] = project(v, 400, 600, 0, 0);
      const [, y1] = project(v, 400, 600, 0, 1);
      const wy = (y - y0) / (y1 - y0); // 地面の y が丸薬の中心の y と同じになる世界座標
      const wc = place('wc', { kind: 'wc', location: fromXY(15, wy) });
      labels.draw(ctx, v, state({ landmarks: [building], places: [place('a', { landmarkId: 'a' }), wc] }), 0);
      const [gx, gy] = project(v, 400, 600, 15, wy);
      expect(gx).toBeCloseTo(x + 15, 5);
      expect(gy).toBeCloseTo(y, 5);
      // タップ点は丸薬の中心から 7px(丸薬の描いた矩形の内側)、地面の印の中心から 8px。
      expect(labels.hitTest!(x + 7, y)).toEqual({ kind: 'place', id: 'a' });
      // 描いた矩形の外(丸薬の幅は 43 なので中心から 21.9px)では、近い(6px)地面の印が勝つ。
      expect(labels.hitTest!(x + 21.9, y)).toEqual({ kind: 'place', id: 'wc' });
    });
  });
});
