import { describe, expect, it } from "vitest";
import { createCredentialSourceForProfile } from "../src/adapters/credentials/create-credential-source.js";
import { DeniedCredentialSource } from "../src/adapters/credentials/denied.js";
import { DevKeyOverrideCredentialSource } from "../src/adapters/credentials/dev-key-override.js";
import { isRouteBuilderUrl } from "../src/adapters/host-page/strava-host-page.js";

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
