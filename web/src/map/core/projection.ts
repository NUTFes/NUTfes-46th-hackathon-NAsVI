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

/** 画面座標 (sx, sy) を地面 (z=0) 上のワールド座標 [x, y] へ。 */
export function unproject(view: View, W: number, H: number, sx: number, sy: number): [number, number] {
  void H;
  const cs = Math.cos(view.th);
  const sn = Math.sin(view.th);
  const rx = (sx - W / 2) / view.k;
  const ry = -(sy - view.cy) / (view.k * TILT);
  return [rx * cs + ry * sn + view.fx, -rx * sn + ry * cs + view.fy];
}

const KEYS = ['fx', 'fy', 'k', 'th', 'cy'] as const;

/** 視点を目標へ 1 歩近づける(モックは毎フレーム rate=0.16)。 */
export function stepView(view: View, goal: View, rate = 0.16): View {
  const next = { ...view };
  for (const key of KEYS) next[key] = view[key] + (goal[key] - view[key]) * rate;
  return next;
}
