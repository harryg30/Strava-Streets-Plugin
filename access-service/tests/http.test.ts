import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { Access, Session } from "../src/access/types.js";
import {
  createHttpApp,
  SESSION_COOKIE,
  type GoogleOAuthPort,
} from "../src/http/create-http-app.js";
import { createDevOAuthStandIn } from "../src/http/dev-oauth-stand-in.js";

type TestResponse = {
  status: number;
  headers: Headers;
  json: unknown | null;
  text: string;
};

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

async function request(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<TestResponse> {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json: unknown | null = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, headers: res.headers, json, text };
}

function cookieFrom(res: TestResponse): string | null {
  const raw = res.headers.getSetCookie?.() ?? [];
  const line = raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!line) return null;
  return line.split(";")[0]!;
}

function stubAccess(overrides: Partial<Access> = {}): Access {
  return {
    login: vi.fn(async () => ({ sessionId: "session-from-stub" })),
    mint: vi.fn(async () => ({
      ok: false as const,
      denial: { kind: "unauthenticated" as const },
    })),
    ...overrides,
  };
}

describe("HTTP Adapter (transport mapping)", () => {
  it("OAuth callback exchanges code, calls login, sets session cookie", async () => {
    const access = stubAccess();
    const oauth: GoogleOAuthPort = {
      exchangeCode: vi.fn(async (code, redirectUri) => {
        expect(code).toBe("google-user-1");
        expect(redirectUri).toBe("http://localhost/callback");
        return { googleAccountId: "google-user-1" };
      }),
    };
    const { handler } = createHttpApp(access, oauth);
    await withServer(handler, async (base) => {
      const login = await request(base, "/v1/auth/google/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "google-user-1",
          redirect_uri: "http://localhost/callback",
        }),
      });
      expect(login.status).toBe(200);
      expect(login.json).toEqual({ ok: true });
      expect(cookieFrom(login)).toBe(`${SESSION_COOKIE}=session-from-stub`);
      expect(access.login).toHaveBeenCalledWith({
        googleAccountId: "google-user-1",
      });
      expect(oauth.exchangeCode).toHaveBeenCalledOnce();
    });
  });

  it("unauthenticated mint maps to 401", async () => {
    const access = stubAccess({
      mint: vi.fn(async () => ({
        ok: false as const,
        denial: { kind: "unauthenticated" as const },
      })),
    });
    const { handler } = createHttpApp(access, createDevOAuthStandIn());
    await withServer(handler, async (base) => {
      const res = await request(base, "/v1/credentials/mint", { method: "POST" });
      expect(res.status).toBe(401);
      expect(access.mint).toHaveBeenCalledWith(null);
    });
  });

  it("successful mint maps Grant to 200 credential + expires_at", async () => {
    const expiresAt = new Date("2026-08-11T12:00:00.000Z");
    const access = stubAccess({
      mint: vi.fn(async (session: Session | null) => {
        expect(session).toEqual({ sessionId: "sess-1" });
        return {
          ok: true as const,
          grant: { apiKey: "maps-browser-restricted-test-key", expiresAt },
        };
      }),
    });
    const { handler } = createHttpApp(access, createDevOAuthStandIn());
    await withServer(handler, async (base) => {
      const mint = await request(base, "/v1/credentials/mint", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=sess-1` },
      });
      expect(mint.status).toBe(200);
      expect(mint.json).toEqual({
        credential: "maps-browser-restricted-test-key",
        expires_at: "2026-08-11T12:00:00.000Z",
      });
    });
  });

  it("membership_required maps to 403", async () => {
    const access = stubAccess({
      mint: vi.fn(async () => ({
        ok: false as const,
        denial: { kind: "membership_required" as const },
      })),
    });
    const { handler } = createHttpApp(access, createDevOAuthStandIn());
    await withServer(handler, async (base) => {
      const denied = await request(base, "/v1/credentials/mint", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=orphan` },
      });
      expect(denied.status).toBe(403);
      expect(denied.json).toEqual({ error: "membership_required" });
    });
  });

  it("quota_exceeded maps to 403", async () => {
    const access = stubAccess({
      mint: vi.fn(async () => ({
        ok: false as const,
        denial: {
          kind: "quota_exceeded" as const,
          resetAt: new Date("2026-08-11T00:00:00.000Z"),
        },
      })),
    });
    const { handler } = createHttpApp(access, createDevOAuthStandIn());
    await withServer(handler, async (base) => {
      const denied = await request(base, "/v1/credentials/mint", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=sess-1` },
      });
      expect(denied.status).toBe(403);
      expect(denied.json).toEqual({ error: "quota_exceeded" });
    });
  });
});
