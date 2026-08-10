/**
 * Page-world bridge: Strava MRE / FATMAP terrainEngine → lat/lng.
 * Injected via chrome.runtime.getURL — no chrome.* APIs here.
 *
 * Live engine surface (from probe) exposes camera helpers like
 * getLookAtPoint / getTarget / getScaleMetersPerPixel / getScreenPosition /
 * addInteractionListener — not a classic unproject().
 */
(() => {
  const SOURCE = "ssp-mre-bridge";
  const REQUEST = "ssp-mre-isolated";

  let interactionHooked = false;

  function reply(id: string, payload: Record<string, unknown>): void {
    window.postMessage({ source: SOURCE, id, ...payload }, "*");
  }

  function emitInteraction(point: { lat: number; lng: number }): void {
    window.postMessage(
      { source: SOURCE, type: "mapInteraction", point },
      "*",
    );
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
        if (cam && typeof cam === "object") return cam as Record<string, unknown>;
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

  function asLatLng(value: unknown): { lat: number; lng: number } | null {
    if (value == null) return null;

    if (typeof value === "object" && !Array.isArray(value)) {
      const o = value as Record<string, unknown>;
      // Common Fatmap / geo structs
      const lat = Number(
        o.lat ?? o.latitude ?? o.Lat ?? o.Latitude ?? o.y ?? o.Y,
      );
      const lng = Number(
        o.lng ??
          o.lon ??
          o.longitude ??
          o.Lng ??
          o.Lon ??
          o.Longitude ??
          o.x ??
          o.X,
      );
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180
      ) {
        return { lat, lng };
      }
      for (const k of [
        "latLng",
        "lngLat",
        "coordinate",
        "coords",
        "position",
        "ll",
        "point",
        "lookAt",
        "target",
        "location",
        "worldPoint",
        "groundPoint",
      ]) {
        const nested = asLatLng(o[k]);
        if (nested) return nested;
      }
      // Getter-style
      try {
        if (typeof o.getLatitude === "function" && typeof o.getLongitude === "function") {
          const glat = Number((o.getLatitude as () => unknown)());
          const glng = Number((o.getLongitude as () => unknown)());
          if (
            Number.isFinite(glat) &&
            Number.isFinite(glng) &&
            Math.abs(glat) <= 90 &&
            Math.abs(glng) <= 180
          ) {
            return { lat: glat, lng: glng };
          }
        }
      } catch {
        /* skip */
      }
    }

    if (Array.isArray(value) && value.length >= 2) {
      const a = Number(value[0]);
      const b = Number(value[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (Math.abs(a) > 90 && Math.abs(b) <= 90) return { lat: b, lng: a };
      if (Math.abs(b) > 90 && Math.abs(a) <= 90) return { lat: a, lng: b };
      if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return { lat: b, lng: a };
    }

    return null;
  }

  function deepFindLatLng(
    value: unknown,
    depth = 0,
    seen?: Set<unknown>,
  ): { lat: number; lng: number } | null {
    if (depth > 6 || value == null) return null;
    const direct = asLatLng(value);
    if (direct) return direct;
    if (typeof value !== "object") return null;
    const tracker = seen ?? new Set();
    if (tracker.has(value)) return null;
    tracker.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = deepFindLatLng(item, depth + 1, tracker);
        if (found) return found;
      }
      return null;
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      const found = deepFindLatLng(v, depth + 1, tracker);
      if (found) return found;
    }
    return null;
  }

  function tryCall(
    target: unknown,
    name: string,
    args: unknown[],
  ): { lat: number; lng: number } | null {
    if (!target || typeof target !== "object") return null;
    const fn = (target as Record<string, unknown>)[name];
    if (typeof fn !== "function") return null;
    try {
      const result = (fn as (...a: unknown[]) => unknown).apply(target, args);
      return deepFindLatLng(result);
    } catch {
      return null;
    }
  }

  function offsetFromCenter(
    camera: Record<string, unknown>,
    canvas: HTMLElement,
    clientX: number,
    clientY: number,
    center: { lat: number; lng: number },
  ): { lat: number; lng: number } | null {
    try {
      const mppRaw =
        typeof camera.getScaleMetersPerPixel === "function"
          ? (camera.getScaleMetersPerPixel as () => unknown)()
          : null;
      const mpp = Number(mppRaw);
      if (!Number.isFinite(mpp) || mpp <= 0) return null;

      const rect = canvas.getBoundingClientRect();
      const dxPx = clientX - (rect.left + rect.width / 2);
      const dyPx = clientY - (rect.top + rect.height / 2);
      const dEast = dxPx * mpp;
      const dNorth = -dyPx * mpp;
      const lat =
        center.lat + dNorth / 111_320;
      const lng =
        center.lng +
        dEast / (111_320 * Math.cos((center.lat * Math.PI) / 180));
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180
      ) {
        return { lat, lng };
      }
    } catch {
      return null;
    }
    return null;
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

    ensureInteractionHook(camera);

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const pointLike = { x, y };
    const arr: [number, number] = [x, y];

    const tried: string[] = [];
    const attempts: Array<{
      label: string;
      run: () => { lat: number; lng: number } | null;
    }> = [
      {
        label: "camera.getLookAtPoint(x,y)",
        run: () => tryCall(camera, "getLookAtPoint", [x, y]),
      },
      {
        label: "camera.getLookAtPoint([x,y])",
        run: () => tryCall(camera, "getLookAtPoint", [arr]),
      },
      {
        label: "camera.getLookAtPoint({x,y})",
        run: () => tryCall(camera, "getLookAtPoint", [pointLike]),
      },
      {
        label: "camera.getLookAtPoint()",
        run: () => tryCall(camera, "getLookAtPoint", []),
      },
      {
        label: "camera.getCustomLookAtPoint()",
        run: () => tryCall(camera, "getCustomLookAtPoint", []),
      },
      {
        label: "camera.getTarget()",
        run: () => tryCall(camera, "getTarget", []),
      },
      {
        label: "camera.getLookAtPoint()+mpp offset",
        run: () => {
          const center =
            tryCall(camera, "getLookAtPoint", []) ??
            tryCall(camera, "getCustomLookAtPoint", []) ??
            tryCall(camera, "getTarget", []);
          if (!center) return null;
          return offsetFromCenter(camera, canvas, clientX, clientY, center);
        },
      },
    ];

    for (const attempt of attempts) {
      tried.push(attempt.label);
      const point = attempt.run();
      if (point) {
        return { ok: true, point, tried };
      }
    }

    const methods = [
      ...listFns(engine, "engine."),
      ...listFns(camera, "camera."),
    ];

    return {
      ok: false,
      error:
        "No screen→lat/lng via getLookAtPoint/getTarget/mpp offset; see camera methods",
      methods,
      tried,
    };
  }

  function ensureInteractionHook(camera: Record<string, unknown>): void {
    if (interactionHooked) return;
    if (typeof camera.addInteractionListener !== "function") return;
    try {
      const handler = (...args: unknown[]) => {
        console.info("[Strava Streets] MRE interaction raw", args);
        for (const arg of args) {
          const point = deepFindLatLng(arg);
          if (point) {
            emitInteraction(point);
            return;
          }
        }
      };
      (camera.addInteractionListener as (...a: unknown[]) => unknown)(handler);
      interactionHooked = true;
      console.info("[Strava Streets] MRE addInteractionListener hooked");
    } catch (err) {
      console.warn("[Strava Streets] MRE interaction hook failed", err);
    }
  }

  function bootHook(): void {
    const engine = getTerrainEngine();
    if (!engine) return;
    const camera = getCamera(engine);
    if (camera) ensureInteractionHook(camera);
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
    };

    try {
      if (type === "probe") {
        const engine = getTerrainEngine();
        const camera = engine ? getCamera(engine) : null;
        if (camera) ensureInteractionHook(camera);
        reply(id, {
          ok: !!engine,
          hasCanvas: !!document.querySelector('canvas[data-testid="mre-canvas"]'),
          methods: [
            ...(engine ? listFns(engine, "engine.") : []),
            ...(camera ? listFns(camera, "camera.") : []),
          ],
          error: engine ? undefined : "terrainEngine not found",
        });
        return;
      }
      if (type === "screenToLatLng") {
        if (typeof data.clientX !== "number" || typeof data.clientY !== "number") {
          reply(id, { ok: false, error: "clientX/clientY required" });
          return;
        }
        reply(id, screenToLatLng(data.clientX, data.clientY));
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

  // Retry hook briefly — canvas/engine may appear after inject.
  bootHook();
  let tries = 0;
  const bootTimer = window.setInterval(() => {
    tries += 1;
    bootHook();
    if (interactionHooked || tries > 40) window.clearInterval(bootTimer);
  }, 500);

  window.postMessage({ source: SOURCE, type: "ready" }, "*");
})();
