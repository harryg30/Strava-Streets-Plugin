import type { LatLng } from "../../domain/types.js";
import type { HostPage } from "../../ports/index.js";

/** Product host: https://www.strava.com/maps/* only. */
const ROUTE_BUILDER_PATH = /^\/maps(?:\/|$)/i;

const MRE_REQUEST = "ssp-mre-isolated";
const MRE_SOURCE = "ssp-mre-bridge";

/** Ignore Map Click when pointer moved this far (px) — treat as pan/drag. */
export const MAP_DRAG_THRESHOLD_PX = 5;

export function isRouteBuilderUrl(pathname: string): boolean {
  return ROUTE_BUILDER_PATH.test(pathname);
}

/** True when down→up movement is large enough to count as a map drag, not a click. */
export function exceedsDragThreshold(
  start: { x: number; y: number },
  end: { x: number; y: number },
  thresholdPx: number = MAP_DRAG_THRESHOLD_PX,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy >= thresholdPx * thresholdPx;
}

type MapClickListener = (point: LatLng) => void;
type MapClickMissListener = (reason: string) => void;
type RouteBuilderListener = (active: boolean) => void;

type MreResponse = {
  source: string;
  id?: string;
  type?: string;
  ok?: boolean;
  point?: LatLng;
  error?: string;
  methods?: string[];
  tried?: string[];
};

/**
 * Strava Host Page adapter.
 * Map Click → lat/lng via Leaflet (legacy) or MRE/FATMAP terrainEngine (page bridge).
 */
export class StravaHostPage implements HostPage {
  private readonly routeListeners = new Set<RouteBuilderListener>();
  private readonly mapListeners = new Set<MapClickListener>();
  private readonly missListeners = new Set<MapClickMissListener>();
  private mapRoot: HTMLElement | null = null;
  private mapAttached = false;
  private popstateHandler: (() => void) | null = null;
  private mutationObserver: MutationObserver | null = null;
  private lastActive: boolean | null = null;
  private bridgeReady: Promise<void> | null = null;
  private pending = new Map<
    string,
    { resolve: (v: MreResponse) => void; reject: (e: Error) => void }
  >();
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private reqSeq = 0;
  private pointerDown: { x: number; y: number } | null = null;
  private dragExceeded = false;

  isRouteBuilder(): boolean {
    return isRouteBuilderUrl(window.location.pathname);
  }

  onRouteBuilderChange(listener: RouteBuilderListener): () => void {
    this.routeListeners.add(listener);
    this.ensureNavigationHooks();
    const active = this.isRouteBuilder();
    this.lastActive = active;
    listener(active);
    this.syncMapAttachment(active);
    return () => {
      this.routeListeners.delete(listener);
      if (this.routeListeners.size === 0) {
        this.teardownNavigationHooks();
        this.detachMapRoot();
      }
    };
  }

  onMapClick(listener: MapClickListener): () => void {
    this.mapListeners.add(listener);
    if (this.isRouteBuilder()) {
      this.attachMapRoot();
    }
    // Do not inject the MRE bridge here — keep startup mount-safe.
    return () => {
      this.mapListeners.delete(listener);
      if (this.mapListeners.size === 0) {
        this.detachMapRoot();
      }
    };
  }

  onMapClickMiss(listener: MapClickMissListener): () => void {
    this.missListeners.add(listener);
    return () => this.missListeners.delete(listener);
  }

