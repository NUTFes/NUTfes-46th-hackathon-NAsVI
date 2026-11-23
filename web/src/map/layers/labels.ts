import { applyFilter, countByBuilding } from '../../domain/filter';
import { toXY } from '../../domain/geo';
import type { Place } from '../../types';
import { project, TILT } from '../core';
import { buildingHeight, canvasSize, isFacility, resolveColors } from './buildings';
import type { Layer } from './types';

export interface Rect { x: number; y: number; w: number; h: number }
export interface LabelHit { rect: Rect; placeId: string }
export interface LabelCandidate {
  placeId: string;
  text: string;
  textWidth: number;
  x: number;
  y: number;
  depth: number;
  isDestination: boolean;
}
export interface PlacedLabel extends LabelCandidate, LabelHit { stem: number }

/** モックと同じ余白(横 4、縦 3)。余白の端が接するだけなら重ならない。 */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w + 4 && a.x + a.w + 4 > b.x
    && a.y < b.y + b.h + 3 && a.y + a.h + 3 > b.y;
}

/** 目的地を先に置き、残りを奥から並べて重なる吹き出しを省く。 */
export function placeLabels(
  candidates: ReadonlyArray<LabelCandidate>, k: number, W: number, H: number,
): PlacedLabel[] {
  if (![k, W, H].every(Number.isFinite)) return [];
  const order = candidates.filter((p) =>
    [p.textWidth, p.x, p.y, p.depth].every(Number.isFinite) && p.textWidth >= 0).sort((a, b) =>
    Number(b.isDestination) - Number(a.isDestination) || b.depth - a.depth);
  const placed: PlacedLabel[] = [];
  for (const p of order) {
    if (!p.isDestination && k < 1.25) continue;
    const w = p.textWidth + (p.isDestination ? 20 : 14);
    const h = p.isDestination ? 26 : 22;
    const stem = p.isDestination ? 22 : 14;
    const rect = { x: p.x - w / 2, y: p.y - stem - h, w, h };
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) continue;
    if (!p.isDestination && (rect.x < 4 || rect.x + rect.w > W - 4 || rect.y < 70 || p.y > H)) continue;
    if (placed.some((other) => rectsOverlap(rect, other.rect))) continue;
    placed.push({ ...p, rect, stem });
  }
  return placed;
}

/** 描画した矩形の中(辺を含む)だけをタップ可能にする。
 * 44 CSS px へは広げない。配置時の重なり回避と labelHits の仕様を保ち、
 * 隣の吹き出しや地面の印へのタップを先頭ラベルが奪うのを避けるため。
 */
