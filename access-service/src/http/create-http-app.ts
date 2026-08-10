import type { IncomingMessage, ServerResponse } from "node:http";
import type { Access, GoogleIdentity } from "../access/types.js";

const SESSION_COOKIE = "access_session";

export type GoogleOAuthPort = {
  /** Exchange an authorization code for a Google account identity. */
  exchangeCode(code: string, redirectUri: string): Promise<GoogleIdentity>;
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
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status);
  res.end();
}

/**
 * Thin HTTP Adapter over Access.
 * Owns cookies, status codes, and Google OAuth exchange — not Mint policy.
 */
export function createHttpApp(
  access: Access,
  oauth: GoogleOAuthPort,
): HttpApp {
  async function handler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://access.local");
    const method = req.method ?? "GET";

    try {
      if (method === "POST" && url.pathname === "/v1/auth/google/callback") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as { code?: string; redirect_uri?: string }) : {};
        if (!body.code || !body.redirect_uri) {
          sendJson(res, 400, { error: "invalid_request" });
          return;
        }
        const identity = await oauth.exchangeCode(body.code, body.redirect_uri);
        const session = await access.login(identity);
        sendJson(
          res,
          200,
          { ok: true },
          {
            "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(session.sessionId)}; Path=/; HttpOnly; SameSite=Lax`,
          },
        );
        return;
      }

      if (method === "POST" && url.pathname === "/v1/credentials/mint") {
        const cookies = parseCookies(req.headers.cookie);
        const sessionId = cookies[SESSION_COOKIE] ?? null;
        const result = await access.mint(
          sessionId ? { sessionId } : null,
        );

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
      const message = err instanceof Error ? err.message : "internal_error";
      sendJson(res, 500, { error: "internal_error", message });
    }
  }

  return { handler };
}

export { SESSION_COOKIE };
