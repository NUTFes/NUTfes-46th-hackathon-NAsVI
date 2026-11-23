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

const MAX_APPLIED_IDS = 1000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const hasId = (v: unknown): v is { id: string } => isObject(v) && typeof v.id === 'string';
const isStamp = (v: unknown): v is Stamp =>
  hasId(v) && typeof (v as Record<string, unknown>).expiresAt === 'string';
const isPlace = (v: unknown): v is Place =>
  hasId(v) && typeof (v as Record<string, unknown>).name === 'string';
const hasVersion = (v: unknown): v is { version: string } =>
  isObject(v) && typeof v.version === 'string';

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
          if (!isStamp(event.payload)) return;
          useStampsStore().upsert(event.payload);
          break;
        case 'stampRetracted':
          if (!hasId(event.payload)) return;
          useStampsStore().remove(event.payload.id);
          break;
        case 'placeAdded':
        case 'placeUpdated':
          if (!isPlace(event.payload)) return;
          usePlacesStore().upsert(event.payload);
          break;
        case 'placeRemoved':
          // 行き先の解除(D-026・API-5)と tagLinks の整理(API-31)は保存層に依存するため、W-09(つなぎ込み)の仕事。
          if (!hasId(event.payload)) return;
          usePlacesStore().remove(event.payload.id);
          break;
        case 'appVersionChanged': {
          if (!hasVersion(event.payload)) return;
          const { version } = event.payload;
          if (this.version !== version) {
            this.version = version;
            this.versionChanged = true;
          }
          break;
        }
        default:
          return;
      }

      if (event.id !== undefined) {
        this.appliedChangeIds.add(event.id);
        // 上限を超えたら古い順に捨てる(Set は挿入順)
        while (this.appliedChangeIds.size > MAX_APPLIED_IDS) {
          this.appliedChangeIds.delete(this.appliedChangeIds.values().next().value as number);
        }
      }
    },
    // サーバーの id が巻き戻ったとき(resync 後の取り直し)に呼ぶ。呼ぶのは W-09。
    resetAppliedChangeIds() {
      this.appliedChangeIds.clear();
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
