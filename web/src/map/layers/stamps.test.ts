import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromXY, toXY } from '../../domain/geo';
import * as domainStamps from '../../domain/stamps';
import type { Place, Stamp } from '../../types';
import * as core from '../core';
import stamps, { congestionStyle, RIPPLE_MS, rippleProgress } from './stamps';
import type { Layer, MapState, View } from './types';

const now = Date.parse('2026-11-24T03:00:00.000Z');
const view: View = { fx: 10, fy: -20, k: 2, th: 0.4, cy: 250 };
const kinds = ['congestion-1', 'congestion-2', 'congestion-3', 'congestion-4', 'congestion-5',
  'fun', 'food', 'good'] as const;

function stamp(kind: Stamp['kind'], overrides: Partial<Stamp> = {}): Stamp {
  return {
    id: kind, kind, at: fromXY(12, 8),
    pressedAt: new Date(now - RIPPLE_MS).toISOString(),
    expiresAt: new Date(now + 1).toISOString(),
    ...overrides,
  };
}

function place(): Place {
  return {
    id: 'venue', name: '会場', kind: 'event', location: fromXY(20, 16),
    description: '', landmarkId: null, floor: null, hours: [], labelIds: [],
  };
}

function state(items: Stamp[], places: Place[] = []): MapState {
  return {
    places, stamps: items, landmarks: [], position: null, destination: null,
    filter: { labelIds: [], tagIds: [] }, now,
  };
}

/** 描画時の色と透明度も記録する。実際の DOM や canvas は使わない。 */
function context() {
  const calls = {
    canvas: { width: 640, height: 480 },
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1,
    font: '', textAlign: 'start', textBaseline: 'alphabetic',
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(),
    ellipse: vi.fn(), arc: vi.fn(), fillText: vi.fn(),
    fill: vi.fn((): { color: string; opacity: number } => (
      { color: calls.fillStyle, opacity: calls.globalAlpha }
    )),
    stroke: vi.fn((): { color: string; opacity: number } => (
      { color: calls.strokeStyle, opacity: calls.globalAlpha }
    )),
  };
  return { calls, ctx: calls as unknown as CanvasRenderingContext2D };
}

afterEach(() => vi.restoreAllMocks());

describe('混雑のスタイル', () => {
  it('5 色を使い、1 から 5 まで不透明度が単調に増える', () => {
    const styles = ([1, 2, 3, 4, 5] as const).map(congestionStyle);
    expect(styles.map(({ color }) => color))
      .toEqual(['#5eead4', '#a3e635', '#ffd84a', '#fb923c', '#f87171']);
    expect(new Set(styles.map((style) => JSON.stringify(style))).size).toBe(5);
    for (let i = 0; i < styles.length; i++) {
      expect(styles[i].opacity).toBeGreaterThan(0);
      expect(styles[i].opacity).toBeLessThanOrEqual(1);
      if (i > 0) expect(styles[i].opacity).toBeGreaterThan(styles[i - 1].opacity);
    }
  });
});

describe('波紋の進行度', () => {
  const target = stamp('fun', { pressedAt: new Date(now).toISOString() });

  it.each([
    [-1, null], [0, 0], [RIPPLE_MS / 2, 0.5],
    [RIPPLE_MS - 1, (RIPPLE_MS - 1) / RIPPLE_MS],
    [RIPPLE_MS, null], [RIPPLE_MS + 1, null],
  ] as const)('押下から %s ms の進行度は %s', (elapsed, expected) => {
    expect(rippleProgress(target, now + elapsed)).toBe(expected);
  });

  it('不正な時刻は対象外', () => {
    expect(rippleProgress({ ...target, pressedAt: 'invalid' }, now)).toBeNull();
    expect(rippleProgress(target, NaN)).toBeNull();
  });
});

