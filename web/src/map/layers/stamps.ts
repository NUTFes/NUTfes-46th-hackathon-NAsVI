import { appColors } from '../../app/tokens';
import { CONGESTION_RADIUS_M, congestionByPlace, isExpired } from '../../domain/stamps';
import { distanceM, toXY } from '../../domain/geo';
import type { Stamp } from '../../types';
import { project, TILT } from '../core';
import { canvasSize } from './buildings';
import type { Layer, MapState } from './types';

type CongestionLevel = 1 | 2 | 3 | 4 | 5;
type Theme = 'dark' | 'light';

// Canvas 用の解決済み値。出典: web/src/app/tokens.ts の appColors(--app-*)。
const dark = appColors('dark');
const light = appColors('light');
const level = (n: CongestionLevel) => ({
  color: dark[`--app-congestion-${n}`], textColor: dark[`--app-congestion-${n}-on`],
});
export const STAMP_TOKENS = {
  congestion: { 1: level(1), 2: level(2), 3: level(3), 4: level(4), 5: level(5) },
  congestionBorder: { dark: dark['--app-congestion-border'], light: light['--app-congestion-border'] },
  feeling: { dark: dark['--app-feeling'], light: light['--app-feeling'] },
  feelingOn: dark['--app-feeling-on'],
  textPrimary: { dark: dark['--app-text-primary'], light: light['--app-text-primary'] },
  mapRing: { dark: dark['--app-map-ring'], light: light['--app-map-ring'] },
} as const;

// Figma StampMark(Components 17:2 / 28:823)の寸法。すべて CSS px。
const CONGESTION_DOT = 14; // 直径(縁を含む)
const FEELING_DOT = 20;
const FEELING_DOT_ICON = 13;
const PILL_CONGESTION_H = 22;
const PILL_FEELING_H = 24;
const PILL_ICON = 14;
const PILL_GAP = 4;
const PILL_FONT = '"Noto Sans JP", sans-serif';
/** この画面上の距離(CSS px)以内の同種のスタンプを 1 つにまとめる。 */
export const CLUSTER_PX = 24;
/** 札(種類と経過時間)を出す拡大率。labels.ts の拡大ラベルと同じ。 */
export const ZOOMED_K = 1.25;

type FeelingKind = 'fun' | 'food' | 'good';
const FEELINGS: Record<FeelingKind, { label: string; sw: number; d: string }> = {
  // 出典: web/src/components/ui/Icon.vue の fun / food / good(24 の格子)。
  fun: { label: '面白い', sw: 2.6, d: 'M8 14c1 2 2.4 3 4 3s3-1 4-3M9 9v.5M15 9v.5' },
  food: {
    label: '美味しい', sw: 2,
    d: 'M7 3v5a2 2 0 0 0 4 0V3M9 3v18M17 3c-1.7 0-3 2-3 4.5S15.3 12 17 12s3-2 3-4.5S18.7 3 17 3zM17 12v9',
  },
  good: {
    label: 'よさ', sw: 1.9,
    d: 'M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.5 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7',
  },
};
const iconPaths = new Map<FeelingKind, Path2D>();
function iconPath(kind: FeelingKind): Path2D | undefined {
  if (typeof Path2D === 'undefined') return undefined;
  let path = iconPaths.get(kind);
  if (!path) { path = new Path2D(FEELINGS[kind].d); iconPaths.set(kind, path); }
  return path;
}
const isFeeling = (kind: string): kind is FeelingKind => kind in FEELINGS;

export const RIPPLE_MS = 2000;

/** 混雑は両テーマ共通の段階色と数字の色を使う。 */
export function congestionStyle(level: CongestionLevel) {
  return STAMP_TOKENS.congestion[level];
}

