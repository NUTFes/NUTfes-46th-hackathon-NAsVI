import { defineStore } from 'pinia';
import type { Place, Stamp } from '../types';
import { usePlacesStore } from './places';
import { useStampsStore } from './stamps';

export type ChangeType =
  | 'stampPressed'
  | 'stampRetracted'
  | 'placeAdded'
  | 'placeUpdated'
  | 'placeRemoved'
  | 'appVersionChanged';

// contracts.md の ChangeEvent と互換。SSE 以外の更新では id を省略できる。
export interface ChangeEvent {
  id?: number;
  type: ChangeType;
  payload: unknown;
}

export const useChangesStore = defineStore('changes', {
  state: () => ({
    version: null as string | null,
    versionChanged: false,
    appliedChangeIds: new Set<number>(),
  }),
  actions: {
    applyChange(event: ChangeEvent) {
      if (event.id !== undefined && this.appliedChangeIds.has(event.id)) return;

      // payload は OpenAPI /changes の各イベントの形。cursor・順序の管理は sync 層が担う。
      switch (event.type) {
        case 'stampPressed':
          useStampsStore().upsert(event.payload as Stamp);
          break;
        case 'stampRetracted':
          useStampsStore().remove((event.payload as { id: string }).id);
          break;
        case 'placeAdded':
        case 'placeUpdated':
          usePlacesStore().upsert(event.payload as Place);
          break;
        case 'placeRemoved':
          usePlacesStore().remove((event.payload as { id: string }).id);
          break;
        case 'appVersionChanged': {
          const { version } = event.payload as { version: string };
          if (this.version !== version) {
            this.version = version;
            this.versionChanged = true;
          }
          break;
        }
        default:
          return;
      }

      if (event.id !== undefined) this.appliedChangeIds.add(event.id);
    },
    acknowledgeVersionChange() {
      this.versionChanged = false;
    },
  },
});

// 有効な Pinia のインスタンスに適用する。個別のインスタンスにはストアの action を使う。
export function applyChange(event: ChangeEvent): void {
  useChangesStore().applyChange(event);
}
