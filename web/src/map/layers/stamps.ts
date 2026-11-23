import { toXY } from '../../domain/geo';
import { congestionByPlace, isExpired } from '../../domain/stamps';
import type { Stamp } from '../../types';
import { project, TILT } from '../core';
import type { Layer, MapState } from './types';

type CongestionLevel = 1 | 2 | 3 | 4 | 5;

// Canvas 用の解決済み値。
// 出典: design-system/claude-design/tokens.css / design-system/tokens.json。
export const STAMP_TOKENS = {
  congestion: {
    1: {
      // --congestion-1 → --orange-100 (両テーマ)
      color: '#ffedd5',
      // --congestion-1-on → --violet-950 (両テーマ)
      textColor: '#1e0b3a',
    },
    2: {
      // --congestion-2 → --orange-300 (両テーマ)
      color: '#fdba74',
      // --congestion-2-on → --violet-950 (両テーマ)
      textColor: '#1e0b3a',
    },
    3: {
      // --congestion-3 → --orange-500 (両テーマ)
      color: '#f97316',
      // --congestion-3-on → --violet-950 (両テーマ)
      textColor: '#1e0b3a',
    },
    4: {
      // --congestion-4 → --orange-700 (両テーマ)
      color: '#c2410c',
      // --congestion-4-on → --white (両テーマ)
      textColor: '#ffffff',
    },
    5: {
      // --congestion-5 → --orange-900 (両テーマ)
      color: '#7c2d12',
      // --congestion-5-on → --white (両テーマ)
      textColor: '#ffffff',
    },
  },
  congestionBorder: {
    // --congestion-border → --orange-300 (dark)
    dark: '#fdba74',
    // --congestion-border → --orange-700 (light)
    light: '#c2410c',
  },
  feeling: {
    // --feeling → --pink-300 (dark)
    dark: '#f9a8d4',
    // --feeling → --pink-400 (light)
    light: '#f472b6',
  },
  // --feeling-on → --violet-950 (両テーマ)
  feelingOn: '#1e0b3a',
  mapRing: {
    // --map-ring → --ink-900 (dark)
    dark: '#130a22',
    // --map-ring → --violet-50 (light)
    light: '#f6f4fa',
  },
} as const;
const MARKS = { fun: '楽', food: '食', good: '良' } as const;

export const RIPPLE_MS = 2000;

/** 混雑は両テーマ共通の段階色と数字の色を使う。 */
export function congestionStyle(level: CongestionLevel) {
  return STAMP_TOKENS.congestion[level];
}

function theme(): 'dark' | 'light' {
  return typeof document !== 'undefined'
    && document?.documentElement?.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

let congestionCache: {
  stamps: MapState['stamps'];
  places: MapState['places'];
  second: number;
  value: ReturnType<typeof congestionByPlace>;
} | undefined;

function cachedCongestion(state: MapState): ReturnType<typeof congestionByPlace> {
  const second = Math.floor(state.now / 1000);
  if (congestionCache?.stamps === state.stamps
    && congestionCache.places === state.places
    && congestionCache.second === second) return congestionCache.value;

  const value = congestionByPlace(state.stamps, state.places, state.now);
  congestionCache = { stamps: state.stamps, places: state.places, second, value };
  return value;
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
    const congestion = cachedCongestion(state);
    const activeStamps = state.stamps.filter((stamp) => !isExpired(stamp, state.now));
    // 空の状態では canvas API に触れない。
    if (congestion.size === 0 && activeStamps.length === 0) return;

    const currentTheme = theme();
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
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(X, Y, radius, radius * TILT, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = STAMP_TOKENS.congestionBorder[currentTheme];
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = style.textColor;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(level), X, Y);
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
          ctx.fillStyle = STAMP_TOKENS.feeling[currentTheme];
          ctx.beginPath();
          ctx.arc(X, Y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = STAMP_TOKENS.mapRing[currentTheme];
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = STAMP_TOKENS.feelingOn;
          ctx.font = '11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(mark, X, Y);
        }

        if (progress !== null) {
          const radius = (6 + progress * 22) * view.k;
          ctx.globalAlpha = 1 - progress;
          ctx.strokeStyle = STAMP_TOKENS.mapRing[currentTheme];
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
