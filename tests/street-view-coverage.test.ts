import { describe, expect, it } from "vitest";
import {
  ANCHOR_COVERAGE_RADIUS_M,
  resolveAnchorCoverage,
} from "../src/extension/street-view-coverage.js";

describe("resolveAnchorCoverage", () => {
  it("exposes a tight Anchor search radius (no long auto-snap)", () => {
    expect(ANCHOR_COVERAGE_RADIUS_M).toBeLessThanOrEqual(25);
  });

  it("treats non-OK as Coverage Gap", () => {
    expect(resolveAnchorCoverage("ZERO_RESULTS", null)).toEqual({
      coverage: "coverage_gap",
    });
    expect(
      resolveAnchorCoverage("OK", { location: {} }),
    ).toEqual({ coverage: "coverage_gap" });
  });

  it("on OK returns resolved pano id (not the raw click)", () => {
    expect(
      resolveAnchorCoverage("OK", {
        location: {
          pano: "pano-abc",
          latLng: { lat: 40.01, lng: -105.27 },
        },
      }),
    ).toEqual({
      coverage: "covered",
      pano: "pano-abc",
      position: { lat: 40.01, lng: -105.27 },
    });
  });

  it("reads google.maps LatLng accessors", () => {
    expect(
      resolveAnchorCoverage("OK", {
        location: {
          pano: "pano-fn",
          latLng: { lat: () => 1.5, lng: () => 2.5 },
        },
      }),
    ).toEqual({
      coverage: "covered",
      pano: "pano-fn",
      position: { lat: 1.5, lng: 2.5 },
    });
  });
});