export function hitLabel(hits: ReadonlyArray<LabelHit>, x: number, y: number): { kind: 'place'; id: string } | null {
  const hit = hits.find(({ rect: r }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  return hit ? { kind: 'place', id: hit.placeId } : null;
}

const JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
// 初回 draw 前はどちらも空。draw ごとに破棄し、直近に描いたものだけを判定する。
let labelHits: LabelHit[] = [];
let markerHits: { placeId: string; x: number; y: number }[] = [];

const labels: Layer = {
  name: 'labels',
  draw(ctx, view, state, t) {
    labelHits = [];
    markerHits = [];
    // buildings と同じく、現在の変換倍率で canvas の内部サイズを CSS ピクセルへ戻す。
    const { width: W, height: H } = canvasSize(ctx);
    const colors = resolveColors(ctx);
    const category = (p: Place) => isFacility(p) ? 'facility' : p.kind === 'parking' ? 'parking' : 'event';
    const places = new Map(state.places.map((p) => [p.id, p]));
    // MapState に tagLinks がないため、labelIds のみ適用し tagIds は空として扱う。
    const filter = { labelIds: state.filter.labelIds, tagIds: [] };
    const shown = applyFilter(state.places, filter);
    const counts = countByBuilding(shown, { labelIds: [], tagIds: [] });
    const destination = state.places.find((p) => p.id === state.destination?.placeId);
    const landmarks = new Map(state.landmarks.map((landmark) => [landmark.id, landmark]));
    const heights = new Map(state.landmarks.map((landmark) => [landmark.id,
      landmark.footprint === null ? 0
        : buildingHeight(landmark.footprint.map((p) => toXY(p.lat, p.lng))),
    ]));
    const anchor = (p: Place): [number, number, number] => {
      // 設備と駐車場は建物所属でも地面の印。屋内企画はモック同様に建物の中心・屋根へ。
      const building = !isFacility(p) && p.kind !== 'parking' && p.landmarkId !== null
        ? landmarks.get(p.landmarkId) : undefined;
      // D-023: 輪郭なしの企画は、buildings の地面の印と同じ場所へ置く。
      const landmark = building?.footprint !== null ? building : undefined;
      const location = landmark?.location ?? p.location;
      const [x, y] = toXY(location.lat, location.lng);
      return project(view, W, H, x, y, landmark ? heights.get(landmark.id) ?? 0 : 0);
    };

    ctx.save();
    try {
      for (const p of shown) {
        if (p.landmarkId !== null && !isFacility(p) && p.kind !== 'parking') continue;
        const [wx, wy] = toXY(p.location.lat, p.location.lng);
        const [x, y] = project(view, W, H, wx, wy);
        markerHits.push({ placeId: p.id, x, y });
        const r = Math.max(4, view.k * 4);
        const on = p.id === destination?.id;
        const color = on ? colors.destination : colors[category(p)];
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.8, r * 1.8 * TILT, 0, 0, 7);
        ctx.fillStyle = color;
        ctx.globalAlpha = on ? 0.3 : 0.18;
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.6, r * 0.6 * TILT, 0, 0, 7);
        ctx.globalAlpha = 1;
        ctx.fill();
        ctx.strokeStyle = on ? colors['destination-border'] : colors['map-ring'];
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      if (destination) {
        const [x, y] = anchor(destination);
        const q = (t / 1600) % 1;
        const r = 10 + q * 46;
        ctx.strokeStyle = colors.destination;
        ctx.globalAlpha = 0.9 * (1 - q);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * TILT, 0, 0, 7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 同じ建物の企画は 1 枚にまとめる。目的地を代表にし、設備はまとめず数えない。
      const order = destination ? [destination, ...shown.filter((p) => p.id !== destination.id)] : shown;
      const seen = new Set<string>();
      const candidates: LabelCandidate[] = [];
      for (const p of order) {
        const isDestination = p.id === destination?.id;
        const landmarkId = !isFacility(p) ? p.landmarkId : null;
        if (landmarkId !== null) {
          if (seen.has(landmarkId)) continue;
          seen.add(landmarkId);
        }
        const more = landmarkId !== null && !isDestination
          ? Math.max(0, (counts.get(landmarkId) ?? 0) - 1) : 0;
        const text = p.name + (more > 0 ? ` +${more}` : '');
        ctx.font = `700 ${isDestination ? 13 : 11}px ${JP}`;
        const textWidth = ctx.measureText(text).width;
        const [x, y, depth] = anchor(p);
        candidates.push({ placeId: p.id, text, textWidth, x, y, depth, isDestination });
      }
      const placed = placeLabels(candidates, view.k, W, H);
      labelHits = placed;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (const { placeId, text, x, y, stem, rect: r, isDestination } of placed) {
        const token = isDestination ? 'destination' : category(places.get(placeId)!);
        ctx.font = `700 ${isDestination ? 13 : 11}px ${JP}`;
        ctx.strokeStyle = isDestination ? colors['destination-border'] : colors['map-ring'];
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - stem);
        ctx.stroke();
        ctx.beginPath();
        // Safari 16 未満など roundRect のない環境でも同じ矩形の path を作る。
        if (typeof ctx.roundRect === 'function') ctx.roundRect(r.x, r.y, r.w, r.h, 6);
        else ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = colors[token];
        ctx.globalAlpha = isDestination ? 1 : 0.94;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
        ctx.fillStyle = colors[`${token}-on`];
        ctx.fillText(text, x, r.y + r.h / 2 + 0.5);
      }
    } finally {
      ctx.restore();
    }
  },
  hitTest(x, y) {
    const label = hitLabel(labelHits, x, y);
    if (label) return label;
    const marker = markerHits.find((p) => Math.hypot(p.x - x, (p.y - y) / TILT) < 22);
    return marker ? { kind: 'place', id: marker.placeId } : null;
  },
};

export default labels;
