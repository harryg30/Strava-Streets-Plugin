import type {
  AccountSnapshot,
  CoverageStatus,
  CredentialResult,
  LatLng,
  MapClickButton,
  PanoLayout,
  StreetViewCredential,
} from "../domain/types.js";

/**
 * Credential source Seam.
 * Dev Key Override and Access Service Adapters both implement this.
 * getStreetViewCredentials is the only Mint trigger; getAccount never Mints.
 */
export interface CredentialSource {
  getStreetViewCredentials(): Promise<CredentialResult>;
  getAccount(): Promise<AccountSnapshot>;
  /** Opens Access OAuth start (no-op under Dev Key Override). */
  beginLogin(): Promise<void>;
}

/**
 * Host Page port — Route Builder enter/leave and Map Click (left or right).
 */
export interface HostPage {
  isRouteBuilder(): boolean;
  /** Subscribe to Route Builder presence. Immediate if already there. */
  onRouteBuilderChange(listener: (active: boolean) => void): () => void;
  /**
   * Map Click with which button produced it.
   * Callers (core) filter by Map Click Button setting.
   */
  onMapClick(
    listener: (point: LatLng, button: MapClickButton) => void,
  ): () => void;
  /**
   * Fired when the rider clicks the map but lat/lng could not be resolved
   * (e.g. Strava MRE API shape changed). Optional for fakes/tests.
   */
  onMapClickMiss?(listener: (reason: string) => void): () => void;
  /**
   * Which button is the active Map Click Button (default right).
   * Used so right-click can suppress the browser menu only when selected.
   */
  setMapClickButton(button: MapClickButton): void;
  /**
   * Peg on the Route Builder map for the Pano currently shown.
   * Pass null to remove (tear-down / leave Route Builder).
   */
  setAnchorMarker(point: LatLng | null): void;
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
  getMapClickButton(): Promise<MapClickButton>;
  setMapClickButton(button: MapClickButton): Promise<void>;
  getPanoLayout(): Promise<PanoLayout | null>;
  setPanoLayout(layout: PanoLayout): Promise<void>;
  /** Subscribe to Map Click Button changes from Popup or elsewhere. */
  onSettingsChange(listener: () => void): () => void;
}