  private ensureNavigationHooks(): void {
    if (this.popstateHandler) return;

    this.popstateHandler = () => this.emitRouteBuilderIfChanged();
    window.addEventListener("popstate", this.popstateHandler);

    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    const notify = () => this.emitRouteBuilderIfChanged();
    history.pushState = ((...args: Parameters<History["pushState"]>) => {
      origPush(...args);
      notify();
    }) as History["pushState"];
    history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
      origReplace(...args);
      notify();
    }) as History["replaceState"];

    this.mutationObserver = new MutationObserver(() => {
      this.emitRouteBuilderIfChanged();
      if (this.isRouteBuilder() && this.mapListeners.size > 0) {
        // Allow re-attach if canvas appeared after a failed attempt.
        if (!this.mapAttached) this.attachMapRoot();
      }
    });
    this.mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  private teardownNavigationHooks(): void {
    if (this.popstateHandler) {
      window.removeEventListener("popstate", this.popstateHandler);
      this.popstateHandler = null;
    }
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
  }

  private emitRouteBuilderIfChanged(): void {
    const active = this.isRouteBuilder();
    if (active === this.lastActive) return;
    this.lastActive = active;
    this.syncMapAttachment(active);
    for (const l of this.routeListeners) l(active);
  }

  private syncMapAttachment(active: boolean): void {
    if (active && this.mapListeners.size > 0) {
      this.attachMapRoot();
    } else if (!active) {
      this.detachMapRoot();
    }
  }

  private attachMapRoot(): void {
    if (this.mapAttached) return;
    const root = findMapRoot();
    if (!root) return;
    this.mapRoot = root;
    root.addEventListener("pointerdown", this.onMapPointerDown, true);
    root.addEventListener("pointermove", this.onMapPointerMove, true);
    root.addEventListener("click", this.onMapDomClick, true);
    this.mapAttached = true;
    // Warm the bridge; clicks still resolve via screenToLatLng if this fails.
    void this.ensureMreBridge().catch(() => {
      /* miss path still reports via DOM click */
    });
  }

  private detachMapRoot(): void {
    if (!this.mapAttached || !this.mapRoot) return;
    this.mapRoot.removeEventListener("pointerdown", this.onMapPointerDown, true);
    this.mapRoot.removeEventListener("pointermove", this.onMapPointerMove, true);
    this.mapRoot.removeEventListener("click", this.onMapDomClick, true);
    this.mapRoot = null;
    this.mapAttached = false;
    this.pointerDown = null;
    this.dragExceeded = false;
  }

  private onMapPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDown = { x: event.clientX, y: event.clientY };
    this.dragExceeded = false;
  };

  private onMapPointerMove = (event: PointerEvent): void => {
    if (!this.pointerDown || this.dragExceeded) return;
    if (
      exceedsDragThreshold(this.pointerDown, {
        x: event.clientX,
        y: event.clientY,
      })
    ) {
      this.dragExceeded = true;
    }
  };

  private onMapDomClick = (event: MouseEvent): void => {
    if (this.mapListeners.size === 0) return;

    const start = this.pointerDown;
    const dragged =
      this.dragExceeded ||
      (start != null &&
        exceedsDragThreshold(start, { x: event.clientX, y: event.clientY }));

    this.pointerDown = null;
    this.dragExceeded = false;

    if (dragged) return;

    void this.resolveClick(event);
  };

  private async resolveClick(event: MouseEvent): Promise<void> {
    const leafletPoint = latLngFromLeaflet(event, this.mapRoot);
    if (leafletPoint) {
      for (const l of this.mapListeners) l(leafletPoint);
      return;
    }

    try {
      await this.ensureMreBridge();
      const response = await this.callMre({
        type: "screenToLatLng",
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (response.ok && response.point) {
        for (const l of this.mapListeners) l(response.point);
        return;
      }
      const methods = response.methods ?? [];
      const tried = response.tried ?? [];
      const payload = {
        error: response.error ?? "Could not read map coordinates.",
        methods,
        tried,
      };
      // DevTools-friendly copy target (right-click → Copy object / expand).
      console.info("[Strava Streets] MRE screen→lat/lng miss", payload);
      console.info(
        "[Strava Streets] MRE methods (copy):\n" + methods.join("\n"),
      );
      this.emitMiss(
        `${payload.error}\n\nMethods (also in console as "[Strava Streets]"):\n${methods.join("\n") || "(none)"}`,
      );
    } catch (err) {
      this.emitMiss(
        err instanceof Error ? err.message : "Map coordinate bridge failed",
      );
    }
  }

  private emitMiss(reason: string): void {
    for (const l of this.missListeners) l(reason);
  }

  private ensureMessageHandler(): void {
    if (this.messageHandler) return;
    this.messageHandler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as MreResponse | null;
      if (!data || data.source !== MRE_SOURCE) return;

      if (data.type === "ready") return;
      if (data.id && this.pending.has(data.id)) {
        const entry = this.pending.get(data.id)!;
        this.pending.delete(data.id);
        entry.resolve(data);
      }
    };
    window.addEventListener("message", this.messageHandler);
  }

  private ensureMreBridge(): Promise<void> {
    if (this.bridgeReady) return this.bridgeReady;
    this.ensureMessageHandler();

    this.bridgeReady = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onReady);
        window.clearTimeout(timer);
        if (err) {
          this.bridgeReady = null;
          reject(err);
        } else {
          resolve();
        }
      };

      const onReady = (event: MessageEvent) => {
        const data = event.data as MreResponse | null;
        if (event.source !== window) return;
        if (!data || data.source !== MRE_SOURCE || data.type !== "ready") return;
        finish();
      };
      window.addEventListener("message", onReady);

      try {
        if (document.getElementById("ssp-host-mre-bridge")) {
          finish();
          return;
        }

        const script = document.createElement("script");
        script.id = "ssp-host-mre-bridge";
        script.src = chrome.runtime.getURL("host-mre-bridge.js");
        script.onerror = () =>
          finish(new Error("Failed to inject MRE host bridge"));
        (document.head || document.documentElement).appendChild(script);
      } catch (err) {
        finish(
          err instanceof Error
            ? err
            : new Error("MRE host bridge inject threw"),
        );
        return;
      }

      const timer = window.setTimeout(() => {
        finish(new Error("Timed out waiting for MRE host bridge"));
      }, 5000);
    });

    return this.bridgeReady;
  }

  private callMre(payload: Record<string, unknown>): Promise<MreResponse> {
    const id = `mre-${++this.reqSeq}-${Date.now()}`;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("MRE bridge timed out"));
      }, 8000);
      this.pending.set(id, {
        resolve: (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          window.clearTimeout(timer);
          reject(err);
        },
      });
      window.postMessage({ source: MRE_REQUEST, id, ...payload }, "*");
    });
  }
}

