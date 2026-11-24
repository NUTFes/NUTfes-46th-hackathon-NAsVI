import { toXY } from '../../domain/geo';
import type { Place, Position } from '../../types';
import { project } from '../core';
import { drawDestinationMark, mapColors as baseColors } from './buildings';
import type { Layer } from './types';

// 色の表は buildings.ts(I-0 の appColors から引く)と共有する。
// me.ts → route.ts の一方向で共有し、トークン名をキーとして固定する。
// 白い矢印(PositionMark.md)は color.palette.white.0。facility はライトで violet.950 になるため別に持つ。
export const mapColors = {
  destination: baseColors.destination,
  'destination-border': baseColors['destination-border'],
  'destination-on': baseColors['destination-on'],
  event: baseColors.event,
  'map-ring': baseColors['map-ring'],
  'text-disabled': baseColors['text-disabled'],
  white: { dark: '#ffffff', light: '#ffffff' },
} as const;

export function resolveColors(ctx: CanvasRenderingContext2D) {
  // DOM の最寄りテーマを使い、未指定・不明・closest のない偽 canvas はダークにする。
  const theme = ctx.canvas.closest?.('[data-theme]')?.getAttribute('data-theme') === 'light'
    ? 'light' : 'dark';
  return {
    destination: mapColors.destination[theme],
    'destination-border': mapColors['destination-border'][theme],
    'destination-on': mapColors['destination-on'][theme],
    event: mapColors.event[theme],
    'map-ring': mapColors['map-ring'][theme],
    'text-disabled': mapColors['text-disabled'][theme],
    white: mapColors.white[theme],
  };
}

/** 端末内で求める現在地→行き先の直線の両端 (地面上のメートル座標、D-003)。 */
export function routeGeometry(position: Position | null, place: Place | null): {
  from: [number, number];
  to: [number, number];
} | null {
  if (!position || !place) return null;
  return {
    from: toXY(position.lat, position.lng),
    to: toXY(place.location.lat, place.location.lng),
  };
}

export function dashStyle(k: number): { width: number; dash: [number, number] } {
  // 出典: PR #4 の ar-guide/mock/index.html。最小幅 5px、倍率 2.4、点 0.1px、間隔 幅*2.2 を固定。
  const width = Math.max(5, k * 2.4);
  return { width, dash: [0.1, width * 2.2] };
}

const route: Layer = {
  name: 'route',
  draw(ctx, view, state, t) {
    if (!state.destination) return;
    const place = state.places.find((place) => place.id === state.destination?.placeId) ?? null;
    if (!place) return;
    const geometry = routeGeometry(state.position, place);

    // CSS ピクセル。dpr 変換は呼び出し側(M-02)が setTransform で行う前提。
    const W = ctx.canvas.clientWidth || ctx.canvas.width;
    const H = ctx.canvas.clientHeight || ctx.canvas.height;
    const [ax, ay] = project(view, W, H, ...toXY(place.location.lat, place.location.lng), 0);
    const { width, dash } = dashStyle(view.k);
    const colors = resolveColors(ctx);

    ctx.save();
    try {
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (geometry) {
        const [x, y] = project(view, W, H, ...geometry.from, 0);
        // DestinationMark.md / Cover の説明に合わせ、モックの mint から destination-border に変更。
        // 出典: PR #4 の ar-guide/mock/index.html。round、alpha=1、速度 -0.03px/ms を固定。
        ctx.strokeStyle = colors['destination-border'];
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.lineDashOffset = -t * 0.03;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ax, ay);
        ctx.stroke();
      }

      // V1-g: 現在地が使えなくても行き先は示す。DestinationMark は旗の入った黄の丸(24 px、脈動なし)。
      // ライトでは destination-border の濃い縁が必須。
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      drawDestinationMark(ctx, colors, ax, ay);
    } finally {
      ctx.restore();
    }
  },
};

export default route;
