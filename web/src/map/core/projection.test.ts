import { describe, expect, it } from 'vitest';
import { SNAP_EPS, TILT, ZS, project, stepView, unproject } from './projection';
import type { View } from './types';

const view: View = { fx: 10, fy: -20, k: 1.5, th: -0.5, cy: 300 };

describe('projection', () => {
  it('モックと同じ定数', () => {
    expect(TILT).toBe(0.52);
    expect(ZS).toBe(0.9);
  });
  it('project と unproject の往復が元に戻る', () => {
    for (const [x, y] of [[0, 0], [50, -30], [-120, 200]]) {
      const [X, Y] = project(view, 400, 800, x, y);
      const [bx, by] = unproject(view, 400, 800, X, Y);
      expect(bx).toBeCloseTo(x, 9);
      expect(by).toBeCloseTo(y, 9);
    }
  });
  it('モックの式どおりの値になる', () => {
    const v: View = { fx: 0, fy: 0, k: 2, th: 0, cy: 100 };
    expect(project(v, 200, 400, 10, 20, 5)).toEqual([120, 100 - 20 * 2 * 0.52 - 5 * 2 * 0.9, 20]);
  });
  it('stepView は目標へ補間する', () => {
    const goal: View = { fx: 100, fy: 0, k: 3, th: 0, cy: 0 };
    const n = stepView({ fx: 0, fy: 0, k: 1, th: 0, cy: 0 }, goal, 0.5);
    expect(n.fx).toBe(50);
    expect(n.k).toBe(2);
  });
  it('unproject: 画面中心(W/2, cy)が (fx, fy) になる', () => {
    const [x, y] = unproject(view, 400, 800, 200, view.cy);
    expect(x).toBeCloseTo(view.fx, 9);
    expect(y).toBeCloseTo(view.fy, 9);
  });
  it('th の符号: th=π/2 のとき世界の +x は画面の上(ry が増える向き)に出る', () => {
    const v: View = { fx: 0, fy: 0, k: 1, th: Math.PI / 2, cy: 100 };
    const [X, Y, depth] = project(v, 200, 400, 10, 0);
    expect(X).toBeCloseTo(100, 9);
    expect(depth).toBeCloseTo(10, 9);
    expect(Y).toBeCloseTo(100 - 10 * 0.52, 9);
  });
  it('複数の視点・z=0 で往復が戻る', () => {
    const views: View[] = [
      { fx: 0, fy: 0, k: 1, th: 0, cy: 100 },
      { fx: -30, fy: 40, k: 3.2, th: 2.5, cy: 250 },
      { fx: 500, fy: -500, k: 0.4, th: -3, cy: 0 },
    ];
    for (const v of views) {
      const [X, Y] = project(v, 360, 640, 12.5, -7);
      const [x, y] = unproject(v, 360, 640, X, Y);
      expect(x).toBeCloseTo(12.5, 8);
      expect(y).toBeCloseTo(-7, 8);
    }
  });
  it('stepView: th は 2π をまたいでも最短の弧で回る', () => {
    const from: View = { fx: 0, fy: 0, k: 1, th: 3.0, cy: 0 };
    const n = stepView(from, { ...from, th: -3.0 }, 0.5);
    expect(n.th).toBeGreaterThan(3.0); // 遠回り(減少)しない
  });
  it('stepView: 十分近ければ goal に一致する', () => {
    const from: View = { fx: 0, fy: 0, k: 1, th: 0, cy: 0 };
    const goal: View = { fx: SNAP_EPS / 2, fy: 0, k: 1, th: SNAP_EPS / 2, cy: 0 };
    expect(stepView(from, goal)).toEqual(goal);
  });
});
