import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Place, Stamp } from '../types';
import * as geo from './geo';
import { CONGESTION_RADIUS_M, congestionByPlace, isExpired } from './stamps';

const now = Date.parse('2026-11-24T03:00:00.000Z');

function place(id: string, x = 0, y = 0): Place {
  return {
    id, name: id, kind: 'event', location: geo.fromXY(x, y), description: '',
    landmarkId: null, floor: null, hours: [], labelIds: [],
  };
}

function stamp(id: string, kind: Stamp['kind'], x = 0, y = 0, expiresAt = now + 1): Stamp {
  return {
    id, kind, at: geo.fromXY(x, y),
    pressedAt: '2026-11-24T02:30:00.000Z', expiresAt: new Date(expiresAt).toISOString(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('スタンプの期限', () => {
  it.each([
    ['直前', now - 1, false],
    ['ちょうど', now, true],
    ['直後', now + 1, true],
  ])('期限の%sを epoch ms と Date で判定する', (_name, time, expected) => {
    const target = stamp('a', 'congestion-1', 0, 0, now);
    expect(isExpired(target, time)).toBe(expected);
    expect(isExpired(target, new Date(time))).toBe(expected);
  });

  it('種類や押した時刻ではなくサーバーの expiresAt を使う', () => {
    expect(isExpired(stamp('a', 'fun', 0, 0, now + 1), now)).toBe(false);
    expect(isExpired(stamp('b', 'good', 0, 0, now), now)).toBe(true);
  });
});

describe('場所ごとの混雑', () => {
  it('最寄りの場所だけに割り当てて平均を四捨五入する', () => {
    const places = [place('a'), place('b', 20), place('empty', 100)];
    const stamps = [
      stamp('a1', 'congestion-1', 1),
      stamp('a2', 'congestion-2', 2),
      stamp('b1', 'congestion-3', 19),
      stamp('b2', 'congestion-4', 18),
      stamp('b3', 'congestion-3', 17),
    ];
    expect(congestionByPlace(stamps, places, now)).toEqual(new Map([['a', 2], ['b', 3]]));
  });

  it.each([1, 2, 3, 4, 5] as const)('濃淡 %s の混雑を集計する', (level) => {
    expect(congestionByPlace([stamp('a', `congestion-${level}`)], [place('a')], now))
      .toEqual(new Map([['a', level]]));
  });

  it('期限切れと感想を除き、期限直前の混雑だけを使う', () => {
    const stamps = [
      stamp('active', 'congestion-2', 0, 0, now + 1),
      stamp('boundary', 'congestion-5', 0, 0, now),
      stamp('expired', 'congestion-5', 0, 0, now - 1),
      stamp('fun', 'fun'), stamp('food', 'food'), stamp('good', 'good'),
    ];
    expect(congestionByPlace(stamps, [place('a')], now)).toEqual(new Map([['a', 2]]));
    expect(congestionByPlace(stamps.slice(1), [place('a')], now)).toEqual(new Map());
  });

  it('30 m 以内だけを対象にする', () => {
    expect(CONGESTION_RADIUS_M).toBe(30);
    const stamps = [
      stamp('inside', 'congestion-2', 29.99),
      stamp('outside', 'congestion-5', 30.01),
      stamp('far', 'congestion-5', 100),
    ];
    expect(congestionByPlace(stamps, [place('a')], now)).toEqual(new Map([['a', 2]]));
  });

  it('距離がちょうど 30 m なら含め、超えたら含めない', () => {
    // 緯度経度の往復による丸め誤差を避け、距離の境界そのものを検証する。
    const distance = vi.spyOn(geo, 'distanceM').mockReturnValue(30);
    const stamps = [stamp('a', 'congestion-4')];
    const places = [place('a')];
    expect(congestionByPlace(stamps, places, now)).toEqual(new Map([['a', 4]]));
    distance.mockReturnValue(30.000001);
    expect(congestionByPlace(stamps, places, now)).toEqual(new Map());
  });

  it('同距離の場所には places の先頭 1 か所だけに割り当てる(仮置き)', () => {
    const places = [place('first'), place('second')];
    expect(congestionByPlace([stamp('a', 'congestion-3')], places, now))
      .toEqual(new Map([['first', 3]]));
  });

  it('スタンプまたは場所が空なら空の Map を返す', () => {
    expect(congestionByPlace([], [place('a')], now)).toEqual(new Map());
    expect(congestionByPlace([stamp('a', 'congestion-3')], [], now)).toEqual(new Map());
  });

  it('Date を受け取り、now 省略時は Date.now() を使う', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const stamps = [stamp('a', 'congestion-2'), stamp('expired', 'congestion-5', 0, 0, now)];
    const places = [place('a')];
    expect(congestionByPlace(stamps, places, new Date(now))).toEqual(new Map([['a', 2]]));
    expect(congestionByPlace(stamps, places)).toEqual(new Map([['a', 2]]));
  });

  it('入力の配列やオブジェクトを変更しない', () => {
    const stamps = [stamp('a', 'congestion-2'), stamp('b', 'congestion-4', 5)];
    const places = [place('a')];
    const before = structuredClone({ stamps, places });
    congestionByPlace(stamps, places, now);
    expect({ stamps, places }).toEqual(before);
  });
});
