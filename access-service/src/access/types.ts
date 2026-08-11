/** Access Module types — domain language from CONTEXT.md */

export type GoogleIdentity = {
  googleAccountId: string;
};

export type Session = {
  sessionId: string;
};

export type Grant = {
  apiKey: string;
  expiresAt: Date;
};

export type MintDenial =
  | { kind: "unauthenticated" }
  | { kind: "membership_required" }
  | { kind: "quota_exceeded"; resetAt: Date };

export type MintResult =
  | { ok: true; grant: Grant }
  | { ok: false; denial: MintDenial };

export type RoleId = "base";

export type Access = {
  /** Every successful login establishes Role `base` for this Google account. */
  login(identity: GoogleIdentity): Promise<Session>;
  /**
   * Mint a Grant for the Session’s rider.
   * Counts against Quota on success (including remint after Grant expiry).
   */
  mint(session: Session | null): Promise<MintResult>;
};

export type AccessConfig = {
  restrictedMapsBrowserKey: string;
  grantTtlMs?: number;
  dailyMintCapByRole?: { base: number };
  clock?: () => Date;
};
