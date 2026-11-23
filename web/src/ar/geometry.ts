import { bearingDeg, toXY } from '../domain/geo';
import type { Landmark, Place } from '../types';

/**
 * 以下の5定数は決定根拠のない仮置きの値。
 * PR #4 の通常版に合わせた初期値であり、実機で調整する。
 */
/** 輪郭に接した現在地での自己交差を避ける最小距離。単位は m。 */
export const RAY_MIN_T = 0.5;
/** 正面の建物を探す直線距離の上限。単位は m。 */
export const FRONT_MAX_M = 300;
/** 頂点自体への衝突を避け、手前まで可視判定する余裕。単位は m。 */
export const VERTEX_MARGIN_M = 1.5;
/** 現在地に近すぎる頂点を除外する距離。単位は m。 */
export const VERTEX_MIN_DIST_M = 1;
/** カメラ長辺の画角。端末ごとに異なるため、呼び出し側で ?fov= による上書きを想定。 */
export const DEFAULT_LONG_FOV_DEG = 65;

/** 東が +x、北が +y、単位は m。anchor もこの座標系。 */
export type XY = readonly [number, number];
export type Location = Place['location'];

export interface RayHit {
  building: Landmark;
  /** 方向ベクトルが単位ベクトルである前提での直線距離 m。 */
  distance: number;
}

export interface Visibility {
  occluded: boolean;
  anchor: XY | null;
  /** anchor の方位を基準とする相対角の [最小, 最大]。単位は度。 */
  span: [number, number] | null;
  /** 見える頂点までの最短距離。建物以外・可視頂点なしは null。 */
  nearD: number | null;
}

export interface TargetDescription {
  distance: number;
  /** 北 0°、東 90°の時計回り。0 以上 360 未満。 */
  bearing: number;
  occluded: boolean;
}

export interface PlaceDescription extends TargetDescription, Visibility {
  place: Place;
}

interface ProjectedBuilding {
  building: Landmark;
  footprint: XY[];
}

function project(location: Location): XY {
  return toXY(location.lat, location.lng);
}

function isFiniteXY(point: XY): boolean {
  return point.every(Number.isFinite);
}

function projectBuildings(buildings: readonly Landmark[]): ProjectedBuilding[] {
  return buildings.flatMap(building => building.footprint === null ? [] : [{
    building,
    footprint: building.footprint.map(project),
  }]);
}

/** 方位差を -180 以上 180 未満に折り返す。入力は方位同士の差を想定。 */
export function wrap180(angle: number): number {
  return ((angle + 540) % 360) - 180;
}

/**
 * bearingDeg は緯度経度入力だが、anchor と可視頂点は平面座標。
 * fromXY で緯度経度に戻すと往復誤差が出るため、ここでは平面上で方位を求める。
 */
function bearingXY(from: XY, to: XY): number {
  return (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI + 360) % 360;
}

function castProjectedRay(
  origin: XY,
  dx: number,
  dy: number,
  maxT: number,
  buildings: readonly ProjectedBuilding[],
): RayHit | null {
  let bestT = maxT;
  let hit: RayHit | null = null;
  const [ox, oy] = origin;
  for (const { building, footprint } of buildings) {
    for (let i = 0; i < footprint.length; i++) {
      const [x1, y1] = footprint[i];
      const [x2, y2] = footprint[(i + 1) % footprint.length];
      const ex = x2 - x1;
      const ey = y2 - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((x1 - ox) * ey - (y1 - oy) * ex) / den;
      const u = ((x1 - ox) * dy - (y1 - oy) * dx) / den;
      if (t > RAY_MIN_T && t < bestT && u >= 0 && u <= 1) {
        bestT = t;
        hit = { building, distance: t };
      }
    }
  }
  return hit;
}

/** 単位方向 (dx, dy) に発射し、最初の建物を返す。maxT と同距離の交差は含めない。 */
export function castRay(
  origin: XY,
  dx: number,
  dy: number,
  maxT: number,
  buildings: readonly Landmark[],
): RayHit | null {
  return castProjectedRay(origin, dx, dy, maxT, projectBuildings(buildings));
}

