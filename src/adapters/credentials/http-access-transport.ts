import type {
  MintTransportResult,
  AccessTransport,
} from "./access-credential-source.js";
import { normalizeAccessOrigin } from "./access-shared.js";

export type HttpAccessTransportDeps = {
  accessOrigin: string;
  fetch?: typeof fetch;
};

/**
 * Production AccessTransport — POST /v1/credentials/mint with session cookies.
 * Intended for the extension background (host_permissions); not Strava page CORS.
 */
export class HttpAccessTransport implements AccessTransport {
  private readonly mintUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: HttpAccessTransportDeps) {
    const origin = normalizeAccessOrigin(deps.accessOrigin);
    this.mintUrl = `${origin}/v1/credentials/mint`;
    this.fetchImpl = deps.fetch ?? fetch.bind(globalThis);
  }

  async mint(): Promise<MintTransportResult> {
    const res = await this.fetchImpl(this.mintUrl, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (res.status === 401) {
      return { ok: false, denial: { kind: "unauthenticated" } };
    }

    if (res.status === 403) {
      let error = "membership_required";
      try {
        const body = (await res.json()) as { error?: string; reset_at?: string };
        if (
          body.error === "quota_exceeded" ||
          body.error === "membership_required"
        ) {
          error = body.error;
        }
        if (error === "quota_exceeded") {
          const resetAt = body.reset_at ? new Date(body.reset_at) : undefined;
          return {
            ok: false,
            denial: {
              kind: "quota_exceeded",
              ...(resetAt && !Number.isNaN(resetAt.getTime())
                ? { resetAt }
                : {}),
            },
          };
        }
      } catch {
        // fall through to membership_required
      }
      return { ok: false, denial: { kind: "membership_required" } };
    }

    if (!res.ok) {
      throw new Error(`mint failed: HTTP ${res.status}`);
    }

    const body = (await res.json()) as {
      credential?: string;
      expires_at?: string;
    };
    if (!body.credential || !body.expires_at) {
      throw new Error("mint failed: missing credential or expires_at");
    }
    const expiresAt = new Date(body.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error("mint failed: invalid expires_at");
    }
    return {
      ok: true,
      grant: { apiKey: body.credential, expiresAt },
    };
  }
}
