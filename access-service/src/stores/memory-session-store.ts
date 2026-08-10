import type { SessionStore } from "./session-store.js";

export function createMemorySessionStore(): SessionStore {
  const riders = new Map<string, { googleAccountId: string; role: "base" }>();
  const sessions = new Map<
    string,
    { sessionId: string; googleAccountId: string }
  >();

  return {
    async putRider(rider) {
      riders.set(rider.googleAccountId, rider);
    },
    async getRider(googleAccountId) {
      return riders.get(googleAccountId) ?? null;
    },
    async putSession(session) {
      sessions.set(session.sessionId, session);
    },
    async getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },
  };
}
