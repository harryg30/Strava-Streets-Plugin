import type { GoogleOAuthPort } from "./create-http-app.js";

/**
 * Local/smoke stand-in — not Google verification.
 * Treats the authorization `code` as `googleAccountId`.
 * Production must inject a real GoogleOAuthPort Adapter.
 */
export function createDevOAuthStandIn(): GoogleOAuthPort {
  return {
    async exchangeCode(code) {
      return { googleAccountId: code };
    },
  };
}
