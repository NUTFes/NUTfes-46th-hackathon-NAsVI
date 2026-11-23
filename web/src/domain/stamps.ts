import type { Place, Stamp } from '../types';
import { distanceM } from './geo';

type CongestionLevel = 1 | 2 | 3 | 4 | 5;

// 仮置き: 混雑スタンプを最寄りの場所に割り当てる上限距離(メートル)。
export const CONGESTION_RADIUS_M = 30;

/** expiresAt と同時刻から期限切れとする(API-38)。 */
export function isExpired(stamp: Stamp, now: Date | number): boolean {
  const nowMs = now instanceof Date ? now.getTime() : now;
  return nowMs >= Date.parse(stamp.expiresAt);
}

/** 有効な混雑スタンプから場所ごとの濃淡を計算する。 */
export function congestionByPlace(
  stamps: readonly Stamp[],
  places: readonly Place[],
  now: Date | number = Date.now(),
): Map<Place['id'], CongestionLevel> {
  const totals = new Map<Place['id'], { sum: number; count: number }>();

  // 仮置き: 30 m 以内の最寄り 1 か所に割り当てる。同距離なら places の先頭を使う。
  for (const stamp of stamps) {
    if (isExpired(stamp, now) || !stamp.kind.startsWith('congestion-')) continue;

    let nearest: Place | undefined;
    let nearestDistance = Infinity;
    for (const place of places) {
      const distance = distanceM(stamp.at, place.location);
      if (distance < nearestDistance) {
        nearest = place;
        nearestDistance = distance;
      }
    }
    if (!nearest || nearestDistance > CONGESTION_RADIUS_M) continue;

    const level = Number(stamp.kind.slice('congestion-'.length));
    const total = totals.get(nearest.id) ?? { sum: 0, count: 0 };
    totals.set(nearest.id, { sum: total.sum + level, count: total.count + 1 });
  }

  // 仮置き: 平均を四捨五入して 1〜5 に収める。スタンプのない場所は返さない。
  const result = new Map<Place['id'], CongestionLevel>();
  for (const [placeId, { sum, count }] of totals) {
    result.set(placeId, Math.min(5, Math.max(1, Math.round(sum / count))) as CongestionLevel);
  }
  return result;
}
