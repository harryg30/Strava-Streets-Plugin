import type { QuotaStore } from "./quota-store.js";

export function createMemoryQuotaStore(): QuotaStore {
  const counts = new Map<string, number>();

  function key(googleAccountId: string, utcDay: string): string {
    return `${googleAccountId}:${utcDay}`;
  }

  return {
    async getCount(googleAccountId, utcDay) {
      return counts.get(key(googleAccountId, utcDay)) ?? 0;
    },
    async increment(googleAccountId, utcDay) {
      const k = key(googleAccountId, utcDay);
      const next = (counts.get(k) ?? 0) + 1;
      counts.set(k, next);
      return next;
    },
  };
}
