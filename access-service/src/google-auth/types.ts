import type { GoogleIdentity } from "../access/types.js";

/**
 * Google Auth Module — proves Google identity for Access.login.
 * Owns authorize URL, CSRF state, code exchange, and id_token → sub.
 * Access Module never sees Google HTTP.
 */
export type GoogleAuth = {
  /** Start the OAuth dance: opaque CSRF `state` + URL to send the browser to. */
  begin(redirectUri: string): { authorizeUrl: string; state: string };

  /**
   * Finish: validate `state`, exchange `code`, verify id_token → identity.
   * `redirectUri` must match the one used in `begin`.
   */
  complete(input: {
    code: string;
    state: string;
    redirectUri: string;
  }): Promise<GoogleIdentity>;
};

export type GoogleAuthErrorKind =
  | "invalid_state"
  | "exchange_failed"
  | "invalid_id_token"
  | "missing_sub";

export class GoogleAuthError extends Error {
  readonly kind: GoogleAuthErrorKind;

  constructor(kind: GoogleAuthErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "GoogleAuthError";
    this.kind = kind;
  }
}

export type { GoogleIdentity };
