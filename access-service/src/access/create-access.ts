import { randomUUID } from "node:crypto";
import type { Access, AccessConfig, MintResult, Session } from "./types.js";
import { createMemoryQuotaStore } from "../stores/memory-quota-store.js";
import { createMemorySessionStore } from "../stores/memory-session-store.js";
import type { QuotaStore } from "../stores/quota-store.js";
import type { SessionStore } from "../stores/session-store.js";

const DEFAULT_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BASE_CAP = 100;

export type CreateAccessDeps = {
  quotaStore?: QuotaStore;
  sessionStore?: SessionStore;
};

export type CreateAccessResult = {
  access: Access;
};

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nextUtcMidnight(d: Date): Date {
  const day = utcDay(d);
  const [y, m, dd] = day.split("-").map(Number);
  // next day 00:00 UTC
  return new Date(Date.UTC(y, m - 1, dd + 1, 0, 0, 0, 0));
}

function hasMintEntitlement(role: "base"): boolean {
  // #9: Role `base` is mint-entitled. membership_required = lacking entitlement.
  return role === "base";
}

export function createAccess(
  config: AccessConfig,
  deps: CreateAccessDeps = {},
): CreateAccessResult {
  const quotaStore = deps.quotaStore ?? createMemoryQuotaStore();
  const sessionStore = deps.sessionStore ?? createMemorySessionStore();
  const clock = config.clock ?? (() => new Date());
  const grantTtlMs = config.grantTtlMs ?? DEFAULT_GRANT_TTL_MS;
  const baseCap = config.dailyMintCapByRole?.base ?? DEFAULT_BASE_CAP;
  const restrictedKey = config.restrictedMapsBrowserKey;

  const access: Access = {
    async login(identity) {
      await sessionStore.putRider({
        googleAccountId: identity.googleAccountId,
        role: "base",
      });
      const sessionId = randomUUID();
      await sessionStore.putSession({
        sessionId,
        googleAccountId: identity.googleAccountId,
      });
      return { sessionId };
    },

    async mint(session: Session | null): Promise<MintResult> {
      if (!session?.sessionId) {
        return { ok: false, denial: { kind: "unauthenticated" } };
      }

      const record = await sessionStore.getSession(session.sessionId);
      if (!record) {
        return { ok: false, denial: { kind: "unauthenticated" } };
      }

      const rider = await sessionStore.getRider(record.googleAccountId);
      if (!rider || !hasMintEntitlement(rider.role)) {
        return { ok: false, denial: { kind: "membership_required" } };
      }

      const now = clock();
      const day = utcDay(now);
      const used = await quotaStore.getCount(record.googleAccountId, day);
      if (used >= baseCap) {
        return {
          ok: false,
          denial: { kind: "quota_exceeded", resetAt: nextUtcMidnight(now) },
        };
      }

      await quotaStore.increment(record.googleAccountId, day);

      return {
        ok: true,
        grant: {
          apiKey: restrictedKey,
          expiresAt: new Date(now.getTime() + grantTtlMs),
        },
      };
    },
  };

  return { access };
}
