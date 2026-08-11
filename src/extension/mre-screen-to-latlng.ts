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

/** Inverse of offsetFromCenter — Anchor peg placement on MRE maps. */
export function offsetToScreen(
  center: LatLng,
  canvas: { left: number; top: number; width: number; height: number },
  point: LatLng,
  metersPerPixel: number,
): { clientX: number; clientY: number } | null {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  if (!Number.isFinite(cosLat) || Math.abs(cosLat) < 1e-6) return null;
  const dNorth = (point.lat - center.lat) * 111_320;
  const dEast = (point.lng - center.lng) * (111_320 * cosLat);
  const dxPx = dEast / metersPerPixel;
  const dyPx = -dNorth / metersPerPixel;
  return {
    clientX: canvas.left + canvas.width / 2 + dxPx,
    clientY: canvas.top + canvas.height / 2 + dyPx,
  };
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

export type LatLngToScreenResult = {
  ok: boolean;
  clientX?: number;
  clientY?: number;
  error?: string;
  tried?: string[];
};

/** Place a geo point on screen using map center + meters-per-pixel (MRE peg). */
export function resolveLatLngToScreen(
  camera: MreCameraLike,
  canvas: { left: number; top: number; width: number; height: number },
  point: LatLng,
): LatLngToScreenResult {
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

  const center =
    tryFn("camera.getLookAtPoint()", camera.getLookAtPoint, []) ??
    tryFn("camera.getCustomLookAtPoint()", camera.getCustomLookAtPoint, []) ??
    tryFn("camera.getTarget()", camera.getTarget, []);

  if (!center) {
    return { ok: false, error: "No look-at/target center from camera", tried };
  }

  tried.push("camera.center+mpp offset inverse");
  let mpp = NaN;
  try {
    mpp = Number(camera.getScaleMetersPerPixel?.());
  } catch {
    mpp = NaN;
  }

  if (!Number.isFinite(mpp) || mpp <= 0) {
    tried.push("camera.estimate mpp via getLookAtPoint probe");
    mpp = estimateMetersPerPixel(camera, canvas) ?? NaN;
  }

  const screen = offsetToScreen(center, canvas, point, mpp);
  if (screen) {
    return { ok: true, ...screen, tried };
  }

  const searched = searchScreenForLatLng(camera, canvas, point);
  if (searched) {
    tried.push("camera.getLookAtPoint screen search");
    return { ok: true, ...searched, tried };
  }

  return {
    ok: false,
    error: "Could not project Anchor to screen (no mpp / look-at probe)",
    tried,
  };
}

function sampleLookAt(
  camera: MreCameraLike,
  x: number,
  y: number,
): LatLng | null {
  if (typeof camera.getLookAtPoint !== "function") return null;
  try {
    return (
      deepFindLatLng(camera.getLookAtPoint(x, y)) ??
      deepFindLatLng(camera.getLookAtPoint([x, y])) ??
      deepFindLatLng(camera.getLookAtPoint({ x, y }))
    );
  } catch {
    return null;
  }
}

/** Derive mpp from how far getLookAtPoint moves for a known pixel offset. */
export function estimateMetersPerPixel(
  camera: MreCameraLike,
  canvas: { left: number; top: number; width: number; height: number },
  probePx = 80,
): number | null {
  if (typeof camera.getLookAtPoint !== "function") return null;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  const origin =
    sampleLookAt(camera, cx, cy) ??
    (() => {
      try {
        return deepFindLatLng(camera.getLookAtPoint!());
      } catch {
        return null;
      }
    })();
  if (!origin) return null;

  const east = sampleLookAt(camera, cx + probePx, cy);
  if (east && !nearlySame(east, origin)) {
    const meters = horizontalMeters(origin, east);
    if (meters > 0) return meters / probePx;
  }

  const south = sampleLookAt(camera, cx, cy + probePx);
  if (south && !nearlySame(south, origin)) {
    const meters = horizontalMeters(origin, south);
    if (meters > 0) return meters / probePx;
  }

  return null;
}

/**
 * When mpp is unavailable, search getLookAtPoint(x,y) for the screen pixel
 * closest to the target lat/lng (coarse grid + local refine).
 */
export function searchScreenForLatLng(
  camera: MreCameraLike,
  canvas: { left: number; top: number; width: number; height: number },
  target: LatLng,
): { clientX: number; clientY: number } | null {
  if (typeof camera.getLookAtPoint !== "function") return null;

  // Sanity: off-center sample must differ from no-arg center, else search is useless.
  const center = (() => {
    try {
      return deepFindLatLng(camera.getLookAtPoint!());
    } catch {
      return null;
    }
  })();
  const probe = sampleLookAt(camera, canvas.width * 0.75, canvas.height * 0.75);
  if (!center || !probe || nearlySame(center, probe)) return null;

  let best = { x: canvas.width / 2, y: canvas.height / 2, score: Infinity };
  const stepX = Math.max(24, Math.floor(canvas.width / 12));
  const stepY = Math.max(24, Math.floor(canvas.height / 12));
  for (let y = stepY / 2; y < canvas.height; y += stepY) {
    for (let x = stepX / 2; x < canvas.width; x += stepX) {
      const ll = sampleLookAt(camera, x, y);
      if (!ll) continue;
      const score = latLngScore(ll, target);
      if (score < best.score) best = { x, y, score };
    }
  }

  // Local refine
  let { x, y, score } = best;
  for (const radius of [stepX, Math.ceil(stepX / 2), 8, 3, 1]) {
    let improved = false;
    for (let dy = -radius; dy <= radius; dy += radius || 1) {
      for (let dx = -radius; dx <= radius; dx += radius || 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx > canvas.width || ny > canvas.height) continue;
        const ll = sampleLookAt(camera, nx, ny);
        if (!ll) continue;
        const s = latLngScore(ll, target);
        if (s < score) {
          x = nx;
          y = ny;
          score = s;
          improved = true;
        }
      }
    }
    if (!improved && radius <= 3) break;
  }

  if (!Number.isFinite(score) || score === Infinity) return null;
  return { clientX: canvas.left + x, clientY: canvas.top + y };
}

function horizontalMeters(a: LatLng, b: LatLng): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dEast = (b.lng - a.lng) * 111_320 * Math.cos(midLat);
  const dNorth = (b.lat - a.lat) * 111_320;
  return Math.hypot(dEast, dNorth);
}

function latLngScore(a: LatLng, b: LatLng): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dEast = (b.lng - a.lng) * Math.cos(midLat);
  const dNorth = b.lat - a.lat;
  return dEast * dEast + dNorth * dNorth;
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
