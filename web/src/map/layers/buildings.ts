import { applyFilter } from '../../domain/filter';
import { toXY } from '../../domain/geo';
import type { Place } from '../../types';
import { project } from '../core';
import type { Layer } from './types';

type Point2D = readonly [number, number];

/** 平面座標(m)の輪郭から高さ(m)を求める。頂点の向きには依存しない。 */
export function buildingHeight(points: ReadonlyArray<Point2D>): number {
  let A = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    A += x1 * y2 - x2 * y1;
  }
  // モックと同じ式・固定値(7, 0.32, 7, 30)。A は符号付き面積の 2 倍。
  return Math.min(30, Math.max(7, 7 + Math.sqrt(Math.abs(A / 2)) * 0.32));
}

/** project の奥行きが大きいものから描く。入力の並びは変えない。 */
export function sortByDepth<T extends { depth: number }>(items: ReadonlyArray<T>): T[] {
  return [...items].sort((a, b) => b.depth - a.depth);
}

/** 屋根の内側と辺・頂点を含む。凹多角形にも使える偶奇判定。 */
export function pointInPolygon(x: number, y: number, points: ReadonlyArray<Point2D>): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-9
      && x >= Math.min(xi, xj) && x <= Math.max(xi, xj)
      && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** D-030: 設備は印にだけ使い、建物の強調や企画数に含めない。 */
export function isFacility(place: Pick<Place, 'kind'>): boolean {
  return place.kind === 'info' || place.kind === 'wc'
    || place.kind === 'rest' || place.kind === 'trash';
}

export function buildingHighlight(
  landmarkId: string,
  shown: ReadonlyArray<Place>,
  destination: Place | undefined,
): { isDest: boolean; isP: boolean } {
  return {
    isDest: destination !== undefined && !isFacility(destination)
      && destination.landmarkId === landmarkId,
    isP: shown.some((p) => !isFacility(p) && p.landmarkId === landmarkId),
  };
}

/** 投影とタップ判定を CSS ピクセルにそろえる。 */
export function canvasSize(ctx: CanvasRenderingContext2D): { width: number; height: number } {
  // MapCanvas.vue はまだ雛形。モックの setTransform(dpr,0,0,dpr,0,0) を前提に、
  // 現在の変換から DPR を読み、内部の描画サイズを割る。window の DPR には依存しない。
  const transform = ctx.getTransform();
  const dpr = Math.hypot(transform.a, transform.b) || 1;
  return { width: ctx.canvas.width / dpr, height: ctx.canvas.height / dpr };
}

let roofHits: { id: string; top: Point2D[] }[] = [];

const buildings: Layer = {
  name: 'buildings',
  draw(ctx, view, state) {
    roofHits = [];
    const { width, height } = canvasSize(ctx);
    // MapState には tagLinks がないため、labelIds のみ適用し tagIds は空として扱う。
    const shown = applyFilter(state.places, { labelIds: state.filter.labelIds, tagIds: [] });
    const destination = state.places.find((p) => p.id === state.destination?.placeId);
    const list = state.landmarks.flatMap((landmark) => {
      if (landmark.footprint === null || landmark.footprint.length < 3) return [];
      const points = landmark.footprint.map((p) => toXY(p.lat, p.lng));
      const [x, y] = toXY(landmark.location.lat, landmark.location.lng);
      return [{ landmark, points, depth: project(view, width, height, x, y)[2] }];
    });

    ctx.save();
    ctx.lineWidth = Math.min(1.3, Math.max(0.6, view.k * 0.45));
    for (const { landmark, points } of sortByDepth(list)) {
      const hgt = buildingHeight(points);
      const base = points.map(([x, y]) => project(view, width, height, x, y));
      const top: Point2D[] = points.map(([x, y]) => {
        const [px, py] = project(view, width, height, x, y, hgt);
        return [px, py];
      });
      roofHits.push({ id: landmark.id, top });
      const { isDest, isP } = buildingHighlight(landmark.id, shown, destination);
      ctx.strokeStyle = isDest ? '#fff' : isP ? 'rgba(94,234,212,.85)' : 'rgba(167,139,250,.55)';
      ctx.fillStyle = isDest ? 'rgba(200,150,0,.45)' : isP ? 'rgba(16,120,90,.4)' : 'rgba(70,30,140,.36)';
      for (let i = 0; i < base.length; i++) {
        const j = (i + 1) % base.length;
        ctx.beginPath();
        ctx.moveTo(base[i][0], base[i][1]);
        ctx.lineTo(base[j][0], base[j][1]);
        ctx.lineTo(top[j][0], top[j][1]);
        ctx.lineTo(top[i][0], top[i][1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      top.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.fillStyle = isDest ? '#ffd84a' : isP ? '#10b981' : 'rgba(60,30,120,.9)';
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  },
  hitTest(x, y) {
    // 描画順の逆(手前から)で、直近に描いた屋根だけを調べる。
    for (let i = roofHits.length - 1; i >= 0; i--) {
      if (pointInPolygon(x, y, roofHits[i].top)) {
        return { kind: 'building', id: roofHits[i].id };
      }
    }
    return null;
  },
};

export default buildings;
