import type { RoleId } from "../access/types.js";

export type RiderRecord = {
  googleAccountId: string;
  role: RoleId;
};

export type SessionRecord = {
  sessionId: string;
  googleAccountId: string;
};

export type SessionStore = {
  putRider(rider: RiderRecord): Promise<void>;
  getRider(googleAccountId: string): Promise<RiderRecord | null>;
  putSession(session: SessionRecord): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
};
