import type {
  CoverageStatus,
  CredentialResult,
  LatLng,
  MapClickButton,
  PanoLayout,
  StreetViewCredential,
} from "../src/domain/types.js";
import type {
  CredentialSource,
  HostPage,
  SettingsStore,
  StreetViewSurface,
} from "../src/ports/index.js";

export class FakeCredentialSource implements CredentialSource {
  next: CredentialResult = {
    status: "ok",
    credential: { apiKey: "test-key" },
  };
  calls = 0;

  async getStreetViewCredentials(): Promise<CredentialResult> {
    this.calls += 1;
    return this.next;
  }
}

export class FakeHostPage implements HostPage {
  private routeBuilder = false;
  private routeListeners = new Set<(active: boolean) => void>();
  private mapListeners = new Set<
    (point: LatLng, button: MapClickButton) => void
  >();
  mapClickSubscriptionCount = 0;
  mapClickButton: MapClickButton = "right";
  anchorMarker: LatLng | null = null;

  setRouteBuilder(active: boolean): void {
    if (this.routeBuilder === active) return;
    this.routeBuilder = active;
    for (const l of this.routeListeners) l(active);
  }

  emitMapClick(point: LatLng, button: MapClickButton = "right"): void {
    for (const l of this.mapListeners) l(point, button);
  }

  setMapClickButton(button: MapClickButton): void {
    this.mapClickButton = button;
  }

  setAnchorMarker(point: LatLng | null): void {
    this.anchorMarker = point ? { ...point } : null;
  }

  isRouteBuilder(): boolean {
    return this.routeBuilder;
  }

  onRouteBuilderChange(listener: (active: boolean) => void): () => void {
    this.routeListeners.add(listener);
    listener(this.routeBuilder);
    return () => this.routeListeners.delete(listener);
  }

  onMapClick(
    listener: (point: LatLng, button: MapClickButton) => void,
  ): () => void {
    this.mapListeners.add(listener);
    this.mapClickSubscriptionCount += 1;
    return () => {
      this.mapListeners.delete(listener);
      this.mapClickSubscriptionCount -= 1;
    };
  }

  onMapClickMiss(listener: (reason: string) => void): () => void {
    return () => {
      void listener;
    };
  }
}

export class FakeStreetViewSurface implements StreetViewSurface {
  mounted = false;
  layout: PanoLayout | null = null;
  coverageGapNotice = false;
  statusMessage: string | null = null;
  shownAnchors: LatLng[] = [];
  lastCredential: StreetViewCredential | null = null;
  /** Points that return coverage_gap; others covered. */
  gapPoints = new Set<string>();
  /** Last point successfully shown (imagery kept across gaps). */
  lastSuccessfulPoint: LatLng | null = null;
  blanked = false;
  autoSnapped = false;

  private closeListeners = new Set<() => void>();
  private layoutListeners = new Set<(layout: PanoLayout) => void>();

  mount(layout: PanoLayout): void {
    this.mounted = true;
    this.layout = { ...layout };
  }

  unmount(): void {
    this.mounted = false;
  }

  isMounted(): boolean {
    return this.mounted;
  }

  setLayout(layout: PanoLayout): void {
    this.layout = { ...layout };
  }

  async showAnchor(
    point: LatLng,
    credential: StreetViewCredential,
  ): Promise<CoverageStatus> {
    this.shownAnchors.push({ ...point });
    this.lastCredential = credential;
    const key = `${point.lat},${point.lng}`;
    if (this.gapPoints.has(key)) {
      // Keep last successful imagery — never blank or auto-snap.
      return "coverage_gap";
    }
    this.lastSuccessfulPoint = { ...point };
    return "covered";
  }

  setCoverageGapNotice(visible: boolean): void {
    this.coverageGapNotice = visible;
  }

  setStatusMessage(message: string | null): void {
    this.statusMessage = message;
  }

  onUserClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  onLayoutChange(listener: (layout: PanoLayout) => void): () => void {
    this.layoutListeners.add(listener);
    return () => this.layoutListeners.delete(listener);
  }

  simulateUserClose(): void {
    for (const l of this.closeListeners) l();
  }

  simulateLayoutChange(layout: PanoLayout): void {
    this.layout = { ...layout };
    for (const l of this.layoutListeners) l({ ...layout });
  }
}

export class FakeSettingsStore implements SettingsStore {
  featureEnabled = true;
  mapClickButton: MapClickButton = "right";
  panoLayout: PanoLayout | null = null;
  private listeners = new Set<() => void>();

  async getFeatureEnabled(): Promise<boolean> {
    return this.featureEnabled;
  }

  async setFeatureEnabled(enabled: boolean): Promise<void> {
    this.featureEnabled = enabled;
    this.notify();
  }

  async getMapClickButton(): Promise<MapClickButton> {
    return this.mapClickButton;
  }

  async setMapClickButton(button: MapClickButton): Promise<void> {
    this.mapClickButton = button;
    this.notify();
  }

  async getPanoLayout(): Promise<PanoLayout | null> {
    return this.panoLayout ? { ...this.panoLayout } : null;
  }

  async setPanoLayout(layout: PanoLayout): Promise<void> {
    this.panoLayout = { ...layout };
  }

  onSettingsChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Trigger without going through setters (simulates Popup → storage). */
  notify(): void {
    for (const l of this.listeners) l();
  }
}