/** 緯度経度の現在地から、北 0°・東 90°の方向にある正面の建物を探す。 */
export function pickFront(
  pos: Location,
  headingDeg: number,
  buildings: readonly Landmark[],
): RayHit | null {
  const origin = project(pos);
  if (!isFiniteXY(origin) || !Number.isFinite(headingDeg)) return null;
  const heading = headingDeg * Math.PI / 180;
  return castRay(origin, Math.sin(heading), Math.cos(heading), FRONT_MAX_M, buildings);
}

function projectedVisibility(
  origin: XY,
  target: Landmark | Place,
  buildings: readonly ProjectedBuilding[],
): Visibility {
  if (!isFiniteXY(origin)) return { occluded: true, anchor: null, span: null, nearD: null };
  const isBuilding = 'footprint' in target;
  const points = isBuilding ? (target.footprint ?? []).map(project) : [project(target.location)];
  const visible: XY[] = [];
  let nearD: number | null = null;
  for (const point of points) {
    const dx = point[0] - origin[0];
    const dy = point[1] - origin[1];
    const d = Math.hypot(dx, dy);
    if (!Number.isFinite(d) || d < VERTEX_MIN_DIST_M) continue;
    const hit = castProjectedRay(origin, dx / d, dy / d, d - VERTEX_MARGIN_M, buildings);
    if (hit === null || (isBuilding && hit.building.id === target.id)) {
      visible.push(point);
      if (isBuilding) nearD = Math.min(nearD ?? Infinity, d);
    }
  }
  if (visible.length === 0) return { occluded: true, anchor: null, span: null, nearD: null };
  const anchor: XY = [
    visible.reduce((sum, point) => sum + point[0], 0) / visible.length,
    visible.reduce((sum, point) => sum + point[1], 0) / visible.length,
  ];
  const anchorBearing = bearingXY(origin, anchor);
  const angles = visible.map(point => wrap180(bearingXY(origin, point) - anchorBearing));
  return {
    occluded: false,
    anchor,
    span: [Math.min(...angles), Math.max(...angles)],
    nearD,
  };
}

/** 建物は輪郭の頂点、企画は登録座標を使う。輪郭のない建物には可視頂点がない。 */
export function visibility(
  pos: Location,
  target: Landmark | Place,
  buildings: readonly Landmark[],
): Visibility {
  return projectedVisibility(project(pos), target, projectBuildings(buildings));
}

/** 位置または平面座標の anchor への直線距離・絶対方位と、可視判定の結果をまとめる。 */
export function describeTarget(
  pos: Location,
  target: Location | XY,
  occluded = false,
): TargetDescription {
  const origin = project(pos);
  const point = 'lat' in target ? project(target) : target;
  // 無効な座標は距離不明として扱い、表示候補から外せる値を返す。
  if (!isFiniteXY(origin) || !isFiniteXY(point)) {
    return { distance: Infinity, bearing: 0, occluded: true };
  }
  return {
    distance: Math.hypot(point[0] - origin[0], point[1] - origin[1]),
    bearing: 'lat' in target ? bearingDeg(pos, target) : bearingXY(origin, point),
    occluded,
  };
}

/** 入力順に企画を記述する。所属建物の輪郭がなければ企画の登録座標で可視判定する。 */
export function describePlaces(
  pos: Location,
  places: readonly Place[],
  buildings: readonly Landmark[],
): PlaceDescription[] {
  const origin = project(pos);
  const projected = projectBuildings(buildings);
  const byId = new Map(buildings.map(building => [building.id, building]));
  const buildingVisibility = new Map<Landmark['id'], Visibility>();
  return places.map(place => {
    const building = place.landmarkId === null ? undefined : byId.get(place.landmarkId);
    let result: Visibility;
    if (building?.footprint?.length) {
      result = buildingVisibility.get(building.id) ?? projectedVisibility(origin, building, projected);
      buildingVisibility.set(building.id, result);
    } else {
      result = projectedVisibility(origin, place, projected);
    }
    return {
      place,
      ...describeTarget(pos, result.anchor ?? place.location, result.occluded),
      ...result,
    };
  });
}
