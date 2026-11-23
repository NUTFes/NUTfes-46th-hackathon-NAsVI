import { toXY } from '../../domain/geo';
import type { Place, Position } from '../../types';
import { project, TILT } from '../core';
import type { Layer } from './types';

// 出典: design-system/tokens.json の color.{dark,light} と color.palette。
// 値は design-system/claude-design/tokens.css の解決済み hex。alpha は描画時に別指定する。
// me.ts → route.ts の一方向で共有し、トークン名をキーとして固定する。
export const mapColors = {
  destination: { dark: '#ffd84a', light: '#facc15' }, // yellow.300 / yellow.400
  'destination-border': { dark: '#ffd84a', light: '#1e0b3a' }, // yellow.300 / violet.950
  'destination-on': { dark: '#1e0b3a', light: '#1e0b3a' }, // violet.950
  event: { dark: '#5eead4', light: '#0f766e' }, // teal.300 / teal.700
  'map-ring': { dark: '#130a22', light: '#f6f4fa' }, // ink.900 / violet.50
  // color.palette.white.0: PositionMark.md の「白い矢印」に一致する。
  // facility はライトで violet.950 になるため、両テーマで白を保つ white を選ぶ。
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

      // V1-g: 現在地が使えなくても行き先は示す。黄の線 3px、半径 14px (脈動なし) は固定。
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.beginPath();
      ctx.ellipse(ax, ay, 14, 14 * TILT, 0, 0, Math.PI * 2);
      // map-ring の下地 2px と destination-border の縁 1.5px を外側に残す。
      // ライトでは violet.950 の縁が必須。塗りはせず destination の黄の線を重ねる。
      ctx.strokeStyle = colors['map-ring'];
      ctx.lineWidth = 10;
      ctx.stroke();
      ctx.strokeStyle = colors['destination-border'];
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = colors.destination;
      ctx.lineWidth = 3;
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  },
};

export default route;
