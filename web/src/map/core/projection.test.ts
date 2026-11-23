import { describe, expect, it } from 'vitest';
import { TILT, ZS, project, stepView, unproject } from './projection';
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
});
