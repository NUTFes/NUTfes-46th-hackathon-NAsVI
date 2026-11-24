import { appColors } from '../../app/tokens';
import { applyFilter } from '../../domain/filter';
import { toXY } from '../../domain/geo';
import type { Place } from '../../types';
import { project } from '../core';
import type { Layer } from './types';

// 色の表は I-0 の app/tokens.ts(appColors)から引く。トークン名をキーとして固定する。
// alpha 付きのトークン(border-subtle)は、描画時に globalAlpha で別指定するため hex の 6 桁だけ使う。
const darkColors = appColors('dark');
const lightColors = appColors('light');
const pick = (name: string) => ({
  dark: darkColors[`--app-${name}`].slice(0, 7),
  light: lightColors[`--app-${name}`].slice(0, 7),
});
export const mapColors = {
  destination: pick('destination'),
  'destination-border': pick('destination-border'),
  'destination-on': pick('destination-on'),
  event: pick('event'),
  'event-on': pick('event-on'),
  parking: pick('parking'),
  'parking-on': pick('parking-on'),
  facility: pick('facility'),
  'facility-on': pick('facility-on'),
  'map-ring': pick('map-ring'),
  // 建物本体の専用トークンはない。企画ありは event、行き先は destination を使う。
  // 通常の建物は地面に近い中立の面として bg-surface、その輪郭は border-subtle を選ぶ。
  'bg-surface': pick('bg-surface'),
  'border-subtle': pick('border-subtle'),
  'text-primary': pick('text-primary'),
  'text-disabled': pick('text-disabled'),
};

export function resolveColors(ctx: CanvasRenderingContext2D) {
  // DOM の最寄りテーマを使い、未指定・不明・closest のない偽 canvas はダークにする。
  const theme = ctx.canvas.closest?.('[data-theme]')?.getAttribute('data-theme') === 'light'
    ? 'light' : 'dark';
  return Object.fromEntries(
    Object.entries(mapColors).map(([name, value]) => [name, value[theme]]),
  ) as Record<keyof typeof mapColors, string>;
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

/** 押下領域は 44 CSS px 角(中心から ±22)。 */
export const HIT_HALF = 22;

// 出典: components/ui/Icon.vue(= Figma Icon 22:189)の 24 格子のパス。印に使う 5 種だけ複製する。
const MARK_ICONS = {
  flag: { sw: 3, d: ['M6 21V4M6 4h11l-2.5 4L17 12H6'] },
  info: { sw: 2.2, d: ['M12 2.8a9.2 9.2 0 1 0 0 18.4a9.2 9.2 0 1 0 0-18.4zM12 10.8v6M12 7.3v.3'] },
  wc: {
    sw: 0.4,
    filled: true,
    d: ['M7 2.2a2 2 0 1 1 0 4a2 2 0 1 1 0-4zM5.6 7.2h2.8a1.2 1.2 0 0 1 1.2 1.2V14H4.4V8.4a1.2 1.2 0 0 1 1.2-1.2zM4.9 14h1.8v7H4.9zM7.3 14h1.8v7H7.3zM17 2.2a2 2 0 1 1 0 4a2 2 0 1 1 0-4zM15.8 7.2h2.4l2.9 8.2h-8.2zM15.2 15.4h1.6V21h-1.6zM17.2 15.4h1.6V21h-1.6zM11.55 3h0.9v18h-0.9z'],
  },
  rest: { sw: 2.2, d: ['M5 7h14M4 12h16M7 7v5M17 7v5M6 12v6M18 12v6'] },
  trash: { sw: 2.2, d: ['M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12'] },
} satisfies Record<string, { sw: number; filled?: boolean; d: string[] }>;
export type MarkIcon = keyof typeof MARK_ICONS;

/** 24 格子のアイコンを (cx, cy) を中心に size px で描く。Path2D のない環境では何もしない。 */
export function drawIcon(
  ctx: CanvasRenderingContext2D, name: MarkIcon, cx: number, cy: number, size: number, color: string,
): void {
  if (typeof Path2D !== 'function') return;
  const icon: { sw: number; filled?: boolean; d: string[] } = MARK_ICONS[name];
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.globalAlpha = 1;
  ctx.lineWidth = icon.sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const d of icon.d) {
    const path = new Path2D(d);
    if (icon.filled) ctx.fill(path);
    ctx.stroke(path);
  }
  ctx.restore();
}

type MarkColors = ReturnType<typeof resolveColors>;

