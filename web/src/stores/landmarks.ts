import { defineStore } from 'pinia';
import type { Landmark } from '../types';

export const useLandmarksStore = defineStore('landmarks', {
  state: () => ({ items: [] as Landmark[] }),
  actions: {
    setAll(items: readonly Landmark[]) {
      this.items = [...items];
    },
  },
});
