import { toXY } from '../../domain/geo';
import type { Place, Position } from '../../types';
import { project, TILT } from '../core';
import type { Layer } from './types';

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
    if (!state.position || !state.destination) return;
    const place = state.places.find((place) => place.id === state.destination?.placeId) ?? null;
    const geometry = routeGeometry(state.position, place);
    if (!geometry) return;

    const W = ctx.canvas.clientWidth || ctx.canvas.width;
    const H = ctx.canvas.clientHeight || ctx.canvas.height;
    const [x, y] = project(view, W, H, ...geometry.from, 0);
    const [ax, ay] = project(view, W, H, ...geometry.to, 0);
    const { width, dash } = dashStyle(view.k);

    ctx.save();
    try {
      // 出典: PR #4 の ar-guide/mock/index.html。mint、round、alpha=1、速度 -0.03px/ms を固定。
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#5eead4';
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.lineDashOffset = -t * 0.03;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ax, ay);
      ctx.stroke();

      // 行き先は地面に置く。指定の黄 #ffd84a、縁 3px、画面上の半径 14px (脈動なし) を固定。
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.beginPath();
      ctx.ellipse(ax, ay, 14, 14 * TILT, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd84a';
      ctx.lineWidth = 3;
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  },
};

export default route;
