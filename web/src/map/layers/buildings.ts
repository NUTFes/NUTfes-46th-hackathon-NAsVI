import { applyFilter } from '../../domain/filter';
import { toXY } from '../../domain/geo';
import type { Place } from '../../types';
import { project, TILT } from '../core';
import type { Layer } from './types';

// 出典: design-system/tokens.json の color.{dark,light} と color.palette。
// 値は design-system/claude-design/tokens.css の解決済み hex。alpha は描画時に別指定する。
// labels.ts → buildings.ts の一方向で共有し、出典のトークン名をキーとして固定する。
export const mapColors = {
  destination: { dark: '#ffd84a', light: '#facc15' }, // yellow.300 / yellow.400
  'destination-border': { dark: '#ffd84a', light: '#1e0b3a' }, // yellow.300 / violet.950
  'destination-on': { dark: '#1e0b3a', light: '#1e0b3a' }, // violet.950
  event: { dark: '#5eead4', light: '#0f766e' }, // teal.300 / teal.700
  'event-on': { dark: '#062a24', light: '#ffffff' }, // teal.950 / white.0
  parking: { dark: '#60a5fa', light: '#2563eb' }, // blue.400 / blue.600
  'parking-on': { dark: '#0b1a33', light: '#ffffff' }, // blue.950 / white.0
  facility: { dark: '#f4f0ff', light: '#1e0b3a' }, // mist.50 / violet.950
  'facility-on': { dark: '#1e0b3a', light: '#ffffff' }, // violet.950 / white.0
  'map-ring': { dark: '#130a22', light: '#f6f4fa' }, // ink.900 / violet.50
  // 建物本体の専用トークンはない。企画ありは event、行き先は destination を使う。
  // 通常の建物は地面に近い中立の面として bg-surface、その輪郭は border-subtle を選ぶ。
  'bg-surface': { dark: '#1c1032', light: '#ffffff' }, // ink.800 / white.0
  'border-subtle': { dark: '#a78bfa', light: '#1e0b3a' }, // violet.400 / violet.950 (alpha は別指定)
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
    'event-on': mapColors['event-on'][theme],
    parking: mapColors.parking[theme],
    'parking-on': mapColors['parking-on'][theme],
    facility: mapColors.facility[theme],
    'facility-on': mapColors['facility-on'][theme],
    'map-ring': mapColors['map-ring'][theme],
    'bg-surface': mapColors['bg-surface'][theme],
    'border-subtle': mapColors['border-subtle'][theme],
  };
}

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

/** D-030: 設備は印にだけ使い、建物の強調や企画数に含めない。
 * domain/filter.ts と同じ判定。担当外のため複製。
 */
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

// 初回 draw 前は空。以後は draw ごとに破棄し、直近の描画だけを判定する。
let buildingHits: {
  id: string;
  polygons: Point2D[][];
  markers: { x: number; y: number; r: number }[];
}[] = [];

const buildings: Layer = {
  name: 'buildings',
  draw(ctx, view, state) {
    buildingHits = [];
    const { width, height } = canvasSize(ctx);
    const colors = resolveColors(ctx);
    // MapState には tagLinks がないため、labelIds のみ適用し tagIds は空として扱う。
    const shown = applyFilter(state.places, { labelIds: state.filter.labelIds, tagIds: [] });
    const destination = state.places.find((p) => p.id === state.destination?.placeId);
    const list = state.landmarks.flatMap((landmark) => {
      if (landmark.footprint !== null && landmark.footprint.length < 3) return [];
      const points = landmark.footprint?.map((p) => toXY(p.lat, p.lng)) ?? null;
      const [x, y] = toXY(landmark.location.lat, landmark.location.lng);
      return [{ landmark, points, depth: project(view, width, height, x, y)[2] }];
    });

    ctx.save();
    try {
      ctx.lineWidth = Math.min(1.3, Math.max(0.6, view.k * 0.45));
      for (const { landmark, points } of sortByDepth(list)) {
        const { isDest, isP } = buildingHighlight(landmark.id, shown, destination);
        if (points === null) {
          // D-023: 輪郭なしには高さを付けず、企画の location に小さな地面の円を描く。
          // 設備・駐車場の印は labels が担当。絞り込み外でも行き先の企画は残す。
          const places = destination && !shown.some((p) => p.id === destination.id)
            ? [...shown, destination] : shown;
          const markers = [];
          for (const p of places) {
            if (p.landmarkId !== landmark.id || isFacility(p) || p.kind === 'parking') continue;
            const [wx, wy] = toXY(p.location.lat, p.location.lng);
            const [x, y] = project(view, width, height, wx, wy);
            const r = Math.max(4, view.k * 4);
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.ellipse(x, y, r, r * TILT, 0, 0, Math.PI * 2);
            ctx.fillStyle = isDest ? colors.destination : colors.event;
            ctx.fill();
            ctx.strokeStyle = isDest ? colors['destination-border'] : colors['map-ring'];
            ctx.stroke();
            markers.push({ x, y, r });
          }
          buildingHits.push({ id: landmark.id, polygons: [], markers });
          continue;
        }
        const hgt = buildingHeight(points);
        const base = points.map(([x, y]) => project(view, width, height, x, y));
        const top: Point2D[] = points.map(([x, y]) => {
          const [px, py] = project(view, width, height, x, y, hgt);
          return [px, py];
        });
        const walls: Point2D[][] = [];
        const fillColor = isDest ? colors.destination : isP ? colors.event : colors['bg-surface'];
        ctx.strokeStyle = isDest ? colors['destination-border'] : isP ? colors.event : colors['border-subtle'];
        ctx.fillStyle = fillColor;
        for (let i = 0; i < base.length; i++) {
          const j = (i + 1) % base.length;
          walls.push([[base[i][0], base[i][1]], [base[j][0], base[j][1]], top[j], top[i]]);
          ctx.beginPath();
          ctx.moveTo(base[i][0], base[i][1]);
          ctx.lineTo(base[j][0], base[j][1]);
          ctx.lineTo(top[j][0], top[j][1]);
          ctx.lineTo(top[i][0], top[i][1]);
          ctx.closePath();
          ctx.globalAlpha = isDest ? 0.45 : isP ? 0.4 : 0.36;
          ctx.fill();
          ctx.globalAlpha = isDest ? 1 : isP ? 0.85 : 0.55;
          ctx.stroke();
        }
        ctx.beginPath();
        top.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.globalAlpha = isDest || isP ? 1 : 0.9;
        ctx.fill();
        ctx.globalAlpha = isDest ? 1 : isP ? 0.85 : 0.55;
        ctx.stroke();
        buildingHits.push({ id: landmark.id, polygons: [top, ...walls], markers: [] });
      }
    } finally {
      ctx.restore();
    }
  },
  hitTest(x, y) {
    // 描画順の逆(手前から)。屋根に加え、ベースと屋根を結ぶ壁の四角形も判定する。
    for (let i = buildingHits.length - 1; i >= 0; i--) {
      const hit = buildingHits[i];
      if (hit.polygons.some((polygon) => pointInPolygon(x, y, polygon))
        || hit.markers.some((p) => Math.hypot(x - p.x, (y - p.y) / TILT) <= p.r)) {
        return { kind: 'building', id: hit.id };
      }
    }
    return null;
  },
};

export default buildings;