/** 他の層と同じく、canvas の最寄りの data-theme から読む。未指定・偽 canvas はダーク。 */
function theme(ctx: CanvasRenderingContext2D): Theme {
  return ctx.canvas.closest?.('[data-theme]')?.getAttribute('data-theme') === 'light'
    ? 'light' : 'dark';
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

export interface Mark {
  family: 'congestion' | 'feeling';
  kind: string; // 'congestion-N' か感想の種類
  level?: CongestionLevel;
  X: number;
  Y: number;
  pressedAt: number;
}
export interface Cluster { rep: Mark; more: number }

/** 同種で画面上 CLUSTER_PX 以内のものをまとめる。代表は混雑なら一番新しい方、感想なら一番多い種類(同数は新しい方)。 */
export function clusterMarks(marks: Mark[]): Cluster[] {
  const sorted = [...marks].sort((a, b) => b.pressedAt - a.pressedAt);
  const used = new Set<Mark>();
  const out: Cluster[] = [];
  for (const seed of sorted) {
    if (used.has(seed)) continue;
    used.add(seed);
    const group = [seed];
    for (const other of sorted) {
      if (used.has(other) || other.family !== seed.family) continue;
      if (Math.hypot(other.X - seed.X, other.Y - seed.Y) > CLUSTER_PX) continue;
      used.add(other);
      group.push(other);
    }
    let rep = seed; // group は新しい順。
    if (seed.family === 'feeling') {
      const counts = new Map<string, number>();
      for (const m of group) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
      rep = group.reduce((best, m) => (counts.get(m.kind)! > counts.get(best.kind)! ? m : best));
    }
    out.push({ rep, more: group.length - 1 });
  }
  return out;
}

function ageText(pressedAt: number, now: number): string {
  return `${Math.max(0, Math.floor((now - pressedAt) / 60000))}分`;
}

function pillPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = h / 2;
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
  ctx.arc(x + w - r, y + r, r, Math.PI * 1.5, Math.PI / 2);
  ctx.closePath();
}

