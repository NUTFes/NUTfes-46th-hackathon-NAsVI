import { toXY } from '../../domain/geo';
import type { Place, Position } from '../../types';
import { project, TILT } from '../core';
import type { View } from '../core';
import type { Layer } from './types';

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

  return {
    x, y,
    accuracyRx: position.accuracy * view.k,
    accuracyRy: position.accuracy * view.k * TILT,
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
    const W = ctx.canvas.clientWidth || ctx.canvas.width;
    const H = ctx.canvas.clientHeight || ctx.canvas.height;
    const geometry = meGeometry(state.position, destPlace, view, W, H);
    if (!geometry) return;
    const { x, y, accuracyRx, accuracyRy, angle } = geometry;

    ctx.save();
    try {
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // 精度は地面上のメートル単位の円。塗りの alpha=0.12、縁は 1px / alpha=0.35 とする。
      ctx.beginPath();
      ctx.ellipse(x, y, accuracyRx, accuracyRy, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(94,234,212,0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(94,234,212,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 出典: PR #4 の ar-guide/mock/index.html。周期 1400ms、半径 8+q*34px、縁 1.5px を固定。
      const q = (t / 1400) % 1;
      const r = 8 + q * 34;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * TILT, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - q)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 出典: PR #4 の ar-guide/mock/index.html。矢印のオフセット・頂点・色・縁 2px を固定。
      ctx.translate(x, y - 4);
      ctx.rotate(angle + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(9, 8);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-9, 8);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#1e0b3a';
      ctx.lineWidth = 2;
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  },
};

export default me;
