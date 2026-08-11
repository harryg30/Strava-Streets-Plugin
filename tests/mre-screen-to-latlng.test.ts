import { describe, expect, it } from "vitest";
import {
  parseLatLng,
  resolveLatLngToScreen,
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

describe("resolveLatLngToScreen — Anchor peg inverse of mpp offset", () => {
  const canvas = { left: 10, top: 20, width: 800, height: 600 };
  const center = { lat: 40.0, lng: -105.0 };

  it("round-trips a screen click through lat/lng back near the click", () => {
    const camera = {
      getLookAtPoint: () => center,
      getScaleMetersPerPixel: () => 2.5,
    };
    const click = resolveScreenToLatLng(camera, canvas, 500, 350);
    expect(click.ok).toBe(true);
    const screen = resolveLatLngToScreen(camera, canvas, click.point!);
    expect(screen.ok).toBe(true);
    expect(screen.clientX!).toBeCloseTo(500, 5);
    expect(screen.clientY!).toBeCloseTo(350, 5);
  });

  it("estimates mpp from getLookAtPoint probes when scale API is missing", () => {
    const mpp = 2.5;
    const camera = {
      getLookAtPoint: (...args: unknown[]) => {
        if (args.length === 0) return center;
        const x = typeof args[0] === "number" ? args[0] : 400;
        const y = typeof args[1] === "number" ? args[1] : 300;
        // Match offsetFromCenter / offsetToScreen convention
        const dxPx = x - 400;
        const dyPx = y - 300;
        const dEast = dxPx * mpp;
        const dNorth = -dyPx * mpp;
        return {
          lat: center.lat + dNorth / 111_320,
          lng:
            center.lng +
            dEast / (111_320 * Math.cos((center.lat * Math.PI) / 180)),
        };
      },
    };
    const click = resolveScreenToLatLng(camera, canvas, 500, 350);
    expect(click.ok).toBe(true);
    const screen = resolveLatLngToScreen(camera, canvas, click.point!);
    expect(screen.ok).toBe(true);
    expect(screen.clientX!).toBeCloseTo(500, 0);
    expect(screen.clientY!).toBeCloseTo(350, 0);
    expect(screen.tried?.some((t) => t.includes("estimate mpp"))).toBe(true);
  });
});
