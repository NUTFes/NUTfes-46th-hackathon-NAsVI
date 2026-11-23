export interface View { fx: number; fy: number; k: number; th: number; cy: number }

export type ProjectFn = (
  view: View,
  W: number,
  H: number,
  x: number,
  y: number,
  z?: number,
) => [number, number, number];
