import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromXY, toXY } from '../../domain/geo';
import * as domainStamps from '../../domain/stamps';
import type { Place, Stamp } from '../../types';
import * as core from '../core';
import stamps, {
  CLUSTER_PX, clusterMarks, congestionStyle, type Mark, RIPPLE_MS, rippleProgress, STAMP_TOKENS, ZOOMED_K,
} from './stamps';
import type { Layer, MapState, View } from './types';

const now = Date.parse('2026-11-24T03:00:00.000Z');
const view: View = { fx: 10, fy: -20, k: 1, th: 0.4, cy: 250 };
const kinds = ['congestion-1', 'congestion-2', 'congestion-3', 'congestion-4', 'congestion-5',
  'fun', 'food', 'good'] as const;
const levels = [1, 2, 3, 4, 5] as const;

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
function context(dpr = 1, themeName?: 'light' | 'dark') {
  const calls = {
    canvas: {
      width: 640 * dpr, height: 480 * dpr,
      closest: (_selector: string) => (themeName ? { getAttribute: () => themeName } : null),
    },
    getTransform: () => ({ a: dpr, b: 0, c: 0, d: dpr, e: 0, f: 0 }),
    fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1,
    font: '', textAlign: 'start', textBaseline: 'alphabetic', lineCap: '', lineJoin: '',
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    translate: vi.fn(), scale: vi.fn(),
    ellipse: vi.fn(), arc: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    fillText: vi.fn((_text: string, _x: number, _y: number) => (
      { color: calls.fillStyle, opacity: calls.globalAlpha }
    )),
    strokeText: vi.fn(),
    fill: vi.fn((): { color: string; opacity: number } => (
      { color: calls.fillStyle, opacity: calls.globalAlpha }
    )),
    stroke: vi.fn((_path?: unknown): { color: string; opacity: number } => (
      { color: calls.strokeStyle, opacity: calls.globalAlpha }
    )),
  };
  return { calls, ctx: calls as unknown as CanvasRenderingContext2D };
}

