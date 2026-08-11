import type { IncomingMessage, ServerResponse } from "node:http";
import type { Access } from "../access/types.js";
import {
  GoogleAuthError,
  type GoogleAuth,
} from "../google-auth/types.js";

const SESSION_COOKIE = "access_session";
const OAUTH_STATE_COOKIE = "oauth_state";

export type HttpAppConfig = {
  /** Origin used to build the OAuth redirect_uri (must match GCP Console). */
  publicOrigin: string;
};

export type HttpApp = {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  setCookies: string[] = [],
): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(payload));
  if (setCookies.length > 0) {
    res.setHeader("set-cookie", setCookies);
  }
  res.end(payload);
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

function sendRedirect(
  res: ServerResponse,
  location: string,
  setCookies: string[] = [],
): void {
  res.statusCode = 302;
  res.setHeader("location", location);
  if (setCookies.length > 0) {
    res.setHeader("set-cookie", setCookies);
  }
  res.end();
}

function oauthErrorStatus(kind: GoogleAuthError["kind"]): number {
  if (kind === "invalid_state") return 400;
  if (kind === "exchange_failed") return 502;
  return 401;
}

function callbackRedirectUri(publicOrigin: string): string {
  return `${publicOrigin.replace(/\/$/, "")}/v1/auth/google/callback`;
}

/**
 * Thin HTTP Adapter over Access + Google Auth.
 * Owns cookies, redirects, status codes — not Mint policy or OIDC.
 */
export function createHttpApp(
  access: Access,
  googleAuth: GoogleAuth,
  config: HttpAppConfig,
): HttpApp {
  const redirectUri = callbackRedirectUri(config.publicOrigin);

  async function finishLogin(
    res: ServerResponse,
    input: { code: string; state: string },
  ): Promise<void> {
    const identity = await googleAuth.complete({
      code: input.code,
      state: input.state,
      redirectUri,
    });
    const session = await access.login(identity);
    sendJson(res, 200, { ok: true }, [
      `${SESSION_COOKIE}=${encodeURIComponent(session.sessionId)}; Path=/; HttpOnly; SameSite=Lax`,
      `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    ]);
  }

  async function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", config.publicOrigin);
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && url.pathname === "/v1/auth/google/start") {
        const { authorizeUrl, state } = googleAuth.begin(redirectUri);
        sendRedirect(res, authorizeUrl, [
          `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax`,
        ]);
        return;
      }

      if (method === "GET" && url.pathname === "/v1/auth/google/callback") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          sendJson(res, 400, { error: "invalid_request" });
          return;
        }
        const cookies = parseCookies(req.headers.cookie);
        const cookieState = cookies[OAUTH_STATE_COOKIE];
        if (cookieState && cookieState !== state) {
          sendJson(res, 400, { error: "invalid_state" });
          return;
        }
        await finishLogin(res, { code, state });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/auth/google/callback") {
        const raw = await readBody(req);
        const body = raw
          ? (JSON.parse(raw) as { code?: string; state?: string })
          : {};
        if (!body.code || !body.state) {
          sendJson(res, 400, { error: "invalid_request" });
          return;
        }
        await finishLogin(res, { code: body.code, state: body.state });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/credentials/mint") {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies[SESSION_COOKIE] ?? null;
        const result = await access.mint(sessionId ? { sessionId } : null);

        if (!result.ok) {
          if (result.denial.kind === "unauthenticated") {
            sendEmpty(res, 401);
            return;
          }
          sendJson(res, 403, { error: result.denial.kind });
          return;
        }

        sendJson(res, 200, {
          credential: result.grant.apiKey,
          expires_at: result.grant.expiresAt.toISOString(),
        });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        sendJson(res, oauthErrorStatus(err.kind), { error: err.kind });
        return;
      }
      const message = err instanceof Error ? err.message : "internal_error";
      sendJson(res, 500, { error: "internal_error", message });
    }
  }

  return { handler };
}

export { SESSION_COOKIE, OAUTH_STATE_COOKIE };
