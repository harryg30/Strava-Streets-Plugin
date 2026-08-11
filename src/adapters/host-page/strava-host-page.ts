import type { LatLng } from "../../domain/types.js";
import type { MapClickButton } from "../../domain/types.js";
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

export type PointerGestureState = {
  pointerDown: { x: number; y: number; button: MapClickButton } | null;
  dragExceeded: boolean;
};

/**
 * Clears pointer tracking after a click/contextmenu.
 * Returns whether the gesture was a drag (caller should ignore the click).
 */
export function finishPointerGestureState(
  state: PointerGestureState,
  clientX: number,
  clientY: number,
  options?: { requireButton?: MapClickButton },
): { dragged: boolean; next: PointerGestureState } {
  const start = state.pointerDown;
  const buttonOk =
    options?.requireButton === undefined ||
    start?.button === options.requireButton;
  const dragged =
    state.dragExceeded ||
    (start != null &&
      buttonOk &&
      exceedsDragThreshold(start, { x: clientX, y: clientY }));
  return {
    dragged,
    next: { pointerDown: null, dragExceeded: false },
  };
}

type MapClickListener = (point: LatLng, button: MapClickButton) => void;
type MapClickMissListener = (reason: string) => void;
type RouteBuilderListener = (active: boolean) => void;

type MreResponse = {
  source: string;
  id?: string;
  type?: string;
  ok?: boolean;
  point?: LatLng;
  clientX?: number;
  clientY?: number;
  error?: string;
  methods?: string[];
  tried?: string[];
};

const ANCHOR_PEG_ID = "ssp-anchor-peg";

