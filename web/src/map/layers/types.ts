import type { Destination, FilterState, Landmark, Place, Position, Stamp } from '../../types';
import type { View } from '../core/types';

export type { View } from '../core/types';

export interface MapState {
  places: Place[];
  stamps: Stamp[];
  landmarks: Landmark[];
  position: Position | null;
  destination: Destination | null;
  filter: FilterState;
  now: number;
}

export interface Layer {
  name: string;
  draw(ctx: CanvasRenderingContext2D, view: View, state: MapState, t: number): void;
  hitTest?(x: number, y: number): { kind: 'place' | 'building'; id: string } | null;
}
