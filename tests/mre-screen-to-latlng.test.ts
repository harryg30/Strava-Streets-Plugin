import { describe, expect, it } from "vitest";
import {
  parseLatLng,
  resolveScreenToLatLng,
} from "../src/extension/mre-screen-to-latlng.js";

describe("parseLatLng — do not invent geo from screen/world x,y", () => {
  it("accepts explicit lat/lng", () => {
    expect(parseLatLng({ lat: 40.01, lng: -105.27 })).toEqual({
      lat: 40.01,
      lng: -105.27,
    });
  });

  it("rejects {x,y} screen/world points (false Coverage Gap source)", () => {
    // Old bridge treated y→lat, x→lng; {x:0.2,y:0.1} became ocean → "No Street View".
    expect(parseLatLng({ x: 0.2, y: 0.1 })).toBeNull();
    expect(parseLatLng({ x: 400, y: 300 })).toBeNull();
  });
});

describe("resolveScreenToLatLng — click must not collapse to map center", () => {
  const canvas = { left: 0, top: 0, width: 800, height: 600 };
  const center = { lat: 40.0, lng: -105.0 };

  it("does not accept getLookAtPoint(x,y) returning {x,y} as geo", () => {
    const result = resolveScreenToLatLng(
      {
        getLookAtPoint: (...args: unknown[]) => {
          if (args.length === 0) return center;
          return { x: 0.2, y: 0.1 };
        },
        getScaleMetersPerPixel: () => 2.5,
      },
      canvas,
      500,
      350,
    );
    expect(result.ok).toBe(true);
    // Must not be the ocean mis-parse
    expect(result.point).not.toEqual({ lat: 0.1, lng: 0.2 });
    // Must not be bare center either (click is right/below center)
    expect(result.point!.lat).toBeLessThan(center.lat);
    expect(result.point!.lng).toBeGreaterThan(center.lng);
  });

  it("offsets from center with mpp when screen-aware look-at is unavailable", () => {
    const result = resolveScreenToLatLng(
      {
        getLookAtPoint: () => center,
        getScaleMetersPerPixel: () => 2.5,
      },
      canvas,
      500,
      350,
    );
    expect(result.ok).toBe(true);
    expect(result.point).not.toEqual(center);
    expect(result.tried).toContain("camera.center+mpp offset");
  });
});
