import { defineStore } from 'pinia';
import type { Place } from '../types';

export const usePlacesStore = defineStore('places', {
  state: () => ({ items: [] as Place[] }),
  actions: {
    setAll(items: readonly Place[]) {
      this.items = [...items];
    },
    upsert(place: Place) {
      const index = this.items.findIndex((item) => item.id === place.id);
      if (index === -1) this.items.push(place);
      else this.items[index] = place;
    },
    remove(id: string) {
      this.items = this.items.filter((item) => item.id !== id);
    },
  },
});
