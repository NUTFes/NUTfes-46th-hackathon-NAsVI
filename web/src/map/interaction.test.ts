import { describe, expect, it, vi } from 'vitest';
import { project, stepView, unproject, type View } from './core';
import {
  createInteraction, K_MAX, K_MIN, panBy, pinch, resetNorth, rotateBy,
  ROTATE_SPEED, TAP_SLOP, TH0, WHEEL_SPEED, zoomAt,
} from './interaction';

const W = 480;
const H = 640;
const initial = (): View => ({ fx: 20, fy: -30, k: 2, th: TH0, cy: H / 2 });
const point = (x: number, y: number, pointerId = 1) => ({ x, y, pointerId });

describe('mock と同じ地図操作の数式', () => {
  it('固定値を維持する', () => {
    expect([TH0, K_MIN, K_MAX, ROTATE_SPEED, WHEEL_SPEED, TAP_SLOP])
      .toEqual([-0.5, 0.9, 7, 0.008, 0.0018, 6]);
  });

  it('パンすると、つかんだ地面が指の移動先へ動く', () => {
    const goal = initial();
    const prev = point(80, 120);
    const cur = point(140, 160);
    const [x, y] = unproject(goal, W, H, prev.x, prev.y);
    panBy(goal, W, H, prev, cur);
    const [sx, sy] = project(goal, W, H, x, y);
    expect(sx).toBeCloseTo(cur.x, 10);
    expect(sy).toBeCloseTo(cur.y, 10);
    expect(goal.fx).not.toBe(initial().fx);
    expect(goal.fy).not.toBe(initial().fy);
  });

  it.each([0.00001, 0.7, 1.4, 10000])('拡大率 %s: 固定点を保ち、k を clamp する', (factor) => {
    const goal = initial();
    const before = unproject(goal, W, H, 100, 70);
    zoomAt(goal, 100, 70, W, H, factor);
    expect(goal.k).toBe(Math.max(K_MIN, Math.min(K_MAX, 2 * factor)));
    const after = unproject(goal, W, H, 100, 70);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('回転量の符号と速度が mock と同じで、コンパスは TH0 に戻す', () => {
    const goal = initial();
    rotateBy(goal, 50);
    expect(goal.th).toBeCloseTo(TH0 + 50 * ROTATE_SPEED);
    rotateBy(goal, -20);
    expect(goal.th).toBeCloseTo(TH0 + 30 * ROTATE_SPEED);
    resetNorth(goal);
    expect(goal.th).toBe(TH0);
  });

  it('ピンチで距離比・角度差を適用し、移動後の中点に地面を固定する', () => {
    const goal = initial();
    const prev = point(200, 200);
    const other = point(100, 200);
    const cur = point(250, 250);
    const world = unproject(goal, W, H, 150, 200);
    pinch(goal, W, H, prev, other, cur);
    expect(goal.k).toBeCloseTo(2 * Math.hypot(150, 50) / 100);
    expect(goal.th).toBeCloseTo(TH0 - Math.atan2(50, 150));
    const [sx, sy] = project(goal, W, H, ...world);
    expect(sx).toBeCloseTo(175, 10);
    expect(sy).toBeCloseTo(225, 10);
  });

  it('指が重なっていても有限値になり、ピンチの k も上下限を守る', () => {
    const goal = initial();
    pinch(goal, W, H, point(100, 100), point(100, 100), point(400, 200));
    expect(goal.k).toBe(K_MAX);
    expect(Object.values(goal).every(Number.isFinite)).toBe(true);
    pinch(goal, W, H, point(400, 200), point(100, 100), point(100, 100));
    expect(goal.k).toBe(K_MIN);
    expect(Object.values(goal).every(Number.isFinite)).toBe(true);
  });
});

function controller() {
  const view = initial();
  const goal = initial();
  const onTap = vi.fn();
  return { view, goal, onTap, ...createInteraction({ view, goal, onTap, getSize: () => ({ width: W, height: H }) }) };
}

describe('DOM に依存しないポインタ操作コントローラ', () => {
  it('操作開始時に view を goal へ snap し、パンの goal へ stepView で近づく', () => {
    const c = controller();
    c.goal.fx += 100;
    c.pointerDown(point(80, 100));
    expect(c.view).toEqual(c.goal);
    c.pointerMove(point(140, 130));
    const next = stepView(c.view, c.goal);
    expect(next.fx).not.toBe(c.view.fx);
    expect(Math.abs(next.fx - c.goal.fx)).toBeLessThan(Math.abs(c.view.fx - c.goal.fx));
    const previousGoal = { ...c.goal };
    c.pointerMove(point(160, 140));
    expect(c.view).toEqual(previousGoal);
    c.pointerUp(point(160, 140));
    expect(c.onTap).not.toHaveBeenCalled();
  });

  it('ホイールで goal の倍率が変わり、view は次の描画で補間される', () => {
    const c = controller();
    c.wheel(100, 80, -100);
    expect(c.goal.k).toBeCloseTo(2 * Math.exp(100 * WHEEL_SPEED));
    expect(c.view.k).toBe(2);
    expect(stepView(c.view, c.goal).k).toBeGreaterThan(c.view.k);
    c.wheel(100, 80, -1000000);
    expect(c.goal.k).toBe(K_MAX);
    c.wheel(100, 80, 1000000);
    expect(c.goal.k).toBe(K_MIN);
  });

  it.each([{ shiftKey: true }, { button: 2 }])('%o のドラッグで回転する', (mode) => {
    const c = controller();
    c.pointerDown({ ...point(100, 100), ...mode });
    c.pointerMove(point(150, 130));
    expect(c.goal.th).toBeCloseTo(TH0 + 0.4);
    expect(c.goal.fx).toBe(c.view.fx);
    expect(c.goal.fy).toBe(c.view.fy);
    expect(stepView(c.view, c.goal).th).not.toBe(c.view.th);
    c.pointerUp(point(150, 130));
    expect(c.onTap).not.toHaveBeenCalled();
  });

  it('2 本指で拡大・回転し、残った指でパンできるがタップしない', () => {
    const c = controller();
    c.pointerDown(point(100, 100));
    c.pointerDown(point(200, 100, 2));
    c.pointerMove(point(250, 150, 2));
    expect(c.goal.k).toBeGreaterThan(c.view.k);
    expect(c.goal.th).toBeLessThan(c.view.th);
    c.pointerUp(point(250, 150, 2));
    const before = { ...c.goal };
    c.pointerMove(point(110, 110));
    expect(c.goal.fx).not.toBe(before.fx);
    c.pointerUp(point(110, 110));
    expect(c.onTap).not.toHaveBeenCalled();
  });

  it('TAP_SLOP 以下はタップ、超えた後に戻ってもドラッグとして扱う', () => {
    const c = controller();
    c.pointerDown(point(100, 100));
    c.pointerMove(point(106, 100));
    c.pointerUp(point(106, 100));
    expect(c.onTap).toHaveBeenCalledExactlyOnceWith(106, 100);
    c.pointerDown(point(100, 100));
    c.pointerMove(point(107, 100));
    c.pointerMove(point(100, 100));
    c.pointerUp(point(100, 100));
    expect(c.onTap).toHaveBeenCalledTimes(1);
  });

  it('up だけで閾値を超えた移動・キャンセル・複数指・回転はタップしない', () => {
    const c = controller();
    c.pointerDown(point(100, 100));
    c.pointerUp(point(107, 100));
    c.pointerDown(point(100, 100));
    c.pointerCancel(point(100, 100));
    c.pointerDown(point(100, 100));
    c.pointerDown(point(200, 100, 2));
    c.pointerCancel(point(200, 100, 2));
    c.pointerUp(point(100, 100));
    c.pointerDown({ ...point(100, 100), button: 2 });
    c.pointerUp(point(100, 100));
    expect(c.onTap).not.toHaveBeenCalled();
  });

  it('cancel で全操作を破棄し、不明な指や中ボタンの操作を無視する', () => {
    const c = controller();
    c.pointerDown(point(100, 100));
    c.cancel();
    c.pointerMove(point(200, 100));
    c.pointerUp(point(200, 100));
    c.pointerDown({ ...point(100, 100), button: 1 });
    c.pointerMove(point(200, 100));
    c.pointerUp(point(200, 100));
    expect(c.goal).toEqual(initial());
    expect(c.onTap).not.toHaveBeenCalled();
    c.pointerDown(point(100, 100));
    c.pointerUp(point(100, 100));
    expect(c.onTap).toHaveBeenCalledTimes(1);
  });
});
