import { toXY } from '../../domain/geo';
import type { Place, Position } from '../../types';
import { project, TILT } from '../core';
import type { View } from '../core';
import { resolveColors } from './route';
import type { Layer } from './types';

// 精度不良でも地図を覆わないよう、精度円の画面上の半径を 120 CSS px に制限する。
export const ACCURACY_MAX_PX = 120;

/** 現在地と行き先を地面 (z=0) に投影し、描画用の画面座標を返す。 */
export function meGeometry(
  position: Position | null,
  destPlace: Place | null,
  view: View,
  W: number,
  H: number,
) {
  if (!position) return null;

  const [x, y] = project(view, W, H, ...toXY(position.lat, position.lng), 0);
  // 出典: PR #4 の ar-guide/mock/index.html。行き先なしでは上向き (-π/2)。
  let angle = -Math.PI / 2;
  if (destPlace) {
    const [ax, ay] = project(view, W, H, ...toXY(destPlace.location.lat, destPlace.location.lng), 0);
    angle = Math.atan2(ay - y, ax - x);
  }

  const accuracyPx = Number.isFinite(position.accuracy) && position.accuracy > 0
    ? position.accuracy * view.k : 0;
  const accuracyRx = Math.min(accuracyPx, ACCURACY_MAX_PX);
  return {
    x, y,
    accuracyRx,
    accuracyRy: accuracyRx * TILT,
    accuracyCapped: accuracyPx > ACCURACY_MAX_PX,
    angle,
  };
}

const me: Layer = {
  name: 'me',
  draw(ctx, view, state, t) {
    if (!state.position) return;

    const destPlace = state.destination
      ? state.places.find((place) => place.id === state.destination?.placeId) ?? null
      : null;
    // CSS ピクセル。dpr 変換は呼び出し側(M-02)が setTransform で行う前提。
    const W = ctx.canvas.clientWidth || ctx.canvas.width;
    const H = ctx.canvas.clientHeight || ctx.canvas.height;
    const geometry = meGeometry(state.position, destPlace, view, W, H);
    if (!geometry) return;
    const { x, y, accuracyRx, accuracyRy, accuracyCapped, angle } = geometry;
    const colors = resolveColors(ctx);

    ctx.save();
    try {
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // PositionMark.md の円・輪は event。無効な精度円は省略し、矢印と輪は描き続ける。
      if (accuracyRx > 0) {
        // 上限超過時も実線のまま、塗りと縁の alpha を半分にして精度不良を示す。
        const fade = accuracyCapped ? 0.5 : 1;
        ctx.beginPath();
        ctx.ellipse(x, y, accuracyRx, accuracyRy, 0, 0, Math.PI * 2);
        ctx.fillStyle = colors.event;
        ctx.globalAlpha = 0.12 * fade;
        ctx.fill();
        ctx.globalAlpha = 0.35 * fade;
        ctx.strokeStyle = colors['map-ring'];
        ctx.lineWidth = 5; // 1px の縁の外側に map-ring の下地を 2px 残す。
        ctx.stroke();
        ctx.strokeStyle = colors.event;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 出典: PR #4 の ar-guide/mock/index.html。周期 1400ms、半径 8+q*34px、縁 1.5px を固定。
      const q = (t / 1400) % 1;
      const r = 8 + q * 34;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * TILT, 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.7 * (1 - q);
      ctx.strokeStyle = colors['map-ring'];
      ctx.lineWidth = 5.5; // 1.5px の輪の外側に下地を 2px 残す。
      ctx.stroke();
      ctx.strokeStyle = colors.event;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 出典: PR #4 の ar-guide/mock/index.html。矢印のオフセット・頂点・濃色の縁 2px を固定。
      ctx.globalAlpha = 1;
      ctx.translate(x, y - 4);
      ctx.rotate(angle + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(9, 8);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-9, 8);
      ctx.closePath();
      ctx.strokeStyle = colors['map-ring'];
      ctx.lineWidth = 6; // 濃色の縁 2px の外側に下地を 2px 残す。
      ctx.stroke();
      ctx.fillStyle = colors.white;
      ctx.fill();
      ctx.strokeStyle = colors['destination-on'];
      ctx.lineWidth = 2;
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  },
};

export default me;
