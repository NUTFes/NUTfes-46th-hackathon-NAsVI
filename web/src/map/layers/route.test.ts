import { describe, expect, it, vi } from 'vitest';
import { toXY } from '../../domain/geo';
import type { Destination, Place, Position } from '../../types';
import { project, TILT } from '../core';
import route, { dashStyle, routeGeometry } from './route';
import type { Layer, MapState, View } from './types';

const view: View = { fx: -10, fy: 20, k: 3, th: -0.8, cy: 280 };
const W = 400;
const H = 700;
const position: Position = { lat: 37.4254, lng: 138.7787, accuracy: 10, takenAt: 0 };
const place: Place = {
  id: 'goal', name: '行き先', kind: 'event',
  location: { lat: 37.426, lng: 138.7794 },
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
  const fake = {
    canvas: {
      clientWidth, clientHeight, width: W * 2, height: H * 2,
      closest: theme === undefined ? undefined : vi.fn((selector: string) => canvas.closest(selector)),
    },
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), setLineDash: vi.fn(), stroke,
    globalAlpha: 0.2, lineDashOffset: 99, lineWidth: 10, strokeStyle: '',
    lineCap: 'butt', lineJoin: 'miter',
  };
  stroke.mockImplementation(() => ({
    color: fake.strokeStyle, width: fake.lineWidth, alpha: fake.globalAlpha,
    offset: fake.lineDashOffset, cap: fake.lineCap, join: fake.lineJoin,
  }));
  return { ctx: fake as unknown as CanvasRenderingContext2D, fake };
}

describe('routeGeometry', () => {
  it('現在地と place.location を地面上のメートル座標に変換する', () => {
    expect(routeGeometry(position, place)).toEqual({
      from: toXY(position.lat, position.lng),
      to: toXY(place.location.lat, place.location.lng),
    });
  });

  it.each<[Position | null, Place | null]>([
    [null, null], [null, place], [position, null],
  ])('どちらかがなければ直線を作らない (%o, %o)', (pos, dest) => {
    expect(routeGeometry(pos, dest)).toBeNull();
  });

  it('現在地と行き先が同じ地点なら両端が一致する', () => {
    const geometry = routeGeometry(position, { ...place, location: { lat: position.lat, lng: position.lng } });
    expect(geometry?.from).toEqual(geometry?.to);
  });
});

describe('dashStyle', () => {
  it.each([0.5, 1, 5 / 2.4, 3, 5])('縮尺 %s でモックと同じ線幅と間隔を返す', (k) => {
    const width = Math.max(5, k * 2.4);
    expect(dashStyle(k)).toEqual({ width, dash: [0.1, width * 2.2] });
  });
});

