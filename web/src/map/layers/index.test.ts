import { describe, expect, it } from 'vitest';
import { layers } from './index';
import type { MapState, View } from './types';

describe('地図の空の層', () => {
  it('契約の順に描画する', () => {
    expect(layers.map((layer) => layer.name)).toEqual([
      'buildings', 'labels', 'route', 'me', 'stamps',
    ]);
  });

  it.each(layers.filter((layer) => ['route', 'me', 'stamps'].includes(layer.name)))('$name の draw が何も描かず、例外を出さない', (layer) => {
    // 空の層は canvas API に触れないため、実際の canvas は必要ない。
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get() { throw new Error('空の層が描画 API を参照しました'); },
      set() { throw new Error('空の層が描画状態を変更しました'); },
    });
    const view: View = { fx: 0, fy: 0, k: 1, th: 0, cy: 0 };
    const state: MapState = {
      places: [], stamps: [], landmarks: [], position: null, destination: null,
      filter: { labelIds: [], tagIds: [] }, now: 0,
    };

    expect(() => layer.draw(ctx, view, state, 0)).not.toThrow();
  });
});
