/**
 * Overpass interpreter: https://overpass-api.de/api/interpreter (POST).
 * 共有サービスの負荷を抑えるため、半径 10m の building way/relation を
 * out geom で一度だけ問い合わせる。再試行・別エンドポイントへの迂回・
 * リダイレクトはしない。サーバー timeout は 8 秒、AbortController も 8 秒。
 * User-Agent: NASVI/1.0 (building footprint retrieval)。取得結果は D1 に保存する。
 * OSM データの利用は ODbL と OpenStreetMap contributors の帰属表示に従う。
 */
import type { components } from '../schema';

export type Point = components['schemas']['Point'];

const endpoint = 'https://overpass-api.de/api/interpreter';
const timeoutMs = 8_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validPoint(point: Point): boolean {
  return Number.isFinite(point.lat) && Math.abs(point.lat) <= 90
    && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

function geometry(value: unknown): Point[] | null {
  if (!Array.isArray(value)) return null;
  const points: Point[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.lat !== 'number' || typeof item.lon !== 'number') return null;
    const point = { lat: item.lat, lng: item.lon };
    if (!validPoint(point)) return null;
    if (!points.length || !samePoint(points[points.length - 1], point)) points.push(point);
  }
  return points.length >= 2 ? points : null;
}

function samePoint(a: Point, b: Point): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

// Translate to a local origin before the shoelace sum to avoid cancellation.
function area(ring: Point[]): number {
  const origin = ring[0];
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += (a.lng - origin.lng) * (b.lat - origin.lat) - (b.lng - origin.lng) * (a.lat - origin.lat);
  }
  return Math.abs(sum) / 2;
}

function polygon(points: Point[]): Point[] | null {
  if (!samePoint(points[0], points[points.length - 1])) return null;
  const ring = points.slice(0, -1);
  if (new Set(ring.map(p => `${p.lat},${p.lng}`)).size < 3 || area(ring) === 0) return null;
  return ring;
}

// Ray casting, including points on the boundary.
function contains(ring: Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    const cross = (point.lng - a.lng) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lng - a.lng);
    if (Math.abs(cross) <= 1e-14
      && point.lng >= Math.min(a.lng, b.lng) && point.lng <= Math.max(a.lng, b.lng)
      && point.lat >= Math.min(a.lat, b.lat) && point.lat <= Math.max(a.lat, b.lat)) return true;
    if ((a.lat > point.lat) !== (b.lat > point.lat)
      && point.lng < (b.lng - a.lng) * (point.lat - a.lat) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

// Multipolygon members may be open ways in either direction. Join their ends
// before considering a ring; never turn an incomplete member into a polygon.
function joinRings(segments: Point[][]): Point[][] | null {
  const remaining = segments.slice();
  const rings: Point[][] = [];
  while (remaining.length) {
    let chain = remaining.shift()!.slice();
    while (!samePoint(chain[0], chain[chain.length - 1])) {
      const end = chain[chain.length - 1];
      const index = remaining.findIndex(s => samePoint(s[0], end) || samePoint(s[s.length - 1], end));
      if (index === -1) return null;
      let next = remaining.splice(index, 1)[0];
      if (!samePoint(next[0], end)) next = next.slice().reverse();
      chain = chain.concat(next.slice(1));
    }
    const ring = polygon(chain);
    if (!ring) return null;
    rings.push(ring);
  }
  return rings;
}

function candidates(element: unknown, location: Point): Point[][] {
  if (!record(element) || !record(element.tags) || !element.tags.building || element.tags.building === 'no') return [];
  if (element.type === 'way') {
    const points = geometry(element.geometry);
    const ring = points && polygon(points);
    return ring && contains(ring, location) ? [ring] : [];
  }
  if (element.type !== 'relation' || !Array.isArray(element.members)) return [];
  const outer: Point[][] = [];
  const inner: Point[][] = [];
  for (const member of element.members) {
    if (!record(member) || member.type !== 'way') continue;
    if (member.role !== 'outer' && member.role !== 'inner' && member.role !== '') continue;
    const points = geometry(member.geometry);
    if (!points) return [];
    (member.role === 'inner' ? inner : outer).push(points);
  }
  const shells = joinRings(outer);
  const holes = joinRings(inner);
  if (!shells || !holes || holes.some(ring => contains(ring, location))) return [];
  return shells.filter(ring => contains(ring, location));
}

export async function fetchFootprint(location: Point): Promise<Point[] | null> {
  if (!validPoint(location)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const around = `around:10,${location.lat},${location.lng}`;
    const query = `[out:json][timeout:8];(way["building"](${around});relation["building"](${around}););out geom;`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'NASVI/1.0 (building footprint retrieval)',
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    // Overpass can return partial results with a runtime error in a 200 body.
    if (controller.signal.aborted || !record(data) || data.remark || !Array.isArray(data.elements)) return null;
    let best: Point[] | null = null;
    for (const element of data.elements) {
      for (const ring of candidates(element, location)) {
        if (!best || area(ring) < area(best)) best = ring;
      }
    }
    return best;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