function drawIcon(ctx: CanvasRenderingContext2D, kind: FeelingKind, cx: number, cy: number, size: number, color: string) {
  const path = iconPath(kind);
  if (!path) return;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = FEELINGS[kind].sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, text: string, weight: number, x: number, y: number, color: string): number {
  ctx.font = `${weight} 11px ${PILL_FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  return ctx.measureText(text).width;
}

function width(ctx: CanvasRenderingContext2D, text: string, weight: number): number {
  ctx.font = `${weight} 11px ${PILL_FONT}`;
  return ctx.measureText(text).width;
}

function drawCluster(ctx: CanvasRenderingContext2D, c: Cluster, zoomed: boolean, now: number, th: Theme) {
  const { rep, more } = c;
  const { X, Y } = rep;
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  if (rep.family === 'congestion') {
    const style = congestionStyle(rep.level!);
    ctx.fillStyle = style.color;
    ctx.strokeStyle = STAMP_TOKENS.congestionBorder[th];
    if (!zoomed) {
      ctx.beginPath();
      ctx.arc(X, Y, CONGESTION_DOT / 2 - 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (more > 0) drawMore(ctx, `+${more}`, X + CONGESTION_DOT / 2 + 2, Y, th);
      return;
    }
    const parts: [string, number][] = [[`混雑${rep.level}`, 700], [ageText(rep.pressedAt, now), 500]];
    if (more > 0) parts.push([`+${more}`, 700]);
    const w = 16 + parts.reduce((s, [t, wt]) => s + width(ctx, t, wt), 0) + PILL_GAP * (parts.length - 1);
    pillPath(ctx, X - w / 2, Y - PILL_CONGESTION_H / 2, w, PILL_CONGESTION_H);
    ctx.fill();
    ctx.stroke();
    let x = X - w / 2 + 8;
    for (const [text, weight] of parts) x += drawText(ctx, text, weight, x, Y, style.textColor) + PILL_GAP;
    return;
  }

  const kind = rep.kind as FeelingKind;
  ctx.fillStyle = STAMP_TOKENS.feeling[th];
  ctx.strokeStyle = STAMP_TOKENS.feelingOn;
  if (!zoomed) {
    ctx.beginPath();
    ctx.arc(X, Y, FEELING_DOT / 2 - 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawIcon(ctx, kind, X, Y, FEELING_DOT_ICON, STAMP_TOKENS.feelingOn);
    if (more > 0) drawMore(ctx, `+${more}`, X + FEELING_DOT / 2 + 2, Y, th);
    return;
  }
  const parts: [string, number][] = [[FEELINGS[kind].label, 700], [ageText(rep.pressedAt, now), 500]];
  if (more > 0) parts.push([`+${more}`, 700]);
  const w = 4 + PILL_ICON + PILL_GAP + parts.reduce((s, [t, wt]) => s + width(ctx, t, wt), 0)
    + PILL_GAP * (parts.length - 1) + 8;
  pillPath(ctx, X - w / 2, Y - PILL_FEELING_H / 2, w, PILL_FEELING_H);
  ctx.fill();
  ctx.stroke();
  drawIcon(ctx, kind, X - w / 2 + 4 + PILL_ICON / 2, Y, PILL_ICON, STAMP_TOKENS.feelingOn);
  let x = X - w / 2 + 4 + PILL_ICON + PILL_GAP;
  for (const [text, weight] of parts) x += drawText(ctx, text, weight, x, Y, STAMP_TOKENS.feelingOn) + PILL_GAP;
}

/** 小さい印のまとめ件数「+N」。地図の上で読めるよう、縁取りを付ける。 */
function drawMore(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, th: Theme) {
  ctx.font = `700 11px ${PILL_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = STAMP_TOKENS.mapRing[th];
  ctx.strokeText(text, x, y);
  ctx.fillStyle = STAMP_TOKENS.textPrimary[th];
  ctx.fillText(text, x, y);
}

const stamps: Layer = {
  name: 'stamps',
  draw(ctx, view, state, _t) {
    const congestion = cachedCongestion(state);
    const activeStamps = state.stamps.filter((stamp) => !isExpired(stamp, state.now));
    // 空の状態では canvas API に触れない。
    if (congestion.size === 0 && activeStamps.length === 0) return;

    const th = theme(ctx);
    const { width: W, height: H } = canvasSize(ctx);
    ctx.save();
    try {
      const marks: Mark[] = [];
      // 混雑は場所ごとに 1 つ。時刻はその場所に割り当てた一番新しい混雑スタンプ。
      for (const place of state.places) {
        const lv = congestion.get(place.id);
        if (lv === undefined) continue;
        let newest = state.now;
        let found = false;
        for (const stamp of activeStamps) {
          if (!stamp.kind.startsWith('congestion-')) continue;
          const nearest = nearestPlace(stamp, state.places);
          if (nearest?.id !== place.id) continue;
          const at = Date.parse(stamp.pressedAt);
          if (!found || at > newest) { newest = at; found = true; }
        }
        const [x, y] = toXY(place.location.lat, place.location.lng);
        const [X, Y] = project(view, W, H, x, y, 0);
        marks.push({ family: 'congestion', kind: `congestion-${lv}`, level: lv, X, Y, pressedAt: newest });
      }
      for (const stamp of activeStamps) {
        if (!isFeeling(stamp.kind)) continue;
        const [x, y] = toXY(stamp.at.lat, stamp.at.lng);
        const [X, Y] = project(view, W, H, x, y, 0);
        marks.push({ family: 'feeling', kind: stamp.kind, X, Y, pressedAt: Date.parse(stamp.pressedAt) });
      }

      const zoomed = view.k >= ZOOMED_K;
      // 古い順に描き、新しいものを上に重ねる。
      for (const cluster of clusterMarks(marks).reverse()) drawCluster(ctx, cluster, zoomed, state.now, th);

      for (const stamp of activeStamps) {
        const progress = rippleProgress(stamp, state.now);
        if (progress === null) continue;
        const [x, y] = toXY(stamp.at.lat, stamp.at.lng);
        const [X, Y] = project(view, W, H, x, y, 0);
        const radius = (6 + progress * 22) * view.k;
        ctx.globalAlpha = 1 - progress;
        ctx.strokeStyle = STAMP_TOKENS.mapRing[th];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(X, Y, radius, radius * TILT, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } finally {
      ctx.restore();
    }
  },
};

function nearestPlace(stamp: Stamp, places: MapState['places']) {
  let nearest: MapState['places'][number] | undefined;
  let best = Infinity;
  for (const place of places) {
    const d = distanceM(stamp.at, place.location);
    if (d < best) { nearest = place; best = d; }
  }
  return best <= CONGESTION_RADIUS_M ? nearest : undefined;
}

export default stamps;
