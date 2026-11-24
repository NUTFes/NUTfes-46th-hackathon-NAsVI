import { describe, expect, it, vi } from 'vitest';
import { toXY } from '../../domain/geo';
import type { Destination, Place, Position } from '../../types';
import { project, TILT } from '../core';
import { mapColors } from './buildings';
import me, { ACCURACY_MAX_PX, isStale, meGeometry } from './me';
import type { Layer, MapState, View } from './types';

const view: View = { fx: 10, fy: -20, k: 2.5, th: 0.7, cy: 300 };
const W = 360;
const H = 640;
const position: Position = { lat: 37.4253, lng: 138.7789, accuracy: 12, takenAt: 0 };
const place: Place = {
  id: 'goal', name: '行き先', kind: 'event',
  location: { lat: 37.4258, lng: 138.7795 },
  description: '', landmarkId: null, floor: null, hours: [], labelIds: [],
};
const destination: Destination = { placeId: place.id };

function state(overrides: Partial<MapState> = {}): MapState {
  return {
    places: [place], stamps: [], landmarks: [], position, destination,
    filter: { labelIds: [], tagIds: [] }, now: 0, ...overrides,
  };
}

function context(clientWidth = W, clientHeight = H, theme?: string | null) {
  const host = document.createElement('div');
  if (theme != null) host.setAttribute('data-theme', theme);
  const canvas = document.createElement('canvas');
  host.append(canvas);
  const stroke = vi.fn();
  const fill = vi.fn();
  const fake = {
    canvas: {
      clientWidth, clientHeight, width: W * 2, height: H * 2,
      closest: theme === undefined ? undefined : vi.fn((selector: string) => canvas.closest(selector)),
    },
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(),
    translate: vi.fn(), rotate: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), setLineDash: vi.fn(), stroke, fill,
    globalAlpha: 0.2, lineDashOffset: 99, lineWidth: 10, strokeStyle: '', fillStyle: '',
  };
  stroke.mockImplementation(() => ({
    color: fake.strokeStyle, width: fake.lineWidth, alpha: fake.globalAlpha,
  }));
  fill.mockImplementation(() => ({ color: fake.fillStyle, alpha: fake.globalAlpha }));
  return { ctx: fake as unknown as CanvasRenderingContext2D, fake };
}

describe('meGeometry', () => {
  it('現在地がなければ座標を返さない', () => {
    expect(meGeometry(null, place, view, W, H)).toBeNull();
  });

  it('現在地と行き先を投影して、画面上の向きと精度円の半径を求める', () => {
    const [x, y] = project(view, W, H, ...toXY(position.lat, position.lng), 0);
    const [ax, ay] = project(view, W, H, ...toXY(place.location.lat, place.location.lng), 0);
    expect(meGeometry(position, place, view, W, H)).toEqual({
      x, y, accuracyRx: 30, accuracyRy: 30 * TILT,
      accuracyCapped: false,
      angle: Math.atan2(ay - y, ax - x),
    });
  });

  it.each([NaN, Infinity, -Infinity, -1, 0])('精度 %s では円の半径を 0 にする', (accuracy) => {
    expect(meGeometry({ ...position, accuracy }, place, view, W, H)).toMatchObject({
      accuracyRx: 0, accuracyRy: 0, accuracyCapped: false,
    });
  });

  it.each([120 / view.k, 1e9, Number.MAX_VALUE])('精度 %s の画面半径を 120px 以内に制限する', (accuracy) => {
    expect(ACCURACY_MAX_PX).toBe(120);
    expect(meGeometry({ ...position, accuracy }, place, view, W, H)).toMatchObject({
      accuracyRx: 120, accuracyRy: 120 * TILT,
      accuracyCapped: accuracy * view.k > 120,
    });
  });

  it('行き先なしでは上向き、精度円は視点の回転に依存せず縮尺に比例する', () => {
    for (const th of [0, Math.PI / 2, -1.2]) {
      for (const k of [0.5, 3]) {
        expect(meGeometry(position, null, { ...view, th, k }, W, H)).toMatchObject({
          accuracyRx: position.accuracy * k,
          accuracyRy: position.accuracy * k * TILT,
          angle: -Math.PI / 2,
        });
      }
    }
  });
});

