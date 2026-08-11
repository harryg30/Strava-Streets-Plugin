import { describe, expect, it } from "vitest";
import { createAccess } from "../src/access/create-access.js";

describe("Access", () => {
  const restrictedKey = "maps-browser-restricted-test-key";

  function accessWith(opts?: {
    dailyMintCap?: number;
    grantTtlMs?: number;
    now?: Date;
  }) {
    let now = opts?.now ?? new Date("2026-08-10T12:00:00.000Z");
    const { access } = createAccess({
      restrictedMapsBrowserKey: restrictedKey,
      dailyMintCapByRole: { base: opts?.dailyMintCap ?? 100 },
      grantTtlMs: opts?.grantTtlMs ?? 24 * 60 * 60 * 1000,
      clock: () => now,
    });
    return {
      access,
      setNow: (next: Date) => {
        now = next;
      },
    };
  }

  it("login assigns Role base and returns a Session", async () => {
    const { createMemorySessionStore } = await import(
      "../src/stores/memory-session-store.js"
    );
    const sessionStore = createMemorySessionStore();
    const { access } = createAccess(
      { restrictedMapsBrowserKey: restrictedKey },
      { sessionStore },
    );
    const session = await access.login({ googleAccountId: "google-user-1" });
    expect(session.sessionId.length).toBeGreaterThan(0);
    expect(await sessionStore.getRider("google-user-1")).toEqual({
      googleAccountId: "google-user-1",
      role: "base",
    });
  });

  it("mint returns a Grant with the restricted key and expires_at", async () => {
    const { access } = accessWith({
      now: new Date("2026-08-10T12:00:00.000Z"),
      grantTtlMs: 24 * 60 * 60 * 1000,
    });
    const session = await access.login({ googleAccountId: "google-user-1" });
    const result = await access.mint(session);
    expect(result).toEqual({
      ok: true,
      grant: {
        apiKey: restrictedKey,
        expiresAt: new Date("2026-08-11T12:00:00.000Z"),
      },
    });
  });

  it("mint without a Session is unauthenticated", async () => {
    const { access } = accessWith();
    const result = await access.mint(null);
    expect(result).toEqual({
      ok: false,
      denial: { kind: "unauthenticated" },
    });
  });

  it("mint with unknown Session is unauthenticated", async () => {
    const { access } = accessWith();
    const result = await access.mint({ sessionId: "no-such-session" });
    expect(result).toEqual({
      ok: false,
      denial: { kind: "unauthenticated" },
    });
  });

  it("over Quota denies with quota_exceeded and UTC reset", async () => {
    const { access } = accessWith({
      dailyMintCap: 2,
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    const session = await access.login({ googleAccountId: "google-user-1" });
    expect((await access.mint(session)).ok).toBe(true);
    expect((await access.mint(session)).ok).toBe(true);
    const third = await access.mint(session);
    expect(third).toEqual({
      ok: false,
      denial: {
        kind: "quota_exceeded",
        resetAt: new Date("2026-08-11T00:00:00.000Z"),
      },
    });
  });

  it("Quota is per Google account, not per Session", async () => {
    const { access } = accessWith({ dailyMintCap: 1 });
    const s1 = await access.login({ googleAccountId: "google-user-1" });
    expect((await access.mint(s1)).ok).toBe(true);
    const s2 = await access.login({ googleAccountId: "google-user-1" });
    const remint = await access.mint(s2);
    expect(remint).toEqual({
      ok: false,
      denial: {
        kind: "quota_exceeded",
        resetAt: new Date("2026-08-11T00:00:00.000Z"),
      },
    });
  });

  it("successful Mint never returns a different master key", async () => {
    const { access } = accessWith();
    const session = await access.login({ googleAccountId: "google-user-1" });
    const result = await access.mint(session);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grant.apiKey).toBe(restrictedKey);
      expect(result.grant.apiKey).not.toContain("master");
    }
  });

  it("Quota resets on the next UTC day", async () => {
    const bag = accessWith({
      dailyMintCap: 1,
      now: new Date("2026-08-10T23:00:00.000Z"),
    });
    const session = await bag.access.login({ googleAccountId: "google-user-1" });
    expect((await bag.access.mint(session)).ok).toBe(true);
    bag.setNow(new Date("2026-08-11T00:00:00.000Z"));
    expect((await bag.access.mint(session)).ok).toBe(true);
  });

  it("Session without a rider is membership_required", async () => {
    const { createMemorySessionStore } = await import(
      "../src/stores/memory-session-store.js"
    );
    const sessionStore = createMemorySessionStore();
    await sessionStore.putSession({
      sessionId: "orphan-session",
      googleAccountId: "no-rider-yet",
    });
    const { access } = createAccess(
      { restrictedMapsBrowserKey: restrictedKey },
      { sessionStore },
    );
    const result = await access.mint({ sessionId: "orphan-session" });
    expect(result).toEqual({
      ok: false,
      denial: { kind: "membership_required" },
    });
  });
});
