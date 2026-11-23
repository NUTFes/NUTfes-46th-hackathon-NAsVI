import { toXY } from '../../domain/geo';
import { congestionByPlace, isExpired } from '../../domain/stamps';
import type { Stamp } from '../../types';
import { project, TILT } from '../core';
import type { Layer } from './types';

type CongestionLevel = 1 | 2 | 3 | 4 | 5;
const CONGESTION_COLORS = ['#5eead4', '#a3e635', '#ffd84a', '#fb923c', '#f87171'] as const;
const MARKS = {
  fun: { color: '#a78bfa', text: '楽' },
  food: { color: '#fb923c', text: '食' },
  good: { color: '#38bdf8', text: '良' },
} as const;

export const RIPPLE_MS = 2000;

/** 混雑が高いほど濃くする。返り値は呼び出しごとに独立した描画スタイル。 */
export function congestionStyle(level: CongestionLevel): { color: string; opacity: number } {
  return { color: CONGESTION_COLORS[level - 1], opacity: 0.18 + (level - 1) * 0.12 };
}

/** 押下時を 0、終了直前を 1 未満とする。未来・終了後・不正な時刻は対象外。 */
export function rippleProgress(stamp: Stamp, now: number): number | null {
  const elapsed = now - Date.parse(stamp.pressedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < RIPPLE_MS
    ? elapsed / RIPPLE_MS
    : null;
}

const stamps: Layer = {
  name: 'stamps',
  draw(ctx, view, state, _t) {
    const congestion = congestionByPlace(state.stamps, state.places, state.now);
    const activeStamps = state.stamps.filter((stamp) => !isExpired(stamp, state.now));
    // 空の状態では canvas API に触れない。
    if (congestion.size === 0 && activeStamps.length === 0) return;

    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.save();
    try {
      for (const place of state.places) {
        const level = congestion.get(place.id);
        if (level === undefined) continue;
        const [x, y] = toXY(place.location.lat, place.location.lng);
        const [X, Y] = project(view, W, H, x, y, 0);
        const style = congestionStyle(level);
        const radius = 14 * view.k;
        ctx.fillStyle = style.color;
        ctx.globalAlpha = style.opacity;
        ctx.beginPath();
        ctx.ellipse(X, Y, radius, radius * TILT, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const stamp of activeStamps) {
        const mark = stamp.kind === 'fun' || stamp.kind === 'food' || stamp.kind === 'good'
          ? MARKS[stamp.kind]
          : undefined;
        const progress = rippleProgress(stamp, state.now);
        if (!mark && progress === null) continue;
        const [x, y] = toXY(stamp.at.lat, stamp.at.lng);
        const [X, Y] = project(view, W, H, x, y, 0);

        if (mark) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = mark.color;
          ctx.beginPath();
          ctx.arc(X, Y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(mark.text, X, Y);
        }

        if (progress !== null) {
          const radius = (6 + progress * 22) * view.k;
          ctx.globalAlpha = 1 - progress;
          ctx.strokeStyle = mark?.color ?? CONGESTION_COLORS[0];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(X, Y, radius, radius * TILT, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    } finally {
      ctx.restore();
    }
  },
};

export default stamps;