describe('me Layer', () => {
  it('Layer の name と draw の契約を満たす', () => {
    const layer: Layer = me;
    expect(layer.name).toBe('me');
    expect(layer.draw).toBeTypeOf('function');
  });

  it.each([null, destination])('現在地なしでは ctx に一切触れない (行き先: %o)', (dest) => {
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get() { throw new Error('ctx を参照した'); },
      set() { throw new Error('ctx を変更した'); },
    });
    expect(() => me.draw(ctx, view, state({ position: null, destination: dest }), 0)).not.toThrow();
  });

  it('精度円・脈動する輪・行き先を向く矢印を指定の座標とスタイルで描く', () => {
    const { ctx, fake } = context();
    const [x, y] = project(view, W, H, ...toXY(position.lat, position.lng), 0);
    const [ax, ay] = project(view, W, H, ...toXY(place.location.lat, place.location.lng), 0);
    me.draw(ctx, view, state(), 700);

    expect(fake.ellipse.mock.calls).toEqual([
      [x, y, 30, 30 * TILT, 0, 0, Math.PI * 2],
      [x, y, 25, 25 * TILT, 0, 0, Math.PI * 2],
    ]);
    expect(fake.translate).toHaveBeenCalledExactlyOnceWith(x, y - 4);
    expect(fake.rotate).toHaveBeenCalledExactlyOnceWith(Math.atan2(ay - y, ax - x) + Math.PI / 2);
    expect(fake.moveTo.mock.calls).toEqual([[0, -13]]);
    expect(fake.lineTo.mock.calls).toEqual([[9, 8], [0, 3.5], [-9, 8]]);
    expect(fake.closePath).toHaveBeenCalledOnce();
    expect(fake.fill.mock.results.map(({ value }) => value)).toEqual([
      { color: '#5eead4', alpha: 0.12 }, { color: '#ffffff', alpha: 1 },
    ]);
    expect(fake.stroke.mock.results.map(({ value }) => value)).toEqual([
      { color: '#130a22', width: 5, alpha: 0.35 },
      { color: '#5eead4', width: 1, alpha: 0.35 },
      { color: '#130a22', width: 5.5, alpha: 0.35 },
      { color: '#5eead4', width: 1.5, alpha: 0.35 },
      { color: '#130a22', width: 6, alpha: 1 },
      { color: '#1e0b3a', width: 2, alpha: 1 },
    ]);
    expect(fake.setLineDash).toHaveBeenCalledExactlyOnceWith([]);
    expect(fake.lineDashOffset).toBe(0);
    expect(fake.save).toHaveBeenCalledOnce();
    expect(fake.restore).toHaveBeenCalledOnce();
    expect(fake.save.mock.invocationCallOrder[0]).toBeLessThan(fake.ellipse.mock.invocationCallOrder[0]);
    expect(fake.restore.mock.invocationCallOrder[0]).toBeGreaterThan(fake.stroke.mock.invocationCallOrder[5]);
  });

  it.each([
    ['dark', '#5eead4', '#130a22'],
    ['light', '#0f766e', '#f6f4fa'],
    ['unknown', '#5eead4', '#130a22'],
    [null, '#5eead4', '#130a22'],
  ])('DOM のテーマ %s に対応する event・map-ring・白い矢印を描く', (theme, event, ring) => {
    const { ctx, fake } = context(W, H, theme);
    me.draw(ctx, view, state(), 700);
    expect(fake.canvas.closest).toHaveBeenCalledWith('[data-theme]');
    expect(fake.fill.mock.results.map(({ value }) => value)).toEqual([
      { color: event, alpha: 0.12 }, { color: '#ffffff', alpha: 1 },
    ]);
    expect(fake.stroke.mock.results.map(({ value }) => value.color)).toEqual([
      ring, event, ring, event, ring, '#1e0b3a',
    ]);
  });

  it.each([NaN, Infinity, -Infinity, -12, 0])('精度 %s でも輪と矢印は描き、精度円だけ省略する', (accuracy) => {
    const { ctx, fake } = context();
    me.draw(ctx, view, state({ position: { ...position, accuracy } }), 700);
    const [x, y] = project(view, W, H, ...toXY(position.lat, position.lng), 0);
    expect(fake.ellipse.mock.calls).toEqual([[x, y, 25, 25 * TILT, 0, 0, Math.PI * 2]]);
    expect(fake.fill.mock.results.map(({ value }) => value)).toEqual([{ color: '#ffffff', alpha: 1 }]);
    expect(fake.stroke).toHaveBeenCalledTimes(4);
    expect(fake.translate).toHaveBeenCalledExactlyOnceWith(x, y - 4);
    expect(fake.rotate).toHaveBeenCalledOnce();
    expect(fake.setLineDash).toHaveBeenCalledExactlyOnceWith([]);
  });

  it.each([1e9, Number.MAX_VALUE])('巨大な精度 %s は半径 120px の薄い実線の円にする', (accuracy) => {
    const { ctx, fake } = context();
    me.draw(ctx, view, state({ position: { ...position, accuracy } }), 700);
    expect(fake.ellipse.mock.calls[0].slice(2)).toEqual([120, 120 * TILT, 0, 0, Math.PI * 2]);
    expect(fake.fill.mock.results[0].value).toEqual({ color: '#5eead4', alpha: 0.06 });
    expect(fake.stroke.mock.results[1].value).toEqual({ color: '#5eead4', width: 1, alpha: 0.175 });
    expect(fake.setLineDash).toHaveBeenCalledExactlyOnceWith([]);
    expect(fake.stroke.mock.results[3].value).toEqual({ color: '#5eead4', width: 1.5, alpha: 0.35 });
    expect(fake.fill.mock.results[1].value).toEqual({ color: '#ffffff', alpha: 1 });
  });

  it.each([0, 350, 1399, 1400, 1750])('脈動は 1400ms 周期で画面 px の半径を使う (t=%s)', (t) => {
    const { ctx, fake } = context();
    me.draw(ctx, { ...view, k: 5 }, state(), t);
    const q = (t / 1400) % 1;
    const r = 8 + q * 34;
    expect(fake.ellipse.mock.calls[1].slice(2)).toEqual([r, r * TILT, 0, 0, Math.PI * 2]);
    expect(fake.stroke.mock.results[3].value).toEqual({
      color: '#5eead4', width: 1.5, alpha: 0.7 * (1 - q),
    });
  });

  it.each<Destination | null>([null, { placeId: 'missing' }])('行き先なし・未解決でも現在地は上向きに描く (%o)', (dest) => {
    const { ctx, fake } = context();
    me.draw(ctx, view, state({ destination: dest }), 0);
    expect(fake.rotate).toHaveBeenCalledExactlyOnceWith(0);
    expect(fake.stroke).toHaveBeenCalledTimes(6);
  });

  it.each([[W, H], [0, 0]])('canvas の CSS 寸法を優先し、0 の場合は内部寸法を使う (%s, %s)', (w, h) => {
    const { ctx, fake } = context(w, h);
    const [x, y] = project(view, w || W * 2, h || H * 2, ...toXY(position.lat, position.lng), 0);
    me.draw(ctx, view, state({ position: { ...position, accuracy: 0 } }), 0);
    expect(fake.ellipse.mock.calls).toEqual([[x, y, 8, 8 * TILT, 0, 0, Math.PI * 2]]);
  });

  it('描画中に例外が起きても restore する', () => {
    const { ctx, fake } = context();
    fake.ellipse.mockImplementation(() => { throw new Error('描画失敗'); });
    expect(() => me.draw(ctx, view, state(), 0)).toThrow('描画失敗');
    expect(fake.restore).toHaveBeenCalledOnce();
  });
});

