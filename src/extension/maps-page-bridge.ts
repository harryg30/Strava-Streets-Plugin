/**
 * Page-world bridge for Google Maps Street View.
 * Injected via <script src=chrome-extension://…/maps-page-bridge.js>.
 * Speaks to the isolated content script over window.postMessage.
 *
 * Must stay free of chrome.* APIs — those are unavailable in the page world.
 */
import {
  ANCHOR_COVERAGE_RADIUS_M,
  resolveAnchorCoverage,
} from "./street-view-coverage.js";

(() => {
  const SOURCE = "ssp-page-bridge";
  const REQUEST = "ssp-isolated";

  let loadedKey: string | null = null;
  let loadPromise: Promise<void> | null = null;
  let panorama: google.maps.StreetViewPanorama | null = null;
  let svService: google.maps.StreetViewService | null = null;
  let viewportId: string | null = null;

  function reply(
    id: string,
    payload: {
      ok: boolean;
      coverage?: "covered" | "coverage_gap";
      error?: string;
    },
  ): void {
    window.postMessage({ source: SOURCE, id, ...payload }, "*");
  }

  function loadMaps(apiKey: string): Promise<void> {
    if (
      typeof google !== "undefined" &&
      google.maps?.StreetViewPanorama &&
      loadedKey === apiKey
    ) {
      return Promise.resolve();
    }
    if (loadPromise && loadedKey === apiKey) return loadPromise;

    loadedKey = apiKey;
    loadPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById("ssp-maps-js");
      if (existing) {
        waitForMaps().then(resolve, reject);
        return;
      }
      const script = document.createElement("script");
      script.id = "ssp-maps-js";
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
      script.onload = () => waitForMaps().then(resolve, reject);
      script.onerror = () =>
        reject(new Error("Failed to load Google Maps JavaScript API"));
      document.head.appendChild(script);
    });
    return loadPromise;
  }

  function waitForMaps(): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (typeof google !== "undefined" && google.maps?.StreetViewPanorama) {
          resolve();
          return;
        }
        if (Date.now() - start > 15000) {
          reject(new Error("Timed out waiting for Google Maps"));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  async function showAnchor(
    id: string,
    apiKey: string,
    nextViewportId: string,
    point: { lat: number; lng: number },
  ): Promise<void> {
    await loadMaps(apiKey);
    const el = document.getElementById(nextViewportId);
    if (!el) {
      reply(id, { ok: false, error: "Pano viewport missing" });
      return;
    }

    const service = svService ?? new google.maps.StreetViewService();
    svService = service;

    const resolved = await new Promise<
      ReturnType<typeof resolveAnchorCoverage>
    >((resolve) => {
      service.getPanorama(
        { location: point, radius: ANCHOR_COVERAGE_RADIUS_M },
        (data, status) => {
          resolve(resolveAnchorCoverage(String(status), data));
        },
      );
    });

    if (resolved.coverage === "coverage_gap") {
      reply(id, { ok: true, coverage: "coverage_gap" });
      return;
    }

    const common = {
      pov: { heading: 0, pitch: 0 },
      zoom: 1,
      addressControl: false,
      linksControl: true,
      panControl: true,
      enableCloseButton: false,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
    };

    // Show the resolved pano — never re-apply the raw click (blank / snap).
    if (!panorama || viewportId !== nextViewportId) {
      panorama = new google.maps.StreetViewPanorama(el, {
        ...common,
        pano: resolved.pano,
      });
      viewportId = nextViewportId;
    } else {
      panorama.setPano(resolved.pano);
    }

    reply(id, { ok: true, coverage: "covered" });
  }

  function destroyPanorama(): void {
    panorama = null;
    svService = null;
    viewportId = null;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== REQUEST || typeof data.id !== "string") return;

    const { id, type } = data as {
      id: string;
      type: string;
      apiKey?: string;
      viewportId?: string;
      point?: { lat: number; lng: number };
    };

    void (async () => {
      try {
        if (type === "showAnchor") {
          if (!data.apiKey || !data.viewportId || !data.point) {
            reply(id, { ok: false, error: "Invalid showAnchor request" });
            return;
          }
          await showAnchor(id, data.apiKey, data.viewportId, data.point);
          return;
        }
        if (type === "destroyPanorama") {
          destroyPanorama();
          reply(id, { ok: true });
          return;
        }
        reply(id, { ok: false, error: `Unknown bridge type: ${type}` });
      } catch (err) {
        reply(id, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });

  window.postMessage({ source: SOURCE, type: "ready" }, "*");
})();
