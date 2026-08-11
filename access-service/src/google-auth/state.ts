import { createHmac, timingSafeEqual } from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000;

type StatePayload = {
  nonce: string;
  redirectUri: string;
  exp: number;
};

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseB64urlJson<T>(raw: string): T {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as T;
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Opaque CSRF state bound to redirectUri (HMAC). Shared by production + fake Adapters. */
export function mintState(
  secret: string,
  redirectUri: string,
  nowMs = Date.now(),
  nonce = `${nowMs}-${Math.random().toString(36).slice(2)}`,
): string {
  const payload: StatePayload = {
    nonce,
    redirectUri,
    exp: nowMs + STATE_TTL_MS,
  };
  const body = b64urlJson(payload);
  return `${body}.${sign(secret, body)}`;
}

export function verifyState(
  secret: string,
  state: string,
  redirectUri: string,
  nowMs = Date.now(),
): boolean {
  const parts = state.split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  if (!body || !sig) return false;
  if (!safeEqual(sig, sign(secret, body))) return false;
  try {
    const payload = parseB64urlJson<StatePayload>(body);
    if (payload.redirectUri !== redirectUri) return false;
    if (typeof payload.exp !== "number" || payload.exp < nowMs) return false;
    return true;
  } catch {
    return false;
  }
}
