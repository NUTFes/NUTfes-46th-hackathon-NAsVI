import type { ProjectFn, View } from './types';

export const TILT = 0.52;
export const ZS = 0.9;

/** ワールド座標 (x, y, z) を画面座標へ。戻り値は [X, Y, 奥行き]。 */
export const project: ProjectFn = (view, W, H, x, y, z = 0) => {
  void H;
  const cs = Math.cos(view.th);
  const sn = Math.sin(view.th);
  const X = x - view.fx;
  const Y = y - view.fy;
  const rx = X * cs - Y * sn;
  const ry = X * sn + Y * cs;
  return [W / 2 + rx * view.k, view.cy - ry * view.k * TILT - z * view.k * ZS, ry];
};

/** 画面座標 (sx, sy) を地面 (z=0) 上のワールド座標 [x, y] へ。前提: view.k > 0(k <= 0 は NaN や Infinity になる。ガードはしない)。 */
export function unproject(view: View, W: number, H: number, sx: number, sy: number): [number, number] {
  void H;
  const cs = Math.cos(view.th);
  const sn = Math.sin(view.th);
  const rx = (sx - W / 2) / view.k;
  const ry = -(sy - view.cy) / (view.k * TILT);
  return [rx * cs + ry * sn + view.fx, -rx * sn + ry * cs + view.fy];
}

const TAU = Math.PI * 2;
/** 仕様: 残りがこの値未満なら goal に一致させる(補間の打ち切り)。fx, fy, k, cy は絶対値、th はラジアン。 */
export const SNAP_EPS = 1e-3;

/** a から b へ、最短の弧で回る差(-π..π)。 */
const shortestDelta = (a: number, b: number): number => {
  const d = (((b - a) % TAU) + TAU + Math.PI) % TAU - Math.PI;
  return d;
};

/**
 * 視点を目標へ 1 歩近づける(モックは毎フレーム rate=0.16)。
 * th は最短の弧で補間する(2π をまたぐ目標でも遠回りしない)。
 * 残りが SNAP_EPS 未満になったら goal の値に一致させる。
 */
export function stepView(view: View, goal: View, rate = 0.16): View {
  const next = { ...view };
  for (const key of ['fx', 'fy', 'k', 'cy'] as const) {
    const d = goal[key] - view[key];
    next[key] = Math.abs(d) < SNAP_EPS ? goal[key] : view[key] + d * rate;
  }
  const dth = shortestDelta(view.th, goal.th);
  next.th = Math.abs(dth) < SNAP_EPS ? goal.th : view.th + dth * rate;
  return next;
}
