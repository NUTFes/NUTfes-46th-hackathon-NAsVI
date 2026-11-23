import { unproject, type View } from './core';

// PR #4 の mock「地図の操作」と同じ固定値。角度はラジアン、移動量は CSS px。
export const TH0 = -0.5; // コンパスで戻す初期角度
export const K_MIN = 0.9;
export const K_MAX = 7;
export const ROTATE_SPEED = 0.008;
export const WHEEL_SPEED = 0.0018;
export const TAP_SLOP = 6;

export interface Point { x: number; y: number }

const clampScale = (k: number) => Math.max(K_MIN, Math.min(K_MAX, k));

/** 指定した画面座標の地面を固定して拡大する。前提: goal.k > 0。goal を更新する。 */
export function zoomAt(goal: View, sx: number, sy: number, W: number, H: number, f: number): void {
  const [wx, wy] = unproject(goal, W, H, sx, sy);
  goal.k = clampScale(goal.k * f);
  const [nx, ny] = unproject(goal, W, H, sx, sy);
  goal.fx += wx - nx;
  goal.fy += wy - ny;
}

/** 以下の操作も goal を更新する。unproject を使う操作の前提は goal.k > 0。 */
export function panBy(goal: View, W: number, H: number, prev: Point, cur: Point): void {
  const [ax, ay] = unproject(goal, W, H, prev.x, prev.y);
  const [bx, by] = unproject(goal, W, H, cur.x, cur.y);
  goal.fx -= bx - ax;
  goal.fy -= by - ay;
}

export function rotateBy(goal: View, dx: number): void {
  goal.th += dx * ROTATE_SPEED;
}

export function pinch(goal: View, W: number, H: number, prev: Point, other: Point, cur: Point): void {
  const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
  const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
  const a0 = Math.atan2(prev.y - other.y, prev.x - other.x);
  const a1 = Math.atan2(cur.y - other.y, cur.x - other.x);
  const [wx, wy] = unproject(goal, W, H, (prev.x + other.x) / 2, (prev.y + other.y) / 2);
  goal.k = clampScale(goal.k * (d1 / Math.max(d0, 1)));
  goal.th -= a1 - a0;
  const [nx, ny] = unproject(goal, W, H, (cur.x + other.x) / 2, (cur.y + other.y) / 2);
  goal.fx += wx - nx;
  goal.fy += wy - ny;
}

export function resetNorth(goal: View): void {
  goal.th = TH0;
}

export interface PointerInput extends Point {
  pointerId: number;
  button?: number;
  shiftKey?: boolean;
}

interface InteractionOptions {
  view: View;
  goal: View;
  getSize(): { width: number; height: number };
  onTap?(x: number, y: number): void;
}

/** DOM からは canvas 内の CSS px を渡す。view の補間は呼び出し側の描画ループが行う。 */
export function createInteraction({ view, goal, getSize, onTap }: InteractionOptions) {
  const pointers = new Map<number, { point: Point; start: Point; moved: boolean; rotate: boolean }>();
  let multiTouch = false;
  const snap = () => Object.assign(view, goal);
  const movedFromStart = (start: Point, point: Point) => Math.hypot(point.x - start.x, point.y - start.y) > TAP_SLOP;

  function pointerDown(input: PointerInput): void {
    if (input.button !== undefined && input.button !== 0 && input.button !== 2) return;
    snap();
    pointers.set(input.pointerId, {
      point: { x: input.x, y: input.y }, start: { x: input.x, y: input.y },
      moved: false, rotate: !!input.shiftKey || input.button === 2,
    });
    if (pointers.size > 1) multiTouch = true;
  }

  function pointerMove(input: PointerInput): void {
    const pointer = pointers.get(input.pointerId);
    if (!pointer) return;
    pointer.moved ||= movedFromStart(pointer.start, input);
    const { width, height } = getSize();
    // mock 同様、連続する操作でも直前の目標を view へ snap してから次の目標を作る。
    snap();
    if (pointers.size === 1) {
      if (pointer.rotate) rotateBy(goal, input.x - pointer.point.x);
      else panBy(goal, width, height, pointer.point, input);
    } else if (pointers.size === 2) {
      const other = [...pointers.values()].find((value) => value !== pointer)!;
      pinch(goal, width, height, pointer.point, other.point, input);
    }
    pointer.point = { x: input.x, y: input.y };
  }

  function endPointer(input: PointerInput, cancelled: boolean): void {
    const pointer = pointers.get(input.pointerId);
    if (!pointer) return;
    pointers.delete(input.pointerId);
    const tap = !cancelled && !multiTouch && !pointer.rotate && !pointer.moved
      && !movedFromStart(pointer.start, input);
    if (pointers.size === 0) {
      multiTouch = false;
      if (tap) onTap?.(input.x, input.y);
    } else if (cancelled) {
      multiTouch = true;
    }
  }

  return {
    pointerDown,
    pointerMove,
    pointerUp: (input: PointerInput) => endPointer(input, false),
    pointerCancel: (input: PointerInput) => endPointer(input, true),
    cancel() { pointers.clear(); multiTouch = false; },
    wheel(x: number, y: number, deltaY: number) {
      const { width, height } = getSize();
      zoomAt(goal, x, y, width, height, Math.exp(-deltaY * WHEEL_SPEED));
    },
  };
}
