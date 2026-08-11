import { describe, expect, it, beforeEach } from "vitest";
import { ExtensionApplication } from "../src/core/extension-application.js";
import { DEFAULT_PANO_LAYOUT } from "../src/domain/types.js";
import {
  FakeCredentialSource,
  FakeHostPage,
  FakeSettingsStore,
  FakeStreetViewSurface,
} from "./fakes.js";

function pointKey(lat: number, lng: number): string {
  return `${lat},${lng}`;
}

describe("ExtensionApplication seams", () => {
  let host: FakeHostPage;
  let credentials: FakeCredentialSource;
  let streetView: FakeStreetViewSurface;
  let settings: FakeSettingsStore;
  let app: ExtensionApplication;

  beforeEach(async () => {
    host = new FakeHostPage();
    credentials = new FakeCredentialSource();
    streetView = new FakeStreetViewSurface();
    settings = new FakeSettingsStore();
    app = new ExtensionApplication({
      hostPage: host,
      credentials,
      streetView,
      settings,
    });
    await app.start();
  });

  it("is a silent no-op off Route Builder (no Pano, no Map Click listeners)", async () => {
    expect(app.getState().onRouteBuilder).toBe(false);
    expect(streetView.isMounted()).toBe(false);
    expect(host.mapClickSubscriptionCount).toBe(0);

    host.emitMapClick({ lat: 40.7, lng: -74.0 });
    expect(credentials.calls).toBe(0);
    expect(streetView.shownAnchors).toHaveLength(0);
  });

  it("feature off on Route Builder: no Pano and no Map Click listeners", async () => {
    app.stop();
    settings.featureEnabled = false;
    streetView = new FakeStreetViewSurface();
    host = new FakeHostPage();
    app = new ExtensionApplication({
      hostPage: host,
      credentials,
      streetView,
      settings,
    });
    await app.start();

    host.setRouteBuilder(true);
    await flush();

    expect(streetView.isMounted()).toBe(false);
    expect(host.mapClickSubscriptionCount).toBe(0);
  });

  it("feature on: mounts Pano with remembered layout on Route Builder", async () => {
    settings.panoLayout = { x: 40, y: 60, width: 500, height: 360 };
    host.setRouteBuilder(true);
    await flush();

    expect(streetView.isMounted()).toBe(true);
    expect(streetView.layout).toEqual(settings.panoLayout);
    expect(host.mapClickSubscriptionCount).toBe(1);
  });

  it("uses default layout when none stored", async () => {
    host.setRouteBuilder(true);
    await flush();
    expect(streetView.layout).toEqual(DEFAULT_PANO_LAYOUT);
  });

  it("leaving Route Builder tears down Pano and detaches Map Click", async () => {
    host.setRouteBuilder(true);
    await flush();
    expect(streetView.isMounted()).toBe(true);

    host.setRouteBuilder(false);
    await flush();
    expect(streetView.isMounted()).toBe(false);
    expect(host.mapClickSubscriptionCount).toBe(0);
    expect(app.getState().onRouteBuilder).toBe(false);
  });

  it("returning with feature on restores Pano with remembered layout", async () => {
    settings.panoLayout = { x: 10, y: 20, width: 400, height: 300 };
    host.setRouteBuilder(true);
    await flush();
    host.setRouteBuilder(false);
    await flush();
    expect(streetView.isMounted()).toBe(false);

    host.setRouteBuilder(true);
    await flush();
    expect(streetView.isMounted()).toBe(true);
    expect(streetView.layout).toEqual(settings.panoLayout);
  });

  it("Map Click updates Anchor Point and drives Street View surface", async () => {
    host.setRouteBuilder(true);
    await flush();

    const point = { lat: 37.77, lng: -122.42 };
    host.emitMapClick(point);
    await flush();

    expect(credentials.calls).toBe(1);
    expect(streetView.shownAnchors).toEqual([point]);
    expect(streetView.lastSuccessfulPoint).toEqual(point);
    expect(app.getState().lastSuccessfulAnchor).toEqual(point);
    expect(streetView.coverageGapNotice).toBe(false);
  });

  it("Coverage Gap keeps last successful Pano and shows notice; clears on covered point", async () => {
    host.setRouteBuilder(true);
    await flush();

    const covered = { lat: 1, lng: 1 };
    const gap = { lat: 2, lng: 2 };
    streetView.gapPoints.add(pointKey(2, 2));

    host.emitMapClick(covered);
    await flush();
    expect(streetView.lastSuccessfulPoint).toEqual(covered);
    expect(streetView.coverageGapNotice).toBe(false);

    host.emitMapClick(gap);
    await flush();
    // Imagery retained
    expect(streetView.lastSuccessfulPoint).toEqual(covered);
    expect(streetView.blanked).toBe(false);
    expect(streetView.autoSnapped).toBe(false);
    expect(streetView.coverageGapNotice).toBe(true);
    expect(app.getState().coverageGapActive).toBe(true);

    const covered2 = { lat: 3, lng: 3 };
    host.emitMapClick(covered2);
    await flush();
    expect(streetView.lastSuccessfulPoint).toEqual(covered2);
    expect(streetView.coverageGapNotice).toBe(false);
    expect(app.getState().coverageGapActive).toBe(false);
  });

  it("Pano is view-only: surface has no route-mutation API used by core", async () => {
    host.setRouteBuilder(true);
    await flush();
    host.emitMapClick({ lat: 0, lng: 0 });
    await flush();

    // Fake surface intentionally has no mutateRoute / dropWaypoint methods.
    expect("mutateRoute" in streetView).toBe(false);
    expect("dropWaypoint" in streetView).toBe(false);
  });

  it("user close dismisses Pano; Map Click brings it back", async () => {
    host.setRouteBuilder(true);
    await flush();
    streetView.simulateUserClose();
    await flush();
    expect(streetView.isMounted()).toBe(false);
    expect(app.getState().userDismissed).toBe(true);

    host.emitMapClick({ lat: 5, lng: 5 });
    await flush();
    expect(streetView.isMounted()).toBe(true);
  });

  it("layout changes are persisted", async () => {
    host.setRouteBuilder(true);
    await flush();
    const next = { x: 100, y: 120, width: 450, height: 340 };
    streetView.simulateLayoutChange(next);
    await flush();
    expect(settings.panoLayout).toEqual(next);
  });

  it("turning feature off tears down Pano and Map Click listeners", async () => {
    host.setRouteBuilder(true);
    await flush();
    expect(streetView.isMounted()).toBe(true);

    await settings.setFeatureEnabled(false);
    await flush();

    expect(streetView.isMounted()).toBe(false);
    expect(host.mapClickSubscriptionCount).toBe(0);
  });

  it("credential denial surfaces a status message without blanking", async () => {
    host.setRouteBuilder(true);
    await flush();
    host.emitMapClick({ lat: 1, lng: 1 });
    await flush();
    expect(streetView.lastSuccessfulPoint).toEqual({ lat: 1, lng: 1 });

    credentials.next = { status: "denied", reason: "quota exceeded" };
    host.emitMapClick({ lat: 9, lng: 9 });
    await flush();

    expect(streetView.statusMessage).toBe("quota exceeded");
    expect(streetView.lastSuccessfulPoint).toEqual({ lat: 1, lng: 1 });
    expect(streetView.blanked).toBe(false);
  });

  it("Map Click Button defaults to right", async () => {
    expect(await settings.getMapClickButton()).toBe("right");
    expect(app.getState().mapClickButton).toBe("right");
    expect(host.mapClickButton).toBe("right");
  });

  it("left Map Click Button: left click moves Anchor; right click ignored", async () => {
    host.setRouteBuilder(true);
    await flush();

    await settings.setMapClickButton("left");
    await flush();
    expect(app.getState().mapClickButton).toBe("left");
    expect(host.mapClickButton).toBe("left");

    host.emitMapClick({ lat: 9, lng: 9 }, "right");
    await flush();
    expect(streetView.shownAnchors).toHaveLength(0);

    const point = { lat: 40.1, lng: -73.9 };
    host.emitMapClick(point, "left");
    await flush();
    expect(streetView.shownAnchors).toEqual([point]);
  });

  it("right Map Click Button: right click moves Anchor; left click ignored", async () => {
    host.setRouteBuilder(true);
    await flush();
    expect(app.getState().mapClickButton).toBe("right");

    host.emitMapClick({ lat: 1, lng: 1 }, "left");
    await flush();
    expect(streetView.shownAnchors).toHaveLength(0);

    const point = { lat: 2, lng: 2 };
    host.emitMapClick(point, "right");
    await flush();
    expect(streetView.shownAnchors).toEqual([point]);
  });
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
