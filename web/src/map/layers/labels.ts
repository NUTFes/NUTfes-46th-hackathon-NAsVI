import { applyFilter, countByBuilding } from '../../domain/filter';
import { toXY } from '../../domain/geo';
import type { Place } from '../../types';
import { project, TILT } from '../core';
import {
  buildingHeight, canvasSize, drawBuildingFlag, drawEventMark, drawFacilityMark, drawParkingMark,
  flagPillWidth, HIT_HALF, isFacility, MARK_FONT, resolveColors,
} from './buildings';
import type { MarkIcon } from './buildings';
import type { Layer } from './types';

export interface Rect { x: number; y: number; w: number; h: number }
export interface LabelHit { rect: Rect; placeId: string; /** 見た目より広げた押下領域(BuildingFlag)。隣の印と競り合う。 */ soft?: boolean; /** soft のとき、描いた丸薬の矩形。この中は常にラベルを優先する。 */ drawn?: Rect }
export interface LabelCandidate {
  placeId: string;
  text: string;
  textWidth: number;
  x: number;
  y: number;
  depth: number;
  isDestination: boolean;
  /** 建物の企画数。あれば吹き出しでなく BuildingFlag(旗+数)の丸薬として置く。 */
  flagCount?: number;
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
    const flag = p.flagCount !== undefined && !p.isDestination;
    if (!p.isDestination && !flag && k < 1.25) continue;
    // 丸薬は建物の中心に重ねる(柄なし)。吹き出しは柄の上に置く。
    const w = flag ? flagPillWidth(p.textWidth) : p.textWidth + (p.isDestination ? 20 : 14);
    const h = flag ? 26 : p.isDestination ? 26 : 22;
    const stem = flag ? -h / 2 : p.isDestination ? 22 : 14;
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

const JP = MARK_FONT;
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
      const zoomed = view.k >= 1.25;
      const names: Rect[] = [];
      for (const p of shown) {
        if (p.landmarkId !== null && !isFacility(p) && p.kind !== 'parking') continue;
        const [wx, wy] = toXY(p.location.lat, p.location.lng);
        const [x, y] = project(view, W, H, wx, wy);
        markerHits.push({ placeId: p.id, x, y });
        // 行き先の丸は route 層(DestinationMark)が描く。ここでは押下領域だけ残す。
        if (p.id === destination?.id) continue;
        const kind = category(p);
        if (kind === 'facility') drawFacilityMark(ctx, colors, x, y, p.kind as MarkIcon, zoomed);
        else if (kind === 'parking') drawParkingMark(ctx, colors, x, y);
        else {
          drawEventMark(ctx, colors, x, y, zoomed);
          if (zoomed) {
            // EventMark.md「拡大すると名前」。丸の下 6 px に text-primary 11 px。重なる名前は省く。
            ctx.font = `700 11px ${JP}`;
            const w = ctx.measureText(p.name).width;
            const rect = { x: x - w / 2, y: y + 16, w, h: 15 };
            if (Number.isFinite(w) && !names.some((other) => rectsOverlap(rect, other))) {
              names.push(rect);
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              if (typeof ctx.strokeText === 'function') {
                ctx.strokeStyle = colors['map-ring'];
                ctx.lineWidth = 3;
                ctx.lineJoin = 'round';
                ctx.strokeText(p.name, x, rect.y + rect.h / 2);
              }
              ctx.fillStyle = colors['text-primary'];
              ctx.fillText(p.name, x, rect.y + rect.h / 2);
            }
          }
        }
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
        // 屋外の企画・設備・駐車場の名前は、地面の印(EventMark など)が出す。吹き出しは目的地だけ。
        if (!isDestination && landmarkId === null) continue;
        if (landmarkId !== null) {
          if (seen.has(landmarkId)) continue;
          seen.add(landmarkId);
        }
        // 目的地は名前の吹き出し。通常の建物は「旗+企画数」の丸薬(BuildingFlag)。
        const flagCount = landmarkId !== null && !isDestination
          ? Math.max(1, counts.get(landmarkId) ?? 0) : undefined;
        const text = flagCount !== undefined ? String(flagCount) : p.name;
        ctx.font = `700 ${isDestination ? 13 : flagCount !== undefined ? 13 : 11}px ${JP}`;
        const textWidth = ctx.measureText(text).width;
        const [x, y, depth] = anchor(p);
        candidates.push({ placeId: p.id, text, textWidth, x, y, depth, isDestination, flagCount });
      }
      const placed = placeLabels(candidates, view.k, W, H);
      // 丸薬は押下領域を 44 CSS px 角にする(配置の重なり判定は見た目の矩形のまま)。
      // 幅は max(44, 丸薬の幅)。2 桁以上の数で丸薬が 44 を超えても、見た目より狭くしない。
      labelHits = placed.map((p) => {
        if (p.flagCount === undefined || p.isDestination) return p;
        const w = Math.max(HIT_HALF * 2, p.rect.w);
        return { placeId: p.placeId, soft: true, drawn: p.rect, rect: { x: p.x - w / 2, y: p.y - HIT_HALF, w, h: HIT_HALF * 2 } };
      });
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (const { placeId, text, x, y, stem, rect: r, isDestination, flagCount } of placed) {
        if (flagCount !== undefined && !isDestination) {
          drawBuildingFlag(ctx, colors, x, y, r.w, flagCount);
          continue;
        }
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
    const marker = markerHits.find((p) => Math.abs(p.x - x) <= HIT_HALF && Math.abs(p.y - y) <= HIT_HALF);
    if (label && marker) {
      // 広げた丸薬の領域は、描いた丸薬の外では地面の印と競り合い、中心が近いほうを返す。
      // 吹き出し(行き先)と、丸薬の描いた矩形の中は従来どおり先頭のラベルを優先する。
      const hit = labelHits.find((h) => h.placeId === label.id)!;
      const { x: rx, y: ry, w, h } = hit.rect;
      const d = hit.drawn;
      const inside = d !== undefined && x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h;
      if (hit.soft && !inside && Math.hypot(x - marker.x, y - marker.y) < Math.hypot(x - (rx + w / 2), y - (ry + h / 2))) {
        return { kind: 'place', id: marker.placeId };
      }
    }
    if (label) return label;
    return marker ? { kind: 'place', id: marker.placeId } : null;
  },
};

export default labels;
