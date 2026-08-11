import * as jose from "jose";
import { mintState, verifyState } from "./state.js";
import { GoogleAuthError, type GoogleAuth } from "./types.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type CreateGoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  /** HMAC secret for CSRF `state` (server-only). */
  stateSecret: string;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected for tests; defaults to Google remote JWKS verification. */
  verifyIdToken?: (
    idToken: string,
    audience: string,
  ) => Promise<{ sub?: string }>;
  clock?: () => Date;
};

type TokenResponse = {
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function verifyIdTokenWithGoogleJwks(
  idToken: string,
  audience: string,
): Promise<{ sub?: string }> {
  const jwks = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  const { payload } = await jose.jwtVerify(idToken, jwks, {
    issuer: GOOGLE_ISSUERS,
    audience,
  });
  return { sub: typeof payload.sub === "string" ? payload.sub : undefined };
}

/**
 * Production Adapter — authorization-code exchange + verified id_token → sub.
 * Secrets stay in this factory; never on the GoogleAuth Interface.
 */
export function createGoogleOAuth(config: CreateGoogleOAuthConfig): GoogleAuth {
  const fetchImpl = config.fetch ?? fetch;
  const verifyIdToken = config.verifyIdToken ?? verifyIdTokenWithGoogleJwks;
  const clock = config.clock ?? (() => new Date());

  return {
    begin(redirectUri) {
      const state = mintState(
        config.stateSecret,
        redirectUri,
        clock().getTime(),
      );
      const url = new URL(GOOGLE_AUTH_URL);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid");
      url.searchParams.set("state", state);
      return { authorizeUrl: url.toString(), state };
    },

    async complete({ code, state, redirectUri }) {
      if (!verifyState(config.stateSecret, state, redirectUri, clock().getTime())) {
        throw new GoogleAuthError("invalid_state");
      }

      let tokenJson: TokenResponse;
      try {
        const tokenRes = await fetchImpl(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });
        tokenJson = (await tokenRes.json()) as TokenResponse;
        if (!tokenRes.ok || !tokenJson.id_token) {
          throw new GoogleAuthError(
            "exchange_failed",
            tokenJson.error_description ??
              tokenJson.error ??
              "token exchange failed",
          );
        }
      } catch (err) {
        if (err instanceof GoogleAuthError) throw err;
        throw new GoogleAuthError(
          "exchange_failed",
          err instanceof Error ? err.message : "token exchange failed",
        );
      }

      let claims: { sub?: string };
      try {
        claims = await verifyIdToken(tokenJson.id_token, config.clientId);
      } catch (err) {
        throw new GoogleAuthError(
          "invalid_id_token",
          err instanceof Error ? err.message : "id_token verification failed",
        );
      }

      if (!claims.sub) {
        throw new GoogleAuthError("missing_sub");
      }

      return { googleAccountId: claims.sub };
    },
  };
}
