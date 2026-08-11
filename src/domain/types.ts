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

export type CredentialOk = {
  status: "ok";
  credential: StreetViewCredential;
};

export type CredentialDenied = {
  status: "denied";
  reason: string;
};

export type CredentialResult = CredentialOk | CredentialDenied;

export type CoverageStatus = "covered" | "coverage_gap";

/** Which mouse button performs Map Click (sets the Anchor Point). */
export type MapClickButton = "left" | "right";

export type AccountPlaceholder = "dev_build" | "not_connected";

export type BuildProfile = "dev" | "store";