describe('route Layer', () => {
  it('Layer の name と draw の契約を満たす', () => {
    const layer: Layer = route;
    expect(layer.name).toBe('route');
    expect(layer.draw).toBeTypeOf('function');
  });

  it.each<Partial<MapState>>([
    { position: null, destination: null },
    { destination: null },
    { places: [] },
  ])('行き先がなければ ctx に一切触れない (%o)', (overrides) => {
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get() { throw new Error('ctx を参照した'); },
      set() { throw new Error('ctx を変更した'); },
    });
    expect(() => route.draw(ctx, view, state(overrides), 0)).not.toThrow();
  });

  it.each([position, null])('placeId が places に存在しない場合は ctx に一切触れない (現在地: %o)', (pos) => {
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get() { throw new Error('ctx を参照した'); },
      set() { throw new Error('ctx を変更した'); },
    });
    expect(() => route.draw(ctx, view, state({
      position: pos, destination: { placeId: 'missing' },
    }), 0)).not.toThrow();
  });

  it.each([[W, H], [0, 0]])('投影した両端を直線で結び、行き先の地面にリングを描く (%s, %s)', (w, h) => {
    const { ctx, fake } = context(w, h);
    const width = w || W * 2;
    const height = h || H * 2;
    const [x, y] = project(view, width, height, ...toXY(position.lat, position.lng), 0);
    const [ax, ay] = project(view, width, height, ...toXY(place.location.lat, place.location.lng), 0);
    // 行き先と異なる場所を先頭に置き、placeId で選ぶことも確認する。
    const other = { ...place, id: 'other', location: position };
    route.draw(ctx, view, state({ places: [other, place] }), 1000);

    expect(fake.moveTo.mock.calls).toEqual([[x, y]]);
    expect(fake.lineTo.mock.calls).toEqual([[ax, ay]]);
    expect(fake.ellipse.mock.calls).toEqual([[ax, ay, 14, 14 * TILT, 0, 0, Math.PI * 2]]);
    expect(fake.setLineDash.mock.calls).toEqual([[[0.1, 3 * 2.4 * 2.2]], [[]]]);
    expect(fake.stroke.mock.results.map(({ value }) => value)).toEqual([
      { color: '#ffd84a', width: 3 * 2.4, alpha: 1, offset: -30, cap: 'round', join: 'round' },
      { color: '#130a22', width: 10, alpha: 1, offset: 0, cap: 'round', join: 'round' },
      { color: '#ffd84a', width: 6, alpha: 1, offset: 0, cap: 'round', join: 'round' },
      { color: '#ffd84a', width: 3, alpha: 1, offset: 0, cap: 'round', join: 'round' },
    ]);
    expect(fake.save).toHaveBeenCalledOnce();
    expect(fake.restore).toHaveBeenCalledOnce();
    expect(fake.save.mock.invocationCallOrder[0]).toBeLessThan(fake.moveTo.mock.invocationCallOrder[0]);
    expect(fake.restore.mock.invocationCallOrder[0]).toBeGreaterThan(fake.stroke.mock.invocationCallOrder[3]);
  });

  it.each([
    ['dark', '#ffd84a', '#ffd84a', '#130a22'],
    ['light', '#facc15', '#1e0b3a', '#f6f4fa'],
    ['unknown', '#ffd84a', '#ffd84a', '#130a22'],
    [null, '#ffd84a', '#ffd84a', '#130a22'],
  ])('DOM のテーマ %s のトークンで点線・リング・外側の縁を描く', (theme, dest, border, ring) => {
    const { ctx, fake } = context(W, H, theme);
    route.draw(ctx, view, state(), 1000);
    expect(fake.canvas.closest).toHaveBeenCalledWith('[data-theme]');
    expect(fake.stroke.mock.results.map(({ value }) => ({ color: value.color, width: value.width }))).toEqual([
      { color: border, width: 3 * 2.4 },
      { color: ring, width: 10 },
      { color: border, width: 6 },
      { color: dest, width: 3 },
    ]);
    expect(fake.setLineDash.mock.calls).toEqual([[[0.1, 3 * 2.4 * 2.2]], [[]]]);
    const [ax, ay] = project(view, W, H, ...toXY(place.location.lat, place.location.lng), 0);
    expect(fake.ellipse).toHaveBeenCalledExactlyOnceWith(ax, ay, 14, 14 * TILT, 0, 0, Math.PI * 2);
  });

  it.each(['dark', 'light'])('現在地が null でも行き先リングだけを描く (%s)', (theme) => {
    const { ctx, fake } = context(W, H, theme);
    route.draw(ctx, view, state({ position: null }), 1000);
    const [ax, ay] = project(view, W, H, ...toXY(place.location.lat, place.location.lng), 0);
    expect(fake.ellipse).toHaveBeenCalledExactlyOnceWith(ax, ay, 14, 14 * TILT, 0, 0, Math.PI * 2);
    expect(fake.moveTo).not.toHaveBeenCalled();
    expect(fake.lineTo).not.toHaveBeenCalled();
    expect(fake.setLineDash).toHaveBeenCalledExactlyOnceWith([]);
    expect(fake.stroke.mock.results.map(({ value }) => ({ color: value.color, width: value.width, offset: value.offset }))).toEqual([
      { color: theme === 'light' ? '#f6f4fa' : '#130a22', width: 10, offset: 0 },
      { color: theme === 'light' ? '#1e0b3a' : '#ffd84a', width: 6, offset: 0 },
      { color: theme === 'light' ? '#facc15' : '#ffd84a', width: 3, offset: 0 },
    ]);
    expect(fake.save).toHaveBeenCalledOnce();
    expect(fake.restore).toHaveBeenCalledOnce();
  });

  it.each([0, 200, 1400])('点線は t=%s からオフセットを計算し、リングは実線に戻す', (t) => {
    const { ctx, fake } = context();
    route.draw(ctx, { ...view, k: 1 }, state(), t);
    expect(fake.stroke.mock.results[0].value).toMatchObject({ width: 5, offset: -t * 0.03 });
    expect(fake.setLineDash).toHaveBeenNthCalledWith(2, []);
    expect(fake.stroke.mock.results[1].value.offset).toBe(0);
  });

  it('描画中に例外が起きても restore する', () => {
    const { ctx, fake } = context();
    fake.stroke.mockImplementation(() => { throw new Error('描画失敗'); });
    expect(() => route.draw(ctx, view, state(), 0)).toThrow('描画失敗');
    expect(fake.restore).toHaveBeenCalledOnce();
  });
});
