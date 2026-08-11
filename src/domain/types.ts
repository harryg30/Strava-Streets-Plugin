/** Shared domain types — language from CONTEXT.md */

export type LatLng = {
  lat: number;
  lng: number;
};

export type PanoLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const DEFAULT_PANO_LAYOUT: PanoLayout = {
  x: 24,
  y: 80,
  width: 420,
  height: 320,
};

export type StreetViewCredential = {
  /** Maps JS API key or short-lived token usable as a Maps key. */
  apiKey: string;
};

/** Access Service Mint denials (+ client-only unavailable). */
export type DenialCode =
  | "unauthenticated"
  | "membership_required"
  | "quota_exceeded"
  | "unavailable";

export type CredentialOk = {
  status: "ok";
  credential: StreetViewCredential;
};

export type CredentialDenied = {
  status: "denied";
  code: DenialCode;
  /** Rider-facing copy for Pano Window / Popup. */
  reason: string;
  /** Set when code === "quota_exceeded" when Access Service provides it. */
  resetAt?: Date;
};

export type CredentialResult = CredentialOk | CredentialDenied;

/**
 * Extension Popup account row. getAccount() never Mints (Quota Locality).
 */
export type AccountSnapshot =
  | { kind: "dev_override" }
  | { kind: "signed_out" }
  | { kind: "ready" }
  | {
      kind: "denied";
      code: DenialCode;
      reason: string;
      resetAt?: Date;
    };

export type CoverageStatus = "covered" | "coverage_gap";

/** Which mouse button performs Map Click (sets the Anchor Point). */
export type MapClickButton = "left" | "right";

export type BuildProfile = "dev" | "store";
