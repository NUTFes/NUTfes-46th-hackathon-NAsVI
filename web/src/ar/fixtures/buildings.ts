import { fromXY } from '../../domain/geo';
import type { Landmark, Place } from '../../types';

// 原点の北に幅 10 m・奥行き 10 m、東に幅 10 m・奥行き 10 m の建物を置く。
export const northBuilding: Landmark = {
  id: 'north',
  name: '北棟',
  location: fromXY(0, 15),
  footprint: [[-5, 10], [5, 10], [5, 20], [-5, 20]].map(([x, y]) => fromXY(x, y)),
  floors: [],
};

export const eastBuilding: Landmark = {
  id: 'east',
  name: '東棟',
  location: fromXY(20, 0),
  footprint: [[15, -5], [25, -5], [25, 5], [15, 5]].map(([x, y]) => fromXY(x, y)),
  floors: [],
};

// 北棟より手前でも、輪郭がなければレイには当たらない。
export const shapelessBuilding: Landmark = {
  id: 'shapeless',
  name: '輪郭なし',
  location: fromXY(0, 5),
  footprint: null,
  floors: [],
};

export const buildings: Landmark[] = [shapelessBuilding, northBuilding, eastBuilding];

export const places: Place[] = [
  { id: 'north-event', name: '北棟の企画', location: fromXY(0, 18), landmarkId: 'north' },
  { id: 'hidden-event', name: '北棟の奥の企画', location: fromXY(0, 30), landmarkId: null },
  { id: 'outdoor-event', name: '南の屋外企画', location: fromXY(0, -10), landmarkId: null },
  { id: 'shapeless-event', name: '輪郭なしの企画', location: fromXY(0, 5), landmarkId: 'shapeless' },
].map(place => ({ ...place, kind: 'event', description: '', floor: null, hours: [], labelIds: [] }));
