import type {
  CoverageStatus,
  CredentialResult,
  LatLng,
  PanoLayout,
  StreetViewCredential,
} from "../domain/types.js";

/**
 * Credential source port.
 * Dev Key Override (#8) and Access Service (#11) both implement this.
 */
export interface CredentialSource {
  getStreetViewCredentials(): Promise<CredentialResult>;
}

/**
 * Host Page port — Route Builder enter/leave and Map Click.
 * Tip Follow signals land in #10.
 */
export interface HostPage {
  isRouteBuilder(): boolean;
  /** Subscribe to Route Builder presence. Immediate if already there. */
  onRouteBuilderChange(listener: (active: boolean) => void): () => void;
  onMapClick(listener: (point: LatLng) => void): () => void;
  /**
   * Fired when the rider clicks the map but lat/lng could not be resolved
   * (e.g. Strava MRE API shape changed). Optional for fakes/tests.
   */
  onMapClickMiss?(listener: (reason: string) => void): () => void;
}

/**
 * Street View surface port — Pano Window chrome + imagery.
 * View-only: no route-mutation commands.
 */
export interface StreetViewSurface {
  mount(layout: PanoLayout): void;
  unmount(): void;
  isMounted(): boolean;
  setLayout(layout: PanoLayout): void;
  /**
   * Attempt to show Street View at the Anchor Point.
   * On coverage_gap the implementation must keep the last successful Pano
   * (never blank, never auto-snap) and let the core drive the notice.
   */
  showAnchor(
    point: LatLng,
    credential: StreetViewCredential,
  ): Promise<CoverageStatus>;
  setCoverageGapNotice(visible: boolean): void;
  setStatusMessage(message: string | null): void;
  /** Fired when the rider closes the overlay chrome. */
  onUserClose(listener: () => void): () => void;
  /** Fired after drag/resize settles with the new layout. */
  onLayoutChange(listener: (layout: PanoLayout) => void): () => void;
}

export interface SettingsStore {
  getFeatureEnabled(): Promise<boolean>;
  setFeatureEnabled(enabled: boolean): Promise<void>;
  getTipFollowEnabled(): Promise<boolean>;
  setTipFollowEnabled(enabled: boolean): Promise<void>;
  getPanoLayout(): Promise<PanoLayout | null>;
  setPanoLayout(layout: PanoLayout): Promise<void>;
  /** Subscribe to feature / tip-follow changes from Popup or elsewhere. */
  onSettingsChange(listener: () => void): () => void;
}
