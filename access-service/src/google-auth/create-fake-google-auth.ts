import { mintState, verifyState } from "./state.js";
import { GoogleAuthError, type GoogleAuth } from "./types.js";

const FAKE_STATE_SECRET = "fake-google-auth-state-secret";

/**
 * Fake Adapter for local/CI — not Google verification.
 * `begin` returns a bounce URL back to `redirectUri` with `code` + `state`.
 * `complete` treats `code` as `googleAccountId` after state check.
 */
export function createFakeGoogleAuth(
  opts: { stateSecret?: string; bounceCode?: string } = {},
): GoogleAuth {
  const stateSecret = opts.stateSecret ?? FAKE_STATE_SECRET;
  const bounceCode = opts.bounceCode ?? "dev-google-user";

  return {
    begin(redirectUri) {
      const state = mintState(stateSecret, redirectUri);
      const url = new URL(redirectUri);
      url.searchParams.set("code", bounceCode);
      url.searchParams.set("state", state);
      return { authorizeUrl: url.toString(), state };
    },

    async complete({ code, state, redirectUri }) {
      if (!verifyState(stateSecret, state, redirectUri)) {
        throw new GoogleAuthError("invalid_state");
      }
      if (!code) {
        throw new GoogleAuthError("exchange_failed", "missing code");
      }
      return { googleAccountId: code };
    },
  };
}
