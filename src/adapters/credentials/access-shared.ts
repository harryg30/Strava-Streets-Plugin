/** Shared Access Service client helpers (extension Adapters). */

export const ACCESS_UNREACHABLE_REASON =
  "Access Service is unreachable. Try again later.";

export function normalizeAccessOrigin(accessOrigin: string): string {
  return accessOrigin.replace(/\/$/, "");
}
