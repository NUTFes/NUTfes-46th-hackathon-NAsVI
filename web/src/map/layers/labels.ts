import { applyFilter, countByBuilding } from '../../domain/filter';
import { toXY } from '../../domain/geo';
import type { Place } from '../../types';
import { project, TILT } from '../core';
import { buildingHeight, canvasSize, isFacility } from './buildings';
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
  const order = [...candidates].sort((a, b) =>
    Number(b.isDestination) - Number(a.isDestination) || b.depth - a.depth);
  const placed: PlacedLabel[] = [];
  for (const p of order) {
    if (!p.isDestination && k < 1.25) continue;
    const w = p.textWidth + (p.isDestination ? 20 : 14);
    const h = p.isDestination ? 26 : 22;
    const stem = p.isDestination ? 22 : 14;
    const rect = { x: p.x - w / 2, y: p.y - stem - h, w, h };
    if (!p.isDestination && (rect.x < 4 || rect.x + rect.w > W - 4 || rect.y < 70 || p.y > H)) continue;
    if (placed.some((other) => rectsOverlap(rect, other.rect))) continue;
    placed.push({ ...p, rect, stem });
  }
  return placed;
}

/** 描画した矩形の中(辺を含む)だけをタップ可能にする。 */
export function hitLabel(hits: ReadonlyArray<LabelHit>, x: number, y: number): { kind: 'place'; id: string } | null {
  const hit = hits.find(({ rect: r }) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  return hit ? { kind: 'place', id: hit.placeId } : null;
}

const JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';
let labelHits: LabelHit[] = [];
let markerHits: { placeId: string; x: number; y: number }[] = [];

const labels: Layer = {
  name: 'labels',
  draw(ctx, view, state, t) {
    labelHits = [];
    markerHits = [];
    // buildings と同じく、現在の変換倍率で canvas の内部サイズを CSS ピクセルへ戻す。
    const { width: W, height: H } = canvasSize(ctx);
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
      const landmark = !isFacility(p) && p.kind !== 'parking' && p.landmarkId !== null
        ? landmarks.get(p.landmarkId) : undefined;
      const location = landmark?.location ?? p.location;
      const [x, y] = toXY(location.lat, location.lng);
      return project(view, W, H, x, y, landmark ? heights.get(landmark.id) ?? 0 : 0);
    };

    ctx.save();
    for (const p of shown) {
      if (p.landmarkId !== null && !isFacility(p) && p.kind !== 'parking') continue;
      const [wx, wy] = toXY(p.location.lat, p.location.lng);
      const [x, y] = project(view, W, H, wx, wy);
      markerHits.push({ placeId: p.id, x, y });
      const r = Math.max(4, view.k * 4);
      const on = p.id === destination?.id;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r * 1.8 * TILT, 0, 0, 7);
      ctx.fillStyle = on ? 'rgba(255,216,74,.3)' : 'rgba(94,234,212,.18)';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.6, r * 0.6 * TILT, 0, 0, 7);
      ctx.fillStyle = on ? '#ffd84a' : '#5eead4';
      ctx.fill();
    }
    if (destination) {
      const [x, y] = anchor(destination);
      const q = (t / 1600) % 1;
      const r = 10 + q * 46;
      ctx.strokeStyle = `rgba(255,216,74,${0.9 * (1 - q)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * TILT, 0, 0, 7);
      ctx.stroke();
    }

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
    for (const { text, x, y, stem, rect: r, isDestination } of placed) {
      ctx.font = `700 ${isDestination ? 13 : 11}px ${JP}`;
      ctx.strokeStyle = isDestination ? '#ffd84a' : 'rgba(255,255,255,.75)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - stem);
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 6);
      ctx.fillStyle = isDestination ? '#ffd84a' : 'rgba(244,240,255,.94)';
      ctx.fill();
      ctx.fillStyle = '#1e0b3a';
      ctx.fillText(text, x, r.y + r.h / 2 + 0.5);
    }
    ctx.restore();
  },
  hitTest(x, y) {
    const label = hitLabel(labelHits, x, y);
    if (label) return label;
    const marker = markerHits.find((p) => Math.hypot(p.x - x, (p.y - y) / TILT) < 22);
    return marker ? { kind: 'place', id: marker.placeId } : null;
  },
};

export default labels;
