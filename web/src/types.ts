import type { components } from './api/generated/schema';

export type Place = components['schemas']['Place'];
export type PlaceKind = components['schemas']['PlaceKind'];
export type Stamp = components['schemas']['Stamp'];
export type StampKind = components['schemas']['StampKind'];
export type PressedStamp = components['schemas']['PressedStamp'];
export type Landmark = components['schemas']['Landmark'];
export type FloorPlan = components['schemas']['FloorPlan'];
export type Label = components['schemas']['Label'];

export interface Position { lat: number; lng: number; accuracy: number; takenAt: number }
export interface Destination { placeId: string }
export interface FilterState { labelIds: string[]; tagIds: string[] }
export interface MyTag { id: string; title: string; builtin: boolean }
