import type {
  AccountSnapshot,
  CredentialDenied,
  CredentialResult,
  DenialCode,
} from "../../domain/types.js";
import type { CredentialSource } from "../../ports/index.js";

export type MintTransportOk = {
  ok: true;
  grant: { apiKey: string; expiresAt: Date };
};

export type MintTransportDenial =
  | { kind: "unauthenticated" }
  | { kind: "membership_required" }
  | { kind: "quota_exceeded"; resetAt?: Date };

export type MintTransportResult =
  | MintTransportOk
  | { ok: false; denial: MintTransportDenial };

/** Internal Seam — Access Service Mint transport (remote but owned). */
export type AccessTransport = {
  mint(): Promise<MintTransportResult>;
};

/** Internal Seam — open Access OAuth start in a browser context. */
export type BrowserSession = {
  openAccessLogin(startUrl: string): Promise<void>;
};

export type AccessCredentialSourceDeps = {
  transport: AccessTransport;
  browserSession: BrowserSession;
  accessOrigin: string;
  clock?: () => Date;
};

function denialReason(code: DenialCode, resetAt?: Date): string {
  switch (code) {
    case "unauthenticated":
      return "Connect with Google in the extension popup to load Street View.";
    case "membership_required":
      return "Street View access is not available for this account.";
    case "quota_exceeded":
      return resetAt
        ? `Daily Street View quota reached. Resets ${resetAt.toISOString()}.`
        : "Daily Street View quota reached. Try again tomorrow.";
    case "unavailable":
      return "Access Service is unreachable. Try again later.";
  }
}

function toDenied(
  code: DenialCode,
  resetAt?: Date,
): CredentialDenied {
  return {
    status: "denied",
    code,
    reason: denialReason(code, resetAt),
    ...(resetAt ? { resetAt } : {}),
  };
}

type CachedGrant = { apiKey: string; expiresAt: Date };

/**
 * Access Service CredentialSource Adapter.
 * Owns Grant cache, remint-after-expiry, and denial UX copy.
 * getAccount never Mints.
 */
export class AccessCredentialSource implements CredentialSource {
  private readonly transport: AccessTransport;
  private readonly browserSession: BrowserSession;
  private readonly accessOrigin: string;
  private readonly clock: () => Date;
  private cached: CachedGrant | null = null;
  private lastDenial: CredentialDenied | null = null;
  private mintInFlight: Promise<CredentialResult> | null = null;

  constructor(deps: AccessCredentialSourceDeps) {
    this.transport = deps.transport;
    this.browserSession = deps.browserSession;
    this.accessOrigin = deps.accessOrigin.replace(/\/$/, "");
    this.clock = deps.clock ?? (() => new Date());
  }

  async getStreetViewCredentials(): Promise<CredentialResult> {
    const now = this.clock();
    if (this.cached && this.cached.expiresAt.getTime() > now.getTime()) {
      return { status: "ok", credential: { apiKey: this.cached.apiKey } };
    }

    if (this.mintInFlight) return this.mintInFlight;

    this.mintInFlight = this.mintFresh();
    try {
      return await this.mintInFlight;
    } finally {
      this.mintInFlight = null;
    }
  }

  async getAccount(): Promise<AccountSnapshot> {
    const now = this.clock();
    if (this.cached && this.cached.expiresAt.getTime() > now.getTime()) {
      return { kind: "ready" };
    }
    if (this.lastDenial) {
      return {
        kind: "denied",
        code: this.lastDenial.code,
        reason: this.lastDenial.reason,
        ...(this.lastDenial.resetAt
          ? { resetAt: this.lastDenial.resetAt }
          : {}),
      };
    }
    return { kind: "signed_out" };
  }

  async beginLogin(): Promise<void> {
    const startUrl = `${this.accessOrigin}/v1/auth/google/start`;
    await this.browserSession.openAccessLogin(startUrl);
    // Cookie is set on Access origin after callback — Mint so Popup shows Connected
    // without waiting for a Map Click (getAccount itself still never Mints).
    await this.getStreetViewCredentials();
  }

  private async mintFresh(): Promise<CredentialResult> {
    let result: MintTransportResult;
    try {
      result = await this.transport.mint();
    } catch {
      const denied = toDenied("unavailable");
      this.cached = null;
      this.lastDenial = denied;
      return denied;
    }

    if (!result.ok) {
      const denied = toDenied(
        result.denial.kind,
        result.denial.kind === "quota_exceeded"
          ? result.denial.resetAt
          : undefined,
      );
      this.cached = null;
      this.lastDenial = denied;
      return denied;
    }

    this.cached = {
      apiKey: result.grant.apiKey,
      expiresAt: result.grant.expiresAt,
    };
    this.lastDenial = null;
    return { status: "ok", credential: { apiKey: result.grant.apiKey } };
  }
}
