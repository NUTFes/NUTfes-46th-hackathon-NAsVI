import { describe, expect, it, vi } from 'vitest';
import { toXY } from '../../domain/geo';
import type { Destination, Place, Position } from '../../types';
import { project, TILT } from '../core';
import me, { meGeometry } from './me';
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

function context(clientWidth = W, clientHeight = H) {
  const stroke = vi.fn();
  const fill = vi.fn();
  const fake = {
    canvas: { clientWidth, clientHeight, width: W * 2, height: H * 2 },
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(),
    translate: vi.fn(), rotate: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), setLineDash: vi.fn(), stroke, fill,
    globalAlpha: 0.2, lineDashOffset: 99, lineWidth: 10, strokeStyle: '', fillStyle: '',
  };
  stroke.mockImplementation(() => ({
    color: fake.strokeStyle, width: fake.lineWidth, alpha: fake.globalAlpha,
  }));
  fill.mockImplementation(() => fake.fillStyle);
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
      angle: Math.atan2(ay - y, ax - x),
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
    expect(fake.fill.mock.results.map(({ value }) => value)).toEqual(['rgba(94,234,212,0.12)', '#fff']);
    expect(fake.stroke.mock.results.map(({ value }) => value)).toEqual([
      { color: 'rgba(94,234,212,0.35)', width: 1, alpha: 1 },
      { color: 'rgba(255,255,255,0.35)', width: 1.5, alpha: 1 },
      { color: '#1e0b3a', width: 2, alpha: 1 },
    ]);
    expect(fake.setLineDash).toHaveBeenCalledExactlyOnceWith([]);
    expect(fake.lineDashOffset).toBe(0);
    expect(fake.save).toHaveBeenCalledOnce();
    expect(fake.restore).toHaveBeenCalledOnce();
    expect(fake.save.mock.invocationCallOrder[0]).toBeLessThan(fake.ellipse.mock.invocationCallOrder[0]);
    expect(fake.restore.mock.invocationCallOrder[0]).toBeGreaterThan(fake.stroke.mock.invocationCallOrder[2]);
  });

  it.each([0, 350, 1399, 1400, 1750])('脈動は 1400ms 周期で画面 px の半径を使う (t=%s)', (t) => {
    const { ctx, fake } = context();
    me.draw(ctx, { ...view, k: 5 }, state(), t);
    const q = (t / 1400) % 1;
    const r = 8 + q * 34;
    expect(fake.ellipse.mock.calls[1].slice(2)).toEqual([r, r * TILT, 0, 0, Math.PI * 2]);
    expect(fake.stroke.mock.results[1].value.color).toBe(`rgba(255,255,255,${0.7 * (1 - q)})`);
  });

  it.each<Destination | null>([null, { placeId: 'missing' }])('行き先なし・未解決でも現在地は上向きに描く (%o)', (dest) => {
    const { ctx, fake } = context();
    me.draw(ctx, view, state({ destination: dest }), 0);
    expect(fake.rotate).toHaveBeenCalledExactlyOnceWith(0);
    expect(fake.stroke).toHaveBeenCalledTimes(3);
  });

  it.each([[W, H], [0, 0]])('canvas の CSS 寸法を優先し、0 の場合は内部寸法を使う (%s, %s)', (w, h) => {
    const { ctx, fake } = context(w, h);
    const [x, y] = project(view, w || W * 2, h || H * 2, ...toXY(position.lat, position.lng), 0);
    me.draw(ctx, view, state({ position: { ...position, accuracy: 0 } }), 0);
    expect(fake.ellipse.mock.calls[0]).toEqual([x, y, 0, 0, 0, 0, Math.PI * 2]);
  });

  it('描画中に例外が起きても restore する', () => {
    const { ctx, fake } = context();
    fake.ellipse.mockImplementation(() => { throw new Error('描画失敗'); });
    expect(() => me.draw(ctx, view, state(), 0)).toThrow('描画失敗');
    expect(fake.restore).toHaveBeenCalledOnce();
  });
});