describe('stamps Layer', () => {
  it('Layer 契約を満たす', () => {
    const layer: Layer = stamps;
    expect(layer.name).toBe('stamps');
    expect(layer.draw).toBeTypeOf('function');
    expect(layer.hitTest).toBeUndefined();
  });

  it('混雑を場所ごとに集計し、場所の location に一度だけ描く', () => {
    const { ctx, calls } = context();
    const venue = place();
    const input = state([stamp('congestion-1'), stamp('congestion-5')], [venue]);
    const aggregate = vi.spyOn(domainStamps, 'congestionByPlace');
    const projection = vi.spyOn(core, 'project');
    stamps.draw(ctx, view, input, 0);

    expect(aggregate).toHaveBeenCalledExactlyOnceWith(input.stamps, input.places, now);
    const [x, y] = toXY(venue.location.lat, venue.location.lng);
    expect(projection).toHaveBeenCalledExactlyOnceWith(view, 640, 480, x, y, 0);
    const [X, Y] = core.project(view, 640, 480, x, y, 0);
    expect(calls.ellipse).toHaveBeenCalledExactlyOnceWith(
      X, Y, 14 * view.k, 14 * view.k * core.TILT, 0, 0, Math.PI * 2,
    );
    expect(calls.fill.mock.results.map(({ value }) => value)).toEqual([congestionStyle(3)]);
    expect(calls.stroke).not.toHaveBeenCalled();
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(calls.restore).toHaveBeenCalledTimes(1);
  });

  it('混雑の段階は domain が返した結果を使う', () => {
    vi.spyOn(domainStamps, 'congestionByPlace').mockReturnValue(new Map([['venue', 5]]));
    const { ctx, calls } = context();
    stamps.draw(ctx, view, state([stamp('congestion-1')], [place()]), 0);
    expect(calls.fill.mock.results[0].value).toEqual(congestionStyle(5));
  });

  it.each(kinds)('%s は expiresAt 以降にマーク・濃淡・波紋を描かない', (kind) => {
    const target = stamp(kind, {
      pressedAt: new Date(now - RIPPLE_MS / 2).toISOString(),
      expiresAt: new Date(now).toISOString(),
    });
    for (const time of [now, now + 1]) {
      const { ctx, calls } = context();
      stamps.draw(ctx, view, { ...state([target], [place()]), now: time }, 0);
      expect(calls.fill).not.toHaveBeenCalled();
      expect(calls.fillText).not.toHaveBeenCalled();
      expect(calls.stroke).not.toHaveBeenCalled();
      expect(calls.ellipse).not.toHaveBeenCalled();
      expect(calls.arc).not.toHaveBeenCalled();
    }
    const active = context();
    stamps.draw(active.ctx, view, { ...state([target], [place()]), now: now - 1 }, 0);
    expect(active.calls.fill).toHaveBeenCalledTimes(1);
    expect(active.calls.stroke).toHaveBeenCalledTimes(1);
  });

  it('fun / food / good のマークをそれぞれの stamp.at に異なる文字と色で描く', () => {
    const { ctx, calls } = context();
    const targets = (['fun', 'food', 'good'] as const)
      .map((kind, i) => stamp(kind, { at: fromXY(i * 10, i * 5) }));
    stamps.draw(ctx, view, state(targets), 999999);

    expect(calls.fill).toHaveBeenCalledTimes(3);
    expect(new Set(calls.fill.mock.results.map(({ value }) => value.color)).size).toBe(3);
    expect(new Set(calls.fillText.mock.calls.map(([text]) => text)).size).toBe(3);
    targets.forEach((target, i) => {
      const [x, y] = toXY(target.at.lat, target.at.lng);
      const [X, Y] = core.project(view, 640, 480, x, y, 0);
      expect(calls.arc.mock.calls[i].slice(0, 2)).toEqual([X, Y]);
      expect(calls.fillText.mock.calls[i].slice(1)).toEqual([X, Y]);
    });
    expect(calls.stroke).not.toHaveBeenCalled();
  });

  it.each(['fun', 'congestion-2'] as const)('%s の波紋は t に依存せず state.now に応じて広がって消える', (kind) => {
    const target = stamp(kind, {
      pressedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + RIPPLE_MS + 1).toISOString(),
    });
    const input = state([target]);
    const first = context();
    const sameTime = context();
    const later = context();
    const ended = context();
    stamps.draw(first.ctx, view, input, 0);
    stamps.draw(sameTime.ctx, view, input, 999999);
    stamps.draw(later.ctx, view, { ...input, now: now + RIPPLE_MS / 2 }, 0);
    stamps.draw(ended.ctx, view, { ...input, now: now + RIPPLE_MS }, 0);

    expect(first.calls.ellipse.mock.calls).toEqual(sameTime.calls.ellipse.mock.calls);
    expect(first.calls.stroke.mock.results).toEqual(sameTime.calls.stroke.mock.results);
    expect(first.calls.stroke).toHaveBeenCalledTimes(1);
    expect(later.calls.stroke).toHaveBeenCalledTimes(1);
    expect(later.calls.ellipse.mock.calls[0][2]).toBeGreaterThan(first.calls.ellipse.mock.calls[0][2]);
    expect(later.calls.stroke.mock.results[0].value.opacity)
      .toBeLessThan(first.calls.stroke.mock.results[0].value.opacity);
    expect(ended.calls.stroke).not.toHaveBeenCalled();
  });

  it('描画中に例外が出ても restore する', () => {
    const { ctx, calls } = context();
    calls.fill.mockImplementation(() => { throw new Error('draw failed'); });
    expect(() => stamps.draw(ctx, view, state([stamp('fun')]), 0)).toThrow('draw failed');
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(calls.restore).toHaveBeenCalledTimes(1);
  });
});
