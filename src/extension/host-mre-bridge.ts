/**
 * Page-world bridge: Strava MRE / FATMAP terrainEngine → lat/lng.
 * Injected via chrome.runtime.getURL — no chrome.* APIs here.
 *
 * Do NOT call camera.addInteractionListener — that registration knocks out
 * Route Builder drag / zoom / add-point (see scripts/repro-map-tools-blocked.mjs).
 *
 * Screen→lat/lng: never treat {x,y} as geo; prefer center + mpp offset over
 * bare map-center (false "No Street View at this point").
 */
import {
  resolveLatLngToScreen,
  resolveScreenToLatLng,
  type MreCameraLike,
} from "./mre-screen-to-latlng.js";

(() => {
  const SOURCE = "ssp-mre-bridge";
  const REQUEST = "ssp-mre-isolated";

  function reply(id: string, payload: Record<string, unknown>): void {
    window.postMessage({ source: SOURCE, id, ...payload }, "*");
  }

  function getTerrainEngine(): unknown | null {
    const canvas = document.querySelector(
      'canvas[data-testid="mre-canvas"]',
    ) as HTMLElement | null;
    if (!canvas) return null;
    const fiberKey = Object.keys(canvas).find((k) => k.startsWith("__react"));
    if (!fiberKey) return null;
    let node: {
      return?: unknown;
      memoizedProps?: { value?: { terrainEngine?: unknown } };
    } | null = (canvas as unknown as Record<string, unknown>)[
      fiberKey
    ] as typeof node;
    for (let i = 0; i < 60; i++) {
      node = (node?.return ?? null) as typeof node;
      if (!node) break;
      const engine = node?.memoizedProps?.value?.terrainEngine;
      if (engine) return engine;
    }
    return null;
  }

  function getCamera(engine: unknown): Record<string, unknown> | null {
    if (!engine || typeof engine !== "object") return null;
    const eng = engine as Record<string, unknown>;
    try {
      if (typeof eng.getCamera === "function") {
        const cam = (eng.getCamera as () => unknown)();
        if (cam && typeof cam === "object") {
          return cam as Record<string, unknown>;
        }
      }
    } catch {
      /* skip */
    }
    if (eng.camera && typeof eng.camera === "object") {
      return eng.camera as Record<string, unknown>;
    }
    return null;
  }

  function listFns(obj: unknown, prefix: string): string[] {
    if (!obj || typeof obj !== "object") return [];
    const out: string[] = [];
    const seen = new Set<string>();
    let proto: object | null = obj as object;
    let guard = 0;
    while (proto && proto !== Object.prototype && guard++ < 6) {
      for (const k of Object.getOwnPropertyNames(proto)) {
        const key = `${prefix}${k}`;
        if (seen.has(key)) continue;
        try {
          if (typeof (obj as Record<string, unknown>)[k] === "function") {
            seen.add(key);
            out.push(key);
          }
        } catch {
          /* skip */
        }
      }
      proto = Object.getPrototypeOf(proto);
    }
    return out;
  }

  function asCameraLike(camera: Record<string, unknown>): MreCameraLike {
    return {
      getLookAtPoint:
        typeof camera.getLookAtPoint === "function"
          ? (camera.getLookAtPoint as MreCameraLike["getLookAtPoint"])
          : undefined,
      getCustomLookAtPoint:
        typeof camera.getCustomLookAtPoint === "function"
          ? (camera.getCustomLookAtPoint as MreCameraLike["getCustomLookAtPoint"])
          : undefined,
      getTarget:
        typeof camera.getTarget === "function"
          ? (camera.getTarget as MreCameraLike["getTarget"])
          : undefined,
      getScaleMetersPerPixel:
        typeof camera.getScaleMetersPerPixel === "function"
          ? (camera.getScaleMetersPerPixel as MreCameraLike["getScaleMetersPerPixel"])
          : undefined,
    };
  }

  function screenToLatLng(
    clientX: number,
    clientY: number,
  ): {
    ok: boolean;
    point?: { lat: number; lng: number };
    error?: string;
    methods?: string[];
    tried?: string[];
  } {
    const canvas = document.querySelector(
      'canvas[data-testid="mre-canvas"]',
    ) as HTMLElement | null;
    if (!canvas) {
      return { ok: false, error: "No mre-canvas on page" };
    }
    const engine = getTerrainEngine();
    if (!engine) {
      return { ok: false, error: "terrainEngine not found on React tree" };
    }
    const camera = getCamera(engine);
    if (!camera) {
      return { ok: false, error: "getCamera() returned nothing" };
    }

    const rect = canvas.getBoundingClientRect();
    const resolved = resolveScreenToLatLng(
      asCameraLike(camera),
      {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      clientX,
      clientY,
    );

    if (resolved.ok && resolved.point) {
      console.info("[Strava Streets] Map Click →", resolved.point, resolved.tried);
      return resolved;
    }

    const methods = [
      ...listFns(engine, "engine."),
      ...listFns(camera, "camera."),
    ];
    return {
      ok: false,
      error:
        resolved.error ??
        "No screen→lat/lng via getLookAtPoint/getTarget/mpp offset; see camera methods",
      methods,
      tried: resolved.tried,
    };
  }

  function latLngToScreen(
    lat: number,
    lng: number,
  ): {
    ok: boolean;
    clientX?: number;
    clientY?: number;
    error?: string;
    tried?: string[];
  } {
    const canvas = document.querySelector(
      'canvas[data-testid="mre-canvas"]',
    ) as HTMLElement | null;
    if (!canvas) {
      return { ok: false, error: "No mre-canvas on page" };
    }
    const engine = getTerrainEngine();
    if (!engine) {
      return { ok: false, error: "terrainEngine not found on React tree" };
    }
    const camera = getCamera(engine);
    if (!camera) {
      return { ok: false, error: "getCamera() returned nothing" };
    }
    const rect = canvas.getBoundingClientRect();
    return resolveLatLngToScreen(
      asCameraLike(camera),
      {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      { lat, lng },
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== REQUEST || typeof data.id !== "string") return;

    const { id, type } = data as {
      id: string;
      type: string;
      clientX?: number;
      clientY?: number;
      lat?: number;
      lng?: number;
    };

    try {
      if (type === "probe") {
        const engine = getTerrainEngine();
        const camera = engine ? getCamera(engine) : null;
        reply(id, {
          ok: !!engine,
          hasCanvas: !!document.querySelector(
            'canvas[data-testid="mre-canvas"]',
          ),
          methods: [
            ...(engine ? listFns(engine, "engine.") : []),
            ...(camera ? listFns(camera, "camera.") : []),
          ],
          error: engine ? undefined : "terrainEngine not found",
        });
        return;
      }
      if (type === "screenToLatLng") {
        if (
          typeof data.clientX !== "number" ||
          typeof data.clientY !== "number"
        ) {
          reply(id, { ok: false, error: "clientX/clientY required" });
          return;
        }
        reply(id, screenToLatLng(data.clientX, data.clientY));
        return;
      }
      if (type === "latLngToScreen") {
        if (typeof data.lat !== "number" || typeof data.lng !== "number") {
          reply(id, { ok: false, error: "lat/lng required" });
          return;
        }
        reply(id, latLngToScreen(data.lat, data.lng));
        return;
      }
      reply(id, { ok: false, error: `Unknown type: ${type}` });
    } catch (err) {
      reply(id, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  window.postMessage({ source: SOURCE, type: "ready" }, "*");
})();
