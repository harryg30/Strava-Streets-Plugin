/** Internal Seam — Quota persistence (memory / file Adapters). */

export type QuotaStore = {
  /** Successful Mint count for subject on UTC day (YYYY-MM-DD). */
  getCount(googleAccountId: string, utcDay: string): Promise<number>;
  /** Increment and return the new count. Caller must check cap first or use tryConsume. */
  increment(googleAccountId: string, utcDay: string): Promise<number>;
};