/**
 * Strava Host Page adapter.
 * Map Click (left or right) → lat/lng via Leaflet or MRE/FATMAP terrainEngine.
 * Never uses camera.addInteractionListener (breaks Route Builder tools).
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
  private pointerDown: { x: number; y: number; button: MapClickButton } | null =
    null;
  private dragExceeded = false;
  private mapClickButton: MapClickButton = "right";
  private anchorPoint: LatLng | null = null;
  /** Screen position of the Map Click that produced the current Anchor (MRE peg). */
  private lastClickScreen: {
    point: LatLng;
    clientX: number;
    clientY: number;
  } | null = null;
  private pegEl: HTMLElement | null = null;
  private pegMode: "fixed" | null = null;
  private pegTrackUntil = 0;
  private pegTrackRaf: number | null = null;

  isRouteBuilder(): boolean {
    return isRouteBuilderUrl(window.location.pathname);
  }

  setMapClickButton(button: MapClickButton): void {
    this.mapClickButton = button;
  }

  setAnchorMarker(point: LatLng | null): void {
    this.anchorPoint = point ? { ...point } : null;
    if (!this.anchorPoint) {
      this.lastClickScreen = null;
      this.removePeg();
      return;
    }
    // Place immediately from the Map Click's screen coords — do not wait on
    // MRE lat→screen (often missing mpp; awaiting it left the peg invisible).
    if (this.lastClickScreen) {
      this.placeFixedPeg(
        this.lastClickScreen.clientX,
        this.lastClickScreen.clientY,
      );
    } else {
      console.warn(
        "[Strava Streets] Anchor peg: no Map Click screen coords; placing at viewport center",
      );
      this.placeFixedPeg(window.innerWidth / 2, window.innerHeight / 2);
    }
    void this.refinePegFromMre();
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
    root.addEventListener("contextmenu", this.onMapContextMenu, true);
    this.mapAttached = true;
    this.wirePegRefresh(root);
    if (this.anchorPoint && this.lastClickScreen) {
      this.placeFixedPeg(
        this.lastClickScreen.clientX,
        this.lastClickScreen.clientY,
      );
    }
    void this.ensureMreBridge().catch(() => {
      /* miss path still reports via DOM click */
    });
  }

  private detachMapRoot(): void {
    if (!this.mapAttached || !this.mapRoot) return;
    this.unwirePegRefresh();
    this.mapRoot.removeEventListener("pointerdown", this.onMapPointerDown, true);
    this.mapRoot.removeEventListener("pointermove", this.onMapPointerMove, true);
    this.mapRoot.removeEventListener("click", this.onMapDomClick, true);
    this.mapRoot.removeEventListener("contextmenu", this.onMapContextMenu, true);
    this.mapRoot = null;
    this.mapAttached = false;
    this.pointerDown = null;
    this.dragExceeded = false;
    this.removePeg();
  }

  private onMapPointerDown = (event: PointerEvent): void => {
    const button = pointerButtonToMapClick(event.button);
    if (!button) return;
    this.pointerDown = { x: event.clientX, y: event.clientY, button };
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
    if (this.finishPointerGesture(event.clientX, event.clientY)) return;
    void this.resolveClick(event, "left");
  };

  private onMapContextMenu = (event: MouseEvent): void => {
    if (this.mapListeners.size === 0) return;
    // Only consume right-click when it is the active Map Click Button.
    // Always clear gesture state so a discarded right-click cannot poison
    // the next left click as a drag (e.g. Map Click Button = left).
    if (this.mapClickButton !== "right") {
      this.pointerDown = null;
      this.dragExceeded = false;
      return;
    }

    if (
      this.finishPointerGesture(event.clientX, event.clientY, {
        requireButton: "right",
      })
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void this.resolveClick(event, "right");
  };

  /** Clears pointer tracking; returns true when the gesture was a drag (ignore click). */
  private finishPointerGesture(
    clientX: number,
    clientY: number,
    options?: { requireButton?: MapClickButton },
  ): boolean {
    const { dragged, next } = finishPointerGestureState(
      {
        pointerDown: this.pointerDown,
        dragExceeded: this.dragExceeded,
      },
      clientX,
      clientY,
      options,
    );
    this.pointerDown = next.pointerDown;
    this.dragExceeded = next.dragExceeded;
    return dragged;
  }

  private async resolveClick(
    event: MouseEvent,
    button: MapClickButton,
  ): Promise<void> {
    const leafletPoint = latLngFromLeaflet(event, this.mapRoot);
    if (leafletPoint) {
      this.rememberClickScreen(leafletPoint, event.clientX, event.clientY);
      for (const l of this.mapListeners) l(leafletPoint, button);
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
        this.rememberClickScreen(
          response.point,
          event.clientX,
          event.clientY,
        );
        for (const l of this.mapListeners) l(response.point, button);
        return;
      }
      const methods = response.methods ?? [];
      const tried = response.tried ?? [];
      const payload = {
        error: response.error ?? "Could not read map coordinates.",
        methods,
        tried,
      };
      console.info("[Strava Streets] MRE screen→lat/lng miss", payload);
      console.info(
        "[Strava Streets] MRE methods (copy):\n" + methods.join("\n"),
      );
      this.emitMiss(payload.error);
    } catch (err) {
      this.emitMiss(
        err instanceof Error ? err.message : "Map coordinate bridge failed",
      );
    }
  }

  private rememberClickScreen(
    point: LatLng,
    clientX: number,
    clientY: number,
  ): void {
    this.lastClickScreen = { point: { ...point }, clientX, clientY };
  }

  private emitMiss(reason: string): void {
    for (const l of this.missListeners) l(reason);
  }

  private wirePegRefresh(root: HTMLElement): void {
    root.addEventListener("wheel", this.onPegMapInteraction, {
      passive: true,
      capture: true,
    });
    root.addEventListener("pointerdown", this.onPegMapInteraction, true);
    root.addEventListener("pointermove", this.onPegPointerMove, true);
    root.addEventListener("pointerup", this.onPegMapInteraction, true);
    window.addEventListener("wheel", this.onPegMapInteraction, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", this.onPegMapInteraction);
  }

  private unwirePegRefresh(): void {
    if (this.mapRoot) {
      this.mapRoot.removeEventListener("wheel", this.onPegMapInteraction, true);
      this.mapRoot.removeEventListener(
        "pointerdown",
        this.onPegMapInteraction,
        true,
      );
      this.mapRoot.removeEventListener(
        "pointermove",
        this.onPegPointerMove,
        true,
      );
      this.mapRoot.removeEventListener(
        "pointerup",
        this.onPegMapInteraction,
        true,
      );
    }
    window.removeEventListener("wheel", this.onPegMapInteraction, true);
    window.removeEventListener("resize", this.onPegMapInteraction);
    this.stopPegTracking();
  }

  private onPegMapInteraction = (): void => {
    this.startPegTracking(600);
  };

  private onPegPointerMove = (event: PointerEvent): void => {
    // Pan/drag while a button is down — keep peg glued during map drag.
    if (event.buttons === 0) return;
    this.startPegTracking(400);
  };

  /** Reproject Anchor→screen for a burst of frames (zoom animations). */
  private startPegTracking(ms: number): void {
    if (!this.anchorPoint) return;
    const until = performance.now() + ms;
    if (until > this.pegTrackUntil) this.pegTrackUntil = until;
    if (this.pegTrackRaf != null) return;
    const tick = () => {
      this.pegTrackRaf = null;
      void this.refinePegFromMre();
      if (performance.now() < this.pegTrackUntil && this.anchorPoint) {
        this.pegTrackRaf = requestAnimationFrame(tick);
      }
    };
    this.pegTrackRaf = requestAnimationFrame(tick);
  }

  private stopPegTracking(): void {
    this.pegTrackUntil = 0;
    if (this.pegTrackRaf != null) {
      cancelAnimationFrame(this.pegTrackRaf);
      this.pegTrackRaf = null;
    }
  }

  private removePeg(): void {
    this.stopPegTracking();
    if (this.pegEl) {
      this.pegEl.remove();
      this.pegEl = null;
    }
    this.pegMode = null;
  }

  private ensurePegEl(mode: "fixed"): HTMLElement {
    if (this.pegEl && this.pegMode === mode) return this.pegEl;
    this.removePeg();
    const el = document.createElement("div");
    el.id = ANCHOR_PEG_ID;
    el.className = "ssp-anchor-peg ssp-anchor-peg--fixed";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<div class="ssp-anchor-peg__pin"></div>`;
    // Inline styles so the peg is visible even if content.css failed to apply.
    el.style.cssText = [
      "position:fixed",
      "z-index:2147483645",
      "width:20px",
      "height:28px",
      "margin-left:-10px",
      "margin-top:-28px",
      "pointer-events:none",
      "display:block",
    ].join(";");
    const pin = el.firstElementChild as HTMLElement | null;
    if (pin) {
      pin.style.cssText = [
        "position:absolute",
        "left:1px",
        "top:0",
        "width:18px",
        "height:18px",
        "border-radius:50% 50% 50% 0",
        "background:#fc4c02",
        "border:2px solid #fff",
        "box-shadow:0 1px 4px rgba(0,0,0,0.45)",
        "transform:rotate(-45deg)",
        "box-sizing:border-box",
      ].join(";");
    }
    this.pegEl = el;
    this.pegMode = mode;
    return el;
  }

  private placeFixedPeg(clientX: number, clientY: number): void {
    const el = this.ensurePegEl("fixed");
    // body beats some full-bleed canvas stacking quirks vs documentElement
    const parent = document.body ?? document.documentElement;
    if (el.parentElement !== parent) {
      parent.appendChild(el);
    }
    el.style.left = `${Math.round(clientX)}px`;
    el.style.top = `${Math.round(clientY)}px`;
    el.hidden = false;
    el.style.display = "block";
  }

  /** Try MRE lat→screen to keep the peg glued on pan; never required for first paint. */
  private async refinePegFromMre(): Promise<void> {
    const point = this.anchorPoint;
    if (!point) return;

    const fromBridge = await this.tryMreLatLngToScreen(point);
    if (fromBridge) {
      this.placeFixedPeg(fromBridge.clientX, fromBridge.clientY);
    }
  }

  private async tryMreLatLngToScreen(
    point: LatLng,
  ): Promise<{ clientX: number; clientY: number } | null> {
    try {
      await this.ensureMreBridge();
      const response = await this.callMre({
        type: "latLngToScreen",
        lat: point.lat,
        lng: point.lng,
      });
      if (
        response.ok &&
        typeof response.clientX === "number" &&
        typeof response.clientY === "number"
      ) {
        return { clientX: response.clientX, clientY: response.clientY };
      }
    } catch {
      /* fall through */
    }
    return null;
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
      // Must declare before finish() — early-return path calls finish when the
      // bridge <script> already exists (e.g. after extension reload on same tab).
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("message", onReady);
        if (timer !== undefined) window.clearTimeout(timer);
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

      timer = window.setTimeout(() => {
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

function pointerButtonToMapClick(button: number): MapClickButton | null {
  if (button === 0) return "left";
  if (button === 2) return "right";
  return null;
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
  latLngToContainerPoint?: (ll: { lat: number; lng: number }) => {
    x: number;
    y: number;
  };
  getContainer?: () => HTMLElement;
  on?: (types: string, fn: () => void) => void;
  off?: (types: string, fn: () => void) => void;
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
