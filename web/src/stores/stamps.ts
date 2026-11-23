import { defineStore } from 'pinia';
import type { Stamp } from '../types';

// domain/stamps.ts が実装されるまで、API の expiresAt で判定する。
function isExpired(stamp: Stamp, now: number): boolean {
  const expiresAt = Date.parse(stamp.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt <= now; // 読めない日付は期限切れ扱い
}

export const useStampsStore = defineStore('stamps', {
  state: () => ({ items: [] as Stamp[] }),
  getters: {
    // 時計は呼び出すたびに読む。getter のキャッシュで時刻を固定しない。
    activeStamps: (state) => (now: number = Date.now()): Stamp[] =>
      state.items.filter((stamp) => !isExpired(stamp, now)),
  },
  actions: {
    setAll(items: readonly Stamp[]) {
      this.items = [...items];
    },
    upsert(stamp: Stamp) {
      const index = this.items.findIndex((item) => item.id === stamp.id);
      if (index === -1) this.items.push(stamp);
      else this.items[index] = stamp;
    },
    remove(id: string) {
      this.items = this.items.filter((item) => item.id !== id);
    },
  },
});