describe('PositionMark の古い状態', () => {
  it('古い現在地(30 秒以上)は精度円・輪・矢印を text-disabled の灰色にし、円と輪は破線にする', () => {
    for (const theme of ['dark', 'light'] as const) {
      const { ctx, fake } = context(W, H, theme);
      const fills: unknown[] = [];
      const strokes: unknown[] = [];
      fake.fill.mockImplementation(() => { fills.push(fake.fillStyle); });
      fake.stroke.mockImplementation(() => { strokes.push(fake.strokeStyle); });
      me.draw(ctx, view, state({ now: 30_000 }), 0);
      expect(fake.setLineDash.mock.calls[0]).toEqual([[4, 4]]);
      expect(fake.setLineDash).toHaveBeenLastCalledWith([]); // 矢印の縁は実線
      expect(fills.at(-1)).toBe(mapColors['text-disabled'][theme]);
      expect(fills[0]).toBe(mapColors['text-disabled'][theme]);
      expect(strokes).toContain(mapColors['text-disabled'][theme]);
      expect(strokes).not.toContain(mapColors.event[theme]);
    }
  });

  it('新しい現在地(30 秒未満)・時計が戻った場合は通常色(event・白)のまま', () => {
    for (const now of [29_999, -1, Number.NaN]) {
      const { ctx, fake } = context();
      const fills: unknown[] = [];
      fake.fill.mockImplementation(() => { fills.push(fake.fillStyle); });
      me.draw(ctx, view, state({ now }), 0);
      expect(fake.setLineDash).toHaveBeenCalledExactlyOnceWith([]);
      expect(fills.at(-1)).toBe('#ffffff');
      expect(fills[0]).toBe(mapColors.event.dark);
    }
  });

  it('isStale は 30 秒ちょうどから古いとする', () => {
    expect(isStale({ ...position, takenAt: 1000 }, 30_999)).toBe(false);
    expect(isStale({ ...position, takenAt: 1000 }, 31_000)).toBe(true);
  });
});
