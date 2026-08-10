/**
 * Pure screen→lat/lng helpers for the MRE host bridge.
 * Kept free of DOM globals so vitest can pin the Coverage Gap false-positive path:
 * accepting {x,y} as lat/lng, or returning map-center and ignoring the click.
 */

import type { LatLng } from "../domain/types.js";

export type { LatLng };

export type ScreenToLatLngResult = {
  ok: boolean;
  point?: LatLng;
  error?: string;
  tried?: string[];
};

const LAT_KEYS = ["lat", "latitude", "Lat", "Latitude"] as const;
const LNG_KEYS = [
  "lng",
  "lon",
  "longitude",
  "Lng",
  "Lon",
  "Longitude",
] as const;

/** Parse only explicit geo fields — never treat x/y as lat/lng. */
export function parseLatLng(value: unknown): LatLng | null {
  if (value == null) return null;

  if (typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;

    let lat: number | null = null;
    let lng: number | null = null;
    for (const k of LAT_KEYS) {
      if (k in o && o[k] != null) {
        lat = Number(o[k]);
        break;
      }
    }
    for (const k of LNG_KEYS) {
      if (k in o && o[k] != null) {
        lng = Number(o[k]);
        break;
      }
    }
    if (lat != null && lng != null && isValidLatLng(lat, lng)) {
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
      const nested = parseLatLng(o[k]);
      if (nested) return nested;
    }

    try {
      if (
        typeof o.getLatitude === "function" &&
        typeof o.getLongitude === "function"
      ) {
        const glat = Number((o.getLatitude as () => unknown)());
        const glng = Number((o.getLongitude as () => unknown)());
        if (isValidLatLng(glat, glng)) return { lat: glat, lng: glng };
      }
    } catch {
      /* skip */
    }
  }

  if (Array.isArray(value) && value.length >= 2) {
    const a = Number(value[0]);
    const b = Number(value[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    // [lng, lat] when first component is clearly longitude
    if (Math.abs(a) > 90 && Math.abs(b) <= 90 && isValidLatLng(b, a)) {
      return { lat: b, lng: a };
    }
    // Prefer [lat, lng] when unambiguous
    if (Math.abs(a) <= 90 && isValidLatLng(a, b)) {
      return { lat: a, lng: b };
    }
  }

  return null;
}

export function deepFindLatLng(
  value: unknown,
  depth = 0,
  seen?: Set<unknown>,
): LatLng | null {
  if (depth > 6 || value == null) return null;
  const direct = parseLatLng(value);
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

export function offsetFromCenter(
  center: LatLng,
  canvas: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
  metersPerPixel: number,
): LatLng | null {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  const dxPx = clientX - (canvas.left + canvas.width / 2);
  const dyPx = clientY - (canvas.top + canvas.height / 2);
  const dEast = dxPx * metersPerPixel;
  const dNorth = -dyPx * metersPerPixel;
  const lat = center.lat + dNorth / 111_320;
  const lng =
    center.lng + dEast / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng };
}

export type MreCameraLike = {
  getLookAtPoint?: (...args: unknown[]) => unknown;
  getCustomLookAtPoint?: (...args: unknown[]) => unknown;
  getTarget?: (...args: unknown[]) => unknown;
  getScaleMetersPerPixel?: () => unknown;
};

/**
 * Resolve a map click to lat/lng.
 * Prefer screen-aware getLookAtPoint; otherwise center + meters-per-pixel offset.
 * If getLookAtPoint(x,y) returns the same point as getLookAtPoint(), the engine
 * ignored screen args — do not treat that as a click (apply mpp offset instead).
 */
export function resolveScreenToLatLng(
  camera: MreCameraLike,
  canvas: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): ScreenToLatLngResult {
  const x = clientX - canvas.left;
  const y = clientY - canvas.top;
  const pointLike = { x, y };
  const arr: [number, number] = [x, y];
  const tried: string[] = [];

  const tryFn = (
    label: string,
    fn: ((...a: unknown[]) => unknown) | undefined,
    args: unknown[],
  ): LatLng | null => {
    tried.push(label);
    if (typeof fn !== "function") return null;
    try {
      return deepFindLatLng(fn.apply(camera, args));
    } catch {
      return null;
    }
  };

  const screenAware =
    tryFn("camera.getLookAtPoint(x,y)", camera.getLookAtPoint, [x, y]) ??
    tryFn("camera.getLookAtPoint([x,y])", camera.getLookAtPoint, [arr]) ??
    tryFn("camera.getLookAtPoint({x,y})", camera.getLookAtPoint, [pointLike]);

  const center =
    tryFn("camera.getLookAtPoint()", camera.getLookAtPoint, []) ??
    tryFn("camera.getCustomLookAtPoint()", camera.getCustomLookAtPoint, []) ??
    tryFn("camera.getTarget()", camera.getTarget, []);

  const screenLooksLikeCenter =
    screenAware != null &&
    center != null &&
    nearlySame(screenAware, center);

  if (screenAware && !screenLooksLikeCenter) {
    return { ok: true, point: screenAware, tried };
  }

  if (!center) {
    return {
      ok: false,
      error: "No look-at/target center from camera",
      tried,
    };
  }

  tried.push("camera.center+mpp offset");
  let mpp = NaN;
  try {
    mpp = Number(camera.getScaleMetersPerPixel?.());
  } catch {
    mpp = NaN;
  }
  const offset = offsetFromCenter(center, canvas, clientX, clientY, mpp);
  if (offset) {
    return { ok: true, point: offset, tried };
  }

  return {
    ok: false,
    error:
      "Have map center but getScaleMetersPerPixel missing/invalid; cannot offset click",
    tried,
  };
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

function nearlySame(a: LatLng, b: LatLng, eps = 1e-9): boolean {
  return Math.abs(a.lat - b.lat) <= eps && Math.abs(a.lng - b.lng) <= eps;
}