function findMapRoot(): HTMLElement | null {
  const selectors = [
    'canvas[data-testid="mre-canvas"]',
    "#map-canvas",
    "#map_canvas",
    ".map-container",
    "[data-testid='route-builder-map']",
    ".leaflet-container",
    "#map",
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement) return el;
  }
  return null;
}

function latLngFromLeaflet(
  event: MouseEvent,
  mapRoot: HTMLElement | null,
): LatLng | null {
  const leafletMap = findLeafletMap(mapRoot);
  if (leafletMap && typeof leafletMap.mouseEventToLatLng === "function") {
    try {
      const ll = leafletMap.mouseEventToLatLng(event);
      if (ll && typeof ll.lat === "number" && typeof ll.lng === "number") {
        return { lat: ll.lat, lng: ll.lng };
      }
    } catch {
      // fall through
    }
  }
  return null;
}

type LeafletMapLike = {
  mouseEventToLatLng: (e: MouseEvent) => { lat: number; lng: number };
};

function findLeafletMap(mapRoot: HTMLElement | null): LeafletMapLike | null {
  if (!mapRoot) return null;
  const anyRoot = mapRoot as HTMLElement & { _leaflet_map?: LeafletMapLike };
  if (anyRoot._leaflet_map) return anyRoot._leaflet_map;

  const leafletEl = mapRoot.classList.contains("leaflet-container")
    ? mapRoot
    : mapRoot.querySelector(".leaflet-container");
  if (leafletEl) {
    const keyed = Object.keys(leafletEl).find((k) => k.startsWith("leaflet"));
    if (keyed) {
      const val = (leafletEl as unknown as Record<string, unknown>)[keyed];
      if (
        val &&
        typeof val === "object" &&
        "mouseEventToLatLng" in (val as object)
      ) {
        return val as LeafletMapLike;
      }
    }
  }
  return null;
}
