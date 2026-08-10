/**
 * Build resolves this module to `active.dev.ts` or `active.store.ts`
 * via esbuild alias (see scripts/build.mjs). Default export for typecheck/IDE
 * points at the store stub so source never assumes a committed API key.
 */
export { createCredentialSource } from "./active.store.js";
