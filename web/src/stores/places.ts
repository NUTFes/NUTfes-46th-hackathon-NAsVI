import { defineStore } from 'pinia';
import type { Place } from '../types';

export const usePlacesStore = defineStore('places', {
  // 削除した id の墓標。遅れて届いた古い placeUpdated で場所が復活しないようにする(id は再利用しない契約)。
  state: () => ({ items: [] as Place[], removedIds: new Set<string>() }),
  actions: {
    setAll(items: readonly Place[]) {
      this.items = [...items];
      this.removedIds.clear(); // 取り直した一覧が正

    },
    upsert(place: Place) {
      if (this.removedIds.has(place.id)) return;
      const index = this.items.findIndex((item) => item.id === place.id);
      if (index === -1) this.items.push(place);
      else this.items[index] = place;
    },
    remove(id: string) {
      this.removedIds.add(id);
      this.items = this.items.filter((item) => item.id !== id);
    },
  },
});