beforeEach(() => {
  vi.stubGlobal('Path2D', class { constructor(readonly d: string) {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('混雑のスタイル', () => {
  it('1〜5 で異なるトークン色と対応する数字の色を返す', () => {
    const styles = levels.map(congestionStyle);
    expect(styles.map(({ color }) => color))
      .toEqual(levels.map((level) => STAMP_TOKENS.congestion[level].color));
    expect(new Set(styles.map(({ color }) => color)).size).toBe(5);
    levels.forEach((level) => {
      expect(congestionStyle(level)).toBe(STAMP_TOKENS.congestion[level]);
    });
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

function mark(over: Partial<Mark>): Mark {
  return { family: 'congestion', kind: 'congestion-3', level: 3, X: 0, Y: 0, pressedAt: 0, ...over };
}

describe('Figma のトークン', () => {
  it('Figma の StampMark の色(--app-*)と一致する', () => {
    expect(STAMP_TOKENS.congestion[4]).toEqual({ color: '#c2410c', textColor: '#ffffff' });
    expect(STAMP_TOKENS.congestionBorder).toEqual({ dark: '#fdba74', light: '#c2410c' });
    expect(STAMP_TOKENS.feeling).toEqual({ dark: '#f9a8d4', light: '#f472b6' });
    expect(STAMP_TOKENS.feelingOn).toBe('#1e0b3a');
  });
});

describe('近いスタンプのまとめ', () => {
  it('混雑は一番新しいものが代表で、件数を more に出す', () => {
    const marks = [
      mark({ level: 1, kind: 'congestion-1', pressedAt: 1, X: 0 }),
      mark({ level: 5, kind: 'congestion-5', pressedAt: 3, X: 10 }),
      mark({ level: 2, kind: 'congestion-2', pressedAt: 2, X: 20 }),
    ];
    const out = clusterMarks(marks);
    expect(out).toHaveLength(1);
    expect(out[0].rep.level).toBe(5);
    expect(out[0].more).toBe(2);
  });

  it('感想は一番多い種類が代表(同数なら新しい方)', () => {
    const f = (kind: string, pressedAt: number, X: number) =>
      mark({ family: 'feeling', kind, level: undefined, pressedAt, X });
    const out = clusterMarks([f('fun', 4, 0), f('food', 1, 5), f('food', 2, 9), f('good', 3, 12)]);
    expect(out[0].rep.kind).toBe('food');
    expect(out[0].more).toBe(3);
    const tie = clusterMarks([f('fun', 1, 0), f('good', 2, 5)]);
    expect(tie[0].rep.kind).toBe('good');
  });

  it('24px を超える距離・別の種類はまとめない', () => {
    const out = clusterMarks([
      mark({ X: 0 }), mark({ X: CLUSTER_PX }), mark({ X: CLUSTER_PX + 1 }),
      mark({ family: 'feeling', kind: 'fun', level: undefined, X: 0 }),
    ]);
    expect(out.map((c) => c.more).sort()).toEqual([0, 0, 1]);
  });
});

describe('stamps Layer', () => {
  it('Layer 契約を満たす', () => {
    const layer: Layer = stamps;
    expect(layer.name).toBe('stamps');
    expect(layer.draw).toBeTypeOf('function');
    expect(layer.hitTest).toBeUndefined();
  });

  it('混雑を場所ごとに集計し、Figma の 14px の丸と、DS の数字を場所の location に一度だけ描く', () => {
    const { ctx, calls } = context();
    const venue = place();
    const input = state([stamp('congestion-1'), stamp('congestion-5')], [venue]);
    const aggregate = vi.spyOn(domainStamps, 'congestionByPlace');
    const projection = vi.spyOn(core, 'project');
    stamps.draw(ctx, view, input, 0);

    expect(aggregate).toHaveBeenCalledExactlyOnceWith(input.stamps, input.places, now);
    const [x, y] = toXY(venue.location.lat, venue.location.lng);
    expect(projection).toHaveBeenCalledWith(view, 640, 480, x, y, 0);
    const [X, Y] = core.project(view, 640, 480, x, y, 0);
    expect(calls.arc).toHaveBeenCalledExactlyOnceWith(X, Y, 6.5, 0, Math.PI * 2);
    expect(calls.fill.mock.results.map(({ value }) => value))
      .toEqual([{ color: STAMP_TOKENS.congestion[3].color, opacity: 1 }]);
    expect(calls.stroke.mock.results.map(({ value }) => value))
      .toEqual([{ color: STAMP_TOKENS.congestionBorder.dark, opacity: 1 }]);
    const [ax, ay] = [X, Y];
    expect(calls.fillText).toHaveBeenCalledExactlyOnceWith('3', ax, ay + 0.5);
    expect(calls.fillText.mock.results[0].value)
      .toEqual({ color: STAMP_TOKENS.congestion[3].textColor, opacity: 1 });
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(calls.restore).toHaveBeenCalledTimes(1);
  });

  it('dpr=2 の canvas でも位置は CSS px 基準(内部サイズを DPR で割る)', () => {
    const venue = place();
    const input = state([stamp('congestion-2'), stamp('fun', { at: fromXY(3, 4) })], [venue]);
    const one = context(1);
    const two = context(2);
    stamps.draw(one.ctx, view, input, 0);
    stamps.draw(two.ctx, view, input, 0);
    expect(two.calls.canvas.width).toBe(1280);
    expect(two.calls.arc.mock.calls).toEqual(one.calls.arc.mock.calls);
    const [x, y] = toXY(venue.location.lat, venue.location.lng);
    const [X, Y] = core.project(view, 640, 480, x, y, 0);
    expect(two.calls.arc.mock.calls.some(([ax, ay]) => ax === X && ay === Y)).toBe(true);
  });

  it('混雑の段階は domain が返した結果を使う', () => {
    vi.spyOn(domainStamps, 'congestionByPlace').mockReturnValue(new Map([['venue', 5]]));
    const { ctx, calls } = context();
    stamps.draw(ctx, view, state([stamp('congestion-1')], [place()]), 0);
    expect(calls.fill.mock.results[0].value)
      .toEqual({ color: STAMP_TOKENS.congestion[5].color, opacity: 1 });
  });

  it.each(['dark', 'light'] as const)('%s テーマ(canvas の data-theme)で混雑 1〜5 の地・縁を描く', (theme) => {
    for (const level of levels) {
      const { ctx, calls } = context(1, theme);
      stamps.draw(ctx, view, state([stamp(`congestion-${level}`)], [place()]), 0);
      expect(calls.fill.mock.results[0].value)
        .toEqual({ color: STAMP_TOKENS.congestion[level].color, opacity: 1 });
      expect(calls.stroke.mock.results[0].value)
        .toEqual({ color: STAMP_TOKENS.congestionBorder[theme], opacity: 1 });
      expect(calls.fillText.mock.calls[0][0]).toBe(String(level));
      expect(calls.fillText.mock.results[0].value)
        .toEqual({ color: STAMP_TOKENS.congestion[level].textColor, opacity: 1 });
    }
  });

  it('拡大すると札「混雑3 3分」(混雑の色)を出す', () => {
    const { ctx, calls } = context();
    const zoomed = { ...view, k: ZOOMED_K };
    stamps.draw(ctx, zoomed, state([stamp('congestion-3', {
      pressedAt: new Date(now - 3 * 60_000).toISOString(),
    })], [place()]), 0);
    expect(calls.fillText.mock.calls.map(([text]) => text)).toEqual(['混雑3', '3分']);
    expect(calls.fillText.mock.results[0].value)
      .toEqual({ color: STAMP_TOKENS.congestion[3].textColor, opacity: 1 });
    expect(calls.arc).toHaveBeenCalledTimes(2); // 丸薬の両端
  });

  it('近い 2 か所の混雑は 1 つにまとめ「+1」を札に出す', () => {
    const near: Place = { ...place(), id: 'near', location: fromXY(20.01, 16) };
    const { ctx, calls } = context();
    stamps.draw(ctx, { ...view, k: ZOOMED_K }, state([stamp('congestion-4')], [place(), near]), 0);
    // near には混雑スタンプが割り当たらないので集計は 1 件。別の場所にも押して確認する。
    const second = stamp('congestion-2', { id: 'b', at: fromXY(20.01, 16) });
    const c2 = context();
    stamps.draw(c2.ctx, { ...view, k: ZOOMED_K }, state([stamp('congestion-4', { at: fromXY(20, 16) }), second], [place(), near]), 0);
    expect(c2.calls.fillText.mock.calls.map(([text]) => text).at(-1)).toBe('+1');
    expect(calls.fillText.mock.calls.map(([text]) => text)).not.toContain('+1');
  });

  it.each(['dark', 'light'] as const)('%s: 感想は共通のトークン色の 20px の丸に Path2D のアイコンで描く', (theme) => {
    const { ctx, calls } = context(1, theme);
    const targets = (['fun', 'food', 'good'] as const)
      .map((kind, i) => stamp(kind, { at: fromXY(i * 40, i * 25) }));
    stamps.draw(ctx, view, state(targets), 999999);

    expect(calls.fill.mock.results.map(({ value }) => value))
      .toEqual(targets.map(() => ({ color: STAMP_TOKENS.feeling[theme], opacity: 1 })));
    expect(calls.fillText).not.toHaveBeenCalled();
    targets.forEach((target) => {
      const [x, y] = toXY(target.at.lat, target.at.lng);
      const [X, Y] = core.project(view, 640, 480, x, y, 0);
      expect(calls.arc.mock.calls.some(([ax, ay, r]) => ax === X && ay === Y && r === 9.5)).toBe(true);
    });
    const paths = calls.stroke.mock.calls.map(([path]) => path as { d: string } | undefined)
      .filter((path) => path !== undefined);
    expect(paths).toHaveLength(3);
    expect(calls.scale).toHaveBeenCalledWith(13 / 24, 13 / 24);
  });

  it('拡大すると感想の札「面白い 3分」と、まとめた件数を出す', () => {
    const { ctx, calls } = context();
    const items = [stamp('fun', { pressedAt: new Date(now - 3 * 60_000).toISOString() }),
      stamp('fun', { id: 'x', at: fromXY(12.01, 8) }), stamp('food', { id: 'y', at: fromXY(12.02, 8) })];
    stamps.draw(ctx, { ...view, k: 2 }, state(items), 0);
    expect(calls.fillText.mock.calls.map(([text]) => text)).toEqual(['面白い', '0分', '+2']);
  });

  it('document が無い環境でも例外を出さずダークで描く', () => {
    vi.stubGlobal('document', undefined);
    const { ctx, calls } = context();
    expect(() => stamps.draw(ctx, view, state([stamp('fun')]), 0)).not.toThrow();
    expect(calls.fill.mock.results[0].value.color).toBe(STAMP_TOKENS.feeling.dark);
  });

  it('配列の参照と秒が同じなら集約を再利用し、いずれかが変われば再集約する', () => {
    const aggregate = vi.spyOn(domainStamps, 'congestionByPlace');
    const { ctx } = context();
    let input = state([stamp('congestion-2', {
      expiresAt: new Date(now + 10_000).toISOString(),
    })], [place()]);
    stamps.draw(ctx, view, input, 0);
    stamps.draw(ctx, view, { ...input, now: now + 999 }, 1);
    expect(aggregate).toHaveBeenCalledExactlyOnceWith(input.stamps, input.places, now);

    input = { ...input, stamps: [...input.stamps] };
    stamps.draw(ctx, view, input, 0);
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenLastCalledWith(input.stamps, input.places, now);

    input = { ...input, places: [...input.places] };
    stamps.draw(ctx, view, input, 0);
    expect(aggregate).toHaveBeenCalledTimes(3);
    expect(aggregate).toHaveBeenLastCalledWith(input.stamps, input.places, now);

    stamps.draw(ctx, view, { ...input, now: now + 1000 }, 0);
    expect(aggregate).toHaveBeenCalledTimes(4);
    expect(aggregate).toHaveBeenLastCalledWith(input.stamps, input.places, now + 1000);

    stamps.draw(ctx, view, input, 0);
    expect(aggregate).toHaveBeenCalledTimes(5);
  });

  it('秒が変われば同じ配列でも再集約し、期限切れの混雑を消す', () => {
    const input = state([stamp('congestion-4', {
      expiresAt: new Date(now + 1000).toISOString(),
    })], [place()]);
    const active = context();
    const expired = context();
    const aggregate = vi.spyOn(domainStamps, 'congestionByPlace');
    stamps.draw(active.ctx, view, input, 0);
    stamps.draw(expired.ctx, view, { ...input, now: now + 1000 }, 0);
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(active.calls.arc).toHaveBeenCalledTimes(1);
    expect(expired.calls.fill).not.toHaveBeenCalled();
    expect(active.calls.fillText.mock.calls[0][0]).toBe('4');
    expect(expired.calls.fillText).not.toHaveBeenCalled();
    expect(expired.calls.stroke).not.toHaveBeenCalled();
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
    const markStrokes = kind === 'fun' ? 2 : 0; // 縁+アイコン
    expect(first.calls.stroke).toHaveBeenCalledTimes(markStrokes + 1);
    expect(later.calls.stroke).toHaveBeenCalledTimes(markStrokes + 1);
    expect(later.calls.ellipse.mock.calls[0][2]).toBeGreaterThan(first.calls.ellipse.mock.calls[0][2]);
    expect(later.calls.stroke.mock.results[markStrokes].value.opacity)
      .toBeLessThan(first.calls.stroke.mock.results[markStrokes].value.opacity);
    expect(ended.calls.stroke).toHaveBeenCalledTimes(markStrokes);
  });

  it('描画中に例外が出ても restore する', () => {
    const { ctx, calls } = context();
    calls.fill.mockImplementation(() => { throw new Error('draw failed'); });
    expect(() => stamps.draw(ctx, view, state([stamp('fun')]), 0)).toThrow('draw failed');
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(calls.restore).toHaveBeenCalledTimes(1);
  });
});
