import { describe, expect, it } from "vitest";
import {
  AccessCredentialSource,
  type AccessTransport,
  type BrowserSession,
  type MintTransportResult,
} from "../src/adapters/credentials/access-credential-source.js";

class ScriptedTransport implements AccessTransport {
  mintCalls = 0;
  next: MintTransportResult = {
    ok: false,
    denial: { kind: "unauthenticated" },
  };

  async mint(): Promise<MintTransportResult> {
    this.mintCalls += 1;
    return this.next;
  }
}

class FakeBrowserSession implements BrowserSession {
  opened: string[] = [];

  async openAccessLogin(startUrl: string): Promise<void> {
    this.opened.push(startUrl);
  }
}

function createSource(
  transport: ScriptedTransport,
  browser: FakeBrowserSession = new FakeBrowserSession(),
  clock = () => new Date("2026-08-11T12:00:00.000Z"),
): AccessCredentialSource {
  return new AccessCredentialSource({
    transport,
    browserSession: browser,
    accessOrigin: "http://access.test",
    clock,
  });
}

describe("AccessCredentialSource", () => {
  it("Mints and returns a Grant credential", async () => {
    const transport = new ScriptedTransport();
    transport.next = {
      ok: true,
      grant: {
        apiKey: "maps-browser-key",
        expiresAt: new Date("2026-08-12T12:00:00.000Z"),
      },
    };
    const source = createSource(transport);

    await expect(source.getStreetViewCredentials()).resolves.toEqual({
      status: "ok",
      credential: { apiKey: "maps-browser-key" },
    });
    expect(transport.mintCalls).toBe(1);
  });

  it("remints after Grant expiry and caches while valid", async () => {
    const transport = new ScriptedTransport();
    let now = new Date("2026-08-11T12:00:00.000Z");
    transport.next = {
      ok: true,
      grant: {
        apiKey: "key-1",
        expiresAt: new Date("2026-08-11T13:00:00.000Z"),
      },
    };
    const source = createSource(transport, new FakeBrowserSession(), () => now);

    await expect(source.getStreetViewCredentials()).resolves.toMatchObject({
      status: "ok",
      credential: { apiKey: "key-1" },
    });
    await expect(source.getStreetViewCredentials()).resolves.toMatchObject({
      status: "ok",
      credential: { apiKey: "key-1" },
    });
    expect(transport.mintCalls).toBe(1);

    now = new Date("2026-08-11T14:00:00.000Z");
    transport.next = {
      ok: true,
      grant: {
        apiKey: "key-2",
        expiresAt: new Date("2026-08-12T14:00:00.000Z"),
      },
    };
    await expect(source.getStreetViewCredentials()).resolves.toMatchObject({
      status: "ok",
      credential: { apiKey: "key-2" },
    });
    expect(transport.mintCalls).toBe(2);
  });

  it("maps Mint denials to CredentialDenied with rider-facing reason", async () => {
    const transport = new ScriptedTransport();
    const source = createSource(transport);

    transport.next = { ok: false, denial: { kind: "unauthenticated" } };
    let result = await source.getStreetViewCredentials();
    expect(result).toMatchObject({
      status: "denied",
      code: "unauthenticated",
    });
    expect(result.status === "denied" && result.reason.length).toBeGreaterThan(0);

    transport.next = { ok: false, denial: { kind: "membership_required" } };
    result = await source.getStreetViewCredentials();
    expect(result).toMatchObject({
      status: "denied",
      code: "membership_required",
    });

    const resetAt = new Date("2026-08-12T00:00:00.000Z");
    transport.next = {
      ok: false,
      denial: { kind: "quota_exceeded", resetAt },
    };
    result = await source.getStreetViewCredentials();
    expect(result.status).toBe("denied");
    if (result.status === "denied") {
      expect(result.code).toBe("quota_exceeded");
      expect(result.resetAt).toEqual(resetAt);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("getAccount never Mints", async () => {
    const transport = new ScriptedTransport();
    const source = createSource(transport);

    await expect(source.getAccount()).resolves.toEqual({ kind: "signed_out" });
    expect(transport.mintCalls).toBe(0);

    transport.next = {
      ok: true,
      grant: {
        apiKey: "maps-browser-key",
        expiresAt: new Date("2026-08-12T12:00:00.000Z"),
      },
    };
    await source.getStreetViewCredentials();
    expect(transport.mintCalls).toBe(1);

    await expect(source.getAccount()).resolves.toEqual({ kind: "ready" });
    expect(transport.mintCalls).toBe(1);
  });

  it("getAccount remembers last denial without Minting again", async () => {
    const transport = new ScriptedTransport();
    transport.next = { ok: false, denial: { kind: "quota_exceeded" } };
    const source = createSource(transport);

    await source.getStreetViewCredentials();
    expect(transport.mintCalls).toBe(1);

    const snap = await source.getAccount();
    expect(snap).toMatchObject({
      kind: "denied",
      code: "quota_exceeded",
    });
    expect(transport.mintCalls).toBe(1);
  });

  it("beginLogin waits for OAuth then Mints so getAccount is Connected", async () => {
    const transport = new ScriptedTransport();
    const browser = new FakeBrowserSession();
    transport.next = {
      ok: true,
      grant: {
        apiKey: "maps-browser-key",
        expiresAt: new Date("2026-08-12T12:00:00.000Z"),
      },
    };
    const source = createSource(transport, browser);

    await expect(source.getAccount()).resolves.toEqual({ kind: "signed_out" });

    await source.beginLogin();

    expect(browser.opened).toEqual([
      "http://access.test/v1/auth/google/start",
    ]);
    expect(transport.mintCalls).toBe(1);
    await expect(source.getAccount()).resolves.toEqual({ kind: "ready" });
  });

  it("beginLogin opens Access OAuth start URL", async () => {
    const transport = new ScriptedTransport();
    const browser = new FakeBrowserSession();
    const source = createSource(transport, browser);

    await source.beginLogin();
    expect(browser.opened).toEqual([
      "http://access.test/v1/auth/google/start",
    ]);
    // Post-login Mint runs; default transport is unauthenticated.
    expect(transport.mintCalls).toBe(1);
  });
});
