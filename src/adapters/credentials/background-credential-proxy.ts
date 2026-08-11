import type {
  AccountSnapshot,
  CredentialResult,
} from "../../domain/types.js";
import type { CredentialSource } from "../../ports/index.js";

type CredentialsMessage =
  | { type: "credentials.getStreetViewCredentials" }
  | { type: "credentials.getAccount" }
  | { type: "credentials.beginLogin" };

type CredentialsResponse =
  | { ok: true; result: CredentialResult }
  | { ok: true; account: AccountSnapshot }
  | { ok: true }
  | { ok: false; error: string };

/**
 * Store/content/popup CredentialSource — forwards to the background
 * AccessCredentialSource so Mint cookies and Grant cache stay in one place.
 */
export class BackgroundCredentialProxy implements CredentialSource {
  async getStreetViewCredentials(): Promise<CredentialResult> {
    const res = await send({ type: "credentials.getStreetViewCredentials" });
    if (!res.ok || !("result" in res)) {
      return {
        status: "denied",
        code: "unavailable",
        reason:
          "Access Service is unreachable. Try again later.",
      };
    }
    return res.result;
  }

  async getAccount(): Promise<AccountSnapshot> {
    const res = await send({ type: "credentials.getAccount" });
    if (!res.ok || !("account" in res)) {
      return { kind: "signed_out" };
    }
    return res.account;
  }

  async beginLogin(): Promise<void> {
    await send({ type: "credentials.beginLogin" });
  }
}

function send(message: CredentialsMessage): Promise<CredentialsResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: CredentialsResponse) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message ?? "messaging failed",
          });
          return;
        }
        resolve(response ?? { ok: false, error: "empty response" });
      });
    } catch (err) {
      resolve({
        ok: false,
        error: err instanceof Error ? err.message : "messaging failed",
      });
    }
  });
}

export type { CredentialsMessage, CredentialsResponse };
