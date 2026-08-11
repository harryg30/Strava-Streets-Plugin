import { describe, expect, it } from "vitest";
import { createCredentialSourceForProfile } from "../src/adapters/credentials/create-credential-source.js";
import { DeniedCredentialSource } from "../src/adapters/credentials/denied.js";
import { DevKeyOverrideCredentialSource } from "../src/adapters/credentials/dev-key-override.js";
import {
  clickScreenMatchesAnchor,
  exceedsDragThreshold,
  finishPointerGestureState,
  isRouteBuilderUrl,
  MAP_DRAG_THRESHOLD_PX,
} from "../src/adapters/host-page/strava-host-page.js";

describe("Dev Key Override / credential wiring", () => {
  it("dev profile uses Dev Key Override adapter", () => {
    const source = createCredentialSourceForProfile("dev");
    expect(source).toBeInstanceOf(DevKeyOverrideCredentialSource);
  });

  it("store profile has no override adapter", () => {
    const source = createCredentialSourceForProfile("store");
    expect(source).toBeInstanceOf(DeniedCredentialSource);
    expect(source).not.toBeInstanceOf(DevKeyOverrideCredentialSource);
  });

  it("Dev Key Override returns ok when key present", async () => {
    const source = new DevKeyOverrideCredentialSource("maps-key-123");
    await expect(source.getStreetViewCredentials()).resolves.toEqual({
      status: "ok",
      credential: { apiKey: "maps-key-123" },
    });
  });

  it("Dev Key Override denies when key missing", async () => {
    const source = new DevKeyOverrideCredentialSource("");
    const result = await source.getStreetViewCredentials();
    expect(result.status).toBe("denied");
  });
});

describe("Route Builder URL detection", () => {
  it("matches https://www.strava.com/maps/* paths", () => {
    expect(isRouteBuilderUrl("/maps")).toBe(true);
    expect(isRouteBuilderUrl("/maps/")).toBe(true);
    expect(isRouteBuilderUrl("/maps/routes/new")).toBe(true);
    expect(isRouteBuilderUrl("/maps/something")).toBe(true);
  });

  it("rejects other Strava pages", () => {
    expect(isRouteBuilderUrl("/dashboard")).toBe(false);
    expect(isRouteBuilderUrl("/activities/99")).toBe(false);
    expect(isRouteBuilderUrl("/routes")).toBe(false);
    expect(isRouteBuilderUrl("/routes/new")).toBe(false);
    expect(isRouteBuilderUrl("/routes/12345/edit")).toBe(false);
    expect(isRouteBuilderUrl("/mapping")).toBe(false);
  });
});

describe("Map drag vs Map Click", () => {
  it("treats tiny pointer jitter as a click", () => {
    expect(
      exceedsDragThreshold({ x: 100, y: 100 }, { x: 102, y: 101 }),
    ).toBe(false);
  });

  it("treats movement at/above threshold as a drag (ignore click)", () => {
    expect(
      exceedsDragThreshold(
        { x: 0, y: 0 },
        { x: MAP_DRAG_THRESHOLD_PX, y: 0 },
      ),
    ).toBe(true);
    expect(
      exceedsDragThreshold({ x: 10, y: 10 }, { x: 10, y: 10 + MAP_DRAG_THRESHOLD_PX }),
    ).toBe(true);
  });
});

describe("Map Click Button gesture finish", () => {
  it("clears pointer state when finishing a gesture", () => {
    const { dragged, next } = finishPointerGestureState(
      {
        pointerDown: { x: 10, y: 10, button: "right" },
        dragExceeded: false,
      },
      12,
      10,
    );
    expect(dragged).toBe(false);
    expect(next).toEqual({ pointerDown: null, dragExceeded: false });
  });

  it("treats prior dragExceeded as dragged and still clears", () => {
    const { dragged, next } = finishPointerGestureState(
      {
        pointerDown: { x: 0, y: 0, button: "left" },
        dragExceeded: true,
      },
      0,
      0,
    );
    expect(dragged).toBe(true);
    expect(next.pointerDown).toBeNull();
  });

  it("requireButton ignores mismatch without counting as drag from that start", () => {
    const { dragged, next } = finishPointerGestureState(
      {
        pointerDown: { x: 0, y: 0, button: "left" },
        dragExceeded: false,
      },
      100,
      100,
      { requireButton: "right" },
    );
    expect(dragged).toBe(false);
    expect(next.pointerDown).toBeNull();
  });
});

describe("Anchor peg click-screen cache", () => {
  it("matches when screen coords belong to the Anchor being pegged", () => {
    const covered = { lat: 40.7, lng: -74.0 };
    expect(clickScreenMatchesAnchor(covered, covered)).toBe(true);
    expect(
      clickScreenMatchesAnchor(
        { lat: 40.7 + 1e-9, lng: -74.0 },
        covered,
      ),
    ).toBe(true);
  });

  it("rejects Coverage Gap click coords so remount cannot jump the peg", () => {
    const covered = { lat: 40.7, lng: -74.0 };
    const gap = { lat: 40.8, lng: -74.1 };
    expect(clickScreenMatchesAnchor(gap, covered)).toBe(false);
  });
});