/** 地図の上で浮かせる map-ring の輪つきの丸(画面に平行。TILT はかけない)。 */
function disc(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string, ringWidth = 2,
): void {
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r, 0, 0, Math.PI * 2);
  if (ringWidth > 0) {
    ctx.strokeStyle = ring;
    ctx.lineWidth = ringWidth * 2;
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  ctx.fill();
}

/** EventMark: 旗の入った event の丸。拡大時は 20 px、通常は 16 px。 */
export function drawEventMark(
  ctx: CanvasRenderingContext2D, colors: MarkColors, x: number, y: number, zoomed: boolean, isDest = false,
): void {
  const d = zoomed ? 20 : 16;
  disc(ctx, x, y, d / 2, isDest ? colors.destination : colors.event, colors['map-ring']);
  drawIcon(ctx, 'flag', x, y, d * 0.6, isDest ? colors['destination-on'] : colors['event-on']);
}

/** FacilityMark: facility の丸に種類のアイコン。拡大時は 26 px、通常は 20 px。 */
export function drawFacilityMark(
  ctx: CanvasRenderingContext2D, colors: MarkColors, x: number, y: number, kind: MarkIcon, zoomed: boolean,
): void {
  const d = zoomed ? 26 : 20;
  disc(ctx, x, y, d / 2, colors.facility, colors['map-ring']);
  drawIcon(ctx, kind, x, y, d * 0.65, colors['facility-on']);
}

/** ParkingMark: parking の角丸四角(22 px)に P。 */
export function drawParkingMark(ctx: CanvasRenderingContext2D, colors: MarkColors, x: number, y: number): void {
  const s = 22;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x - s / 2, y - s / 2, s, s, 6);
  else ctx.rect(x - s / 2, y - s / 2, s, s);
  ctx.strokeStyle = colors['map-ring'];
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = colors.parking;
  ctx.fill();
  ctx.fillStyle = colors['parking-on'];
  ctx.font = `700 14px ${MARK_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', x, y + 0.5);
}

/** DestinationMark: 旗の入った黄の丸(24 px)。ライトは destination-border の濃い縁で見分ける。 */
export function drawDestinationMark(
  ctx: CanvasRenderingContext2D,
  colors: Pick<MarkColors, 'destination' | 'destination-border' | 'destination-on' | 'map-ring'>,
  x: number, y: number,
): void {
  const r = 12;
  disc(ctx, x, y, r + 1.5, colors['destination-border'], colors['map-ring']);
  disc(ctx, x, y, r, colors.destination, colors['destination-border'], 0);
  drawIcon(ctx, 'flag', x, y, 13, colors['destination-on']);
}

export const FLAG_PILL = { h: 26, padX: 9, icon: 12, gap: 3 } as const;
export const MARK_FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';

/** BuildingFlag の幅。旗 12 + 間 3 + 数字の幅 + 左右 9。 */
export function flagPillWidth(countWidth: number): number {
  return FLAG_PILL.padX * 2 + FLAG_PILL.icon + FLAG_PILL.gap + countWidth;
}

/** BuildingFlag: event の丸薬に「旗+数」。行き先は黄。(x, y) は丸薬の中心。 */
export function drawBuildingFlag(
  ctx: CanvasRenderingContext2D, colors: MarkColors, x: number, y: number, w: number, count: number,
  isDest = false,
): void {
  const { h } = FLAG_PILL;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  else ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.strokeStyle = colors['map-ring'];
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = isDest ? colors.destination : colors.event;
  ctx.fill();
  const on = isDest ? colors['destination-on'] : colors['event-on'];
  drawIcon(ctx, 'flag', x - w / 2 + FLAG_PILL.padX + FLAG_PILL.icon / 2, y, FLAG_PILL.icon, on);
  ctx.fillStyle = on;
  ctx.font = `700 13px ${MARK_FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(count), x - w / 2 + FLAG_PILL.padX + FLAG_PILL.icon + FLAG_PILL.gap, y + 0.5);
}

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
          // D-023: 輪郭なしには高さも印も付けない。企画の印は labels の BuildingFlag(旗+数)が
          // 建物の位置に 1 つ出し、押下領域もそちらが持つ(ここで EventMark を重ねると二重になる)。
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
        || hit.markers.some((p) => Math.abs(x - p.x) <= p.r && Math.abs(y - p.y) <= p.r)) {
        return { kind: 'building', id: hit.id };
      }
    }
    return null;
  },
};

export default buildings;
