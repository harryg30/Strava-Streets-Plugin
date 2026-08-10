import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { createAccess } from "../src/access/create-access.js";
import {
  createHttpApp,
  SESSION_COOKIE,
  type GoogleOAuthPort,
} from "../src/http/create-http-app.js";

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

function fakeOAuth(): GoogleOAuthPort {
  return {
    async exchangeCode(code) {
      // Test Adapter: authorization code stands in for googleAccountId.
      return { googleAccountId: code };
    },
  };
}

function cookieFrom(res: TestResponse): string | null {
  const raw = res.headers.getSetCookie?.() ?? [];
  const line = raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!line) return null;
  return line.split(";")[0]!;
}

describe("HTTP Adapter", () => {
  const restrictedKey = "maps-browser-restricted-test-key";

  it("unauthenticated mint is 401", async () => {
    const { access } = createAccess({
      restrictedMapsBrowserKey: restrictedKey,
    });
    const { handler } = createHttpApp(access, fakeOAuth());
    await withServer(handler, async (base) => {
      const res = await request(base, "/v1/credentials/mint", { method: "POST" });
      expect(res.status).toBe(401);
    });
  });

  it("OAuth callback then mint returns Grant", async () => {
    const { access } = createAccess({
      restrictedMapsBrowserKey: restrictedKey,
      clock: () => new Date("2026-08-10T12:00:00.000Z"),
      grantTtlMs: 24 * 60 * 60 * 1000,
    });
    const { handler } = createHttpApp(access, fakeOAuth());
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
      const cookie = cookieFrom(login);
      expect(cookie).toBeTruthy();

      const mint = await request(base, "/v1/credentials/mint", {
        method: "POST",
        headers: { cookie: cookie! },
      });
      expect(mint.status).toBe(200);
      expect(mint.json).toEqual({
        credential: restrictedKey,
        expires_at: "2026-08-11T12:00:00.000Z",
      });
    });
  });

  it("over Quota is 403 quota_exceeded", async () => {
    const { access } = createAccess({
      restrictedMapsBrowserKey: restrictedKey,
      dailyMintCapByRole: { base: 1 },
      clock: () => new Date("2026-08-10T12:00:00.000Z"),
    });
    const { handler } = createHttpApp(access, fakeOAuth());
    await withServer(handler, async (base) => {
      const login = await request(base, "/v1/auth/google/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "google-user-1",
          redirect_uri: "http://localhost/callback",
        }),
      });
      const cookie = cookieFrom(login)!;

      expect(
        (
          await request(base, "/v1/credentials/mint", {
            method: "POST",
            headers: { cookie },
          })
        ).status,
      ).toBe(200);

      const denied = await request(base, "/v1/credentials/mint", {
        method: "POST",
        headers: { cookie },
      });
      expect(denied.status).toBe(403);
      expect(denied.json).toEqual({ error: "quota_exceeded" });
    });
  });
});
