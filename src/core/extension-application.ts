import { DEFAULT_PANO_LAYOUT } from "../domain/types.js";
import type { LatLng, MapClickButton, PanoLayout } from "../domain/types.js";
import type {
  CredentialSource,
  HostPage,
  SettingsStore,
  StreetViewSurface,
} from "../ports/index.js";

export type ExtensionApplicationDeps = {
  hostPage: HostPage;
  credentials: CredentialSource;
  streetView: StreetViewSurface;
  settings: SettingsStore;
};

/**
 * Extension application core.
 * Testable behind Host Page / Credential source / Street View surface fakes.
 */
export class ExtensionApplication {
  private readonly hostPage: HostPage;
  private readonly credentials: CredentialSource;
  private readonly streetView: StreetViewSurface;
  private readonly settings: SettingsStore;

  private unsubs: Array<() => void> = [];
  private mapClickUnsub: (() => void) | null = null;
  private onRouteBuilder = false;
  private featureEnabled = false;
  private mapClickButton: MapClickButton = "right";
  private userDismissed = false;
  private lastSuccessfulAnchor: LatLng | null = null;
  private coverageGapActive = false;
  private started = false;

  constructor(deps: ExtensionApplicationDeps) {
    this.hostPage = deps.hostPage;
    this.credentials = deps.credentials;
    this.streetView = deps.streetView;
    this.settings = deps.settings;
  }

  /** Snapshot for seam tests. */
  getState() {
    return {
      onRouteBuilder: this.onRouteBuilder,
      featureEnabled: this.featureEnabled,
      mapClickButton: this.mapClickButton,
      panoMounted: this.streetView.isMounted(),
      userDismissed: this.userDismissed,
      lastSuccessfulAnchor: this.lastSuccessfulAnchor
        ? { ...this.lastSuccessfulAnchor }
        : null,
      coverageGapActive: this.coverageGapActive,
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.featureEnabled = await this.settings.getFeatureEnabled();
    this.mapClickButton = await this.settings.getMapClickButton();
    this.hostPage.setMapClickButton(this.mapClickButton);

    this.unsubs.push(
      this.settings.onSettingsChange(() => {
        void this.refreshFromSettings();
      }),
    );

    this.unsubs.push(
      this.hostPage.onRouteBuilderChange((active) => {
        void this.handleRouteBuilderChange(active);
      }),
    );

    this.unsubs.push(
      this.streetView.onUserClose(() => {
        this.userDismissed = true;
        this.tearDownPano();
      }),
    );

    this.unsubs.push(
      this.streetView.onLayoutChange((layout) => {
        void this.settings.setPanoLayout(layout);
      }),
    );

    if (typeof this.hostPage.onMapClickMiss === "function") {
      this.unsubs.push(
        this.hostPage.onMapClickMiss((reason) => {
          void (async () => {
            if (!this.onRouteBuilder || !this.featureEnabled) return;
            await this.ensurePanoMounted();
            this.streetView.setStatusMessage(reason);
          })();
        }),
      );
    }
  }

  stop(): void {
    this.detachMapClick();
    this.tearDownPano();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.started = false;
    this.onRouteBuilder = false;
  }

  private async refreshFromSettings(): Promise<void> {
    this.mapClickButton = await this.settings.getMapClickButton();
    this.hostPage.setMapClickButton(this.mapClickButton);

    const enabled = await this.settings.getFeatureEnabled();
    if (enabled === this.featureEnabled) return;
    this.featureEnabled = enabled;

    if (!this.onRouteBuilder) return;

    if (!enabled) {
      this.userDismissed = false;
      this.detachMapClick();
      this.tearDownPano();
      return;
    }

    this.userDismissed = false;
    await this.ensurePanoMounted();
    try {
      this.attachMapClick();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Map click wiring failed";
      this.streetView.setStatusMessage(message);
    }
  }

  private async handleRouteBuilderChange(active: boolean): Promise<void> {
    this.onRouteBuilder = active;

    if (!active) {
      // Leaving Route Builder: tear down; clear session dismiss so return restores.
      this.userDismissed = false;
      this.detachMapClick();
      this.tearDownPano();
      return;
    }

    if (!this.featureEnabled) {
      this.detachMapClick();
      this.tearDownPano();
      return;
    }

    // Mount first so bridge/click wiring can never block the Pano Window.
    if (!this.userDismissed) {
      await this.ensurePanoMounted();
    }
    try {
      this.attachMapClick();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Map click wiring failed";
      if (this.streetView.isMounted()) {
        this.streetView.setStatusMessage(message);
      }
    }
  }

  private attachMapClick(): void {
    if (this.mapClickUnsub) return;
    this.mapClickUnsub = this.hostPage.onMapClick((point, button) => {
      if (button !== this.mapClickButton) return;
      void this.applyAnchor(point);
    });
  }

  private detachMapClick(): void {
    if (this.mapClickUnsub) {
      this.mapClickUnsub();
      this.mapClickUnsub = null;
    }
  }

  private async ensurePanoMounted(): Promise<void> {
    if (this.streetView.isMounted()) return;
    const stored = await this.settings.getPanoLayout();
    const layout: PanoLayout = stored ?? DEFAULT_PANO_LAYOUT;
    this.streetView.mount(layout);
    this.streetView.setCoverageGapNotice(this.coverageGapActive);
  }

  private tearDownPano(): void {
    this.hostPage.setAnchorMarker(null);
    if (this.streetView.isMounted()) {
      this.streetView.unmount();
    }
  }

  private async applyAnchor(point: LatLng): Promise<void> {
    if (!this.onRouteBuilder || !this.featureEnabled) return;

    this.userDismissed = false;
    await this.ensurePanoMounted();

    const result = await this.credentials.getStreetViewCredentials();
    if (result.status === "denied") {
      this.streetView.setStatusMessage(result.reason);
      return;
    }

    this.streetView.setStatusMessage(null);

    try {
      const coverage = await this.streetView.showAnchor(
        point,
        result.credential,
      );
      if (coverage === "covered") {
        this.lastSuccessfulAnchor = point;
        this.coverageGapActive = false;
        this.streetView.setCoverageGapNotice(false);
        this.hostPage.setAnchorMarker(point);
      } else {
        this.coverageGapActive = true;
        this.streetView.setCoverageGapNotice(true);
        // Keep peg on last successful Pano (do not move to the gap click).
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Street View failed to load";
      this.streetView.setStatusMessage(message);
    }
  }
}
