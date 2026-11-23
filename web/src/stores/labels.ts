import { defineStore } from 'pinia';
import type { Label } from '../types';

export const useLabelsStore = defineStore('labels', {
  state: () => ({ items: [] as Label[] }),
  actions: {
    setAll(items: readonly Label[]) {
      this.items = [...items];
    },
  },
});
