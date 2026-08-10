import type { LatLng } from "../domain/types.js";

/**
 * Max distance from the Anchor Point to accept Street View as "covered".
 * Tight on purpose: larger radii invite auto-snap / blank-at-click behavior.
 */
export const ANCHOR_COVERAGE_RADIUS_M = 25;

export type ResolvedCovered = {
  coverage: "covered";
  pano: string;
  position?: LatLng;
};

export type ResolvedGap = {
  coverage: "coverage_gap";
};

export type ResolvedCoverage = ResolvedCovered | ResolvedGap;

type PanoramaLocationLike = {
  pano?: string;
  latLng?: {
    lat: number | (() => number);
    lng: number | (() => number);
  } | null;
};

type PanoramaDataLike = {
  location?: PanoramaLocationLike;
} | null | undefined;

function readLatLng(
  latLng: PanoramaLocationLike["latLng"],
): LatLng | undefined {
  if (!latLng) return undefined;
  const lat = typeof latLng.lat === "function" ? latLng.lat() : latLng.lat;
  const lng = typeof latLng.lng === "function" ? latLng.lng() : latLng.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

/**
 * Map StreetViewService.getPanorama status/data to Coverage Gap vs covered.
 * Covered always carries the resolved pano id — callers must show that pano,
 * not re-apply the raw click coordinate (which can blank or snap oddly).
 */
export function resolveAnchorCoverage(
  status: string,
  data: PanoramaDataLike,
): ResolvedCoverage {
  const pano = data?.location?.pano;
  if (status !== "OK" || !pano) {
    return { coverage: "coverage_gap" };
  }
  return {
    coverage: "covered",
    pano,
    position: readLatLng(data?.location?.latLng),
  };
}
