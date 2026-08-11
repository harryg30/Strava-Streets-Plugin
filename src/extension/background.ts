/**
 * MV3 service worker — settings in chrome.storage; content owns Route Builder /
 * Pano lifecycle. Store Phase Mint + OAuth live here so session cookies and
 * Grant cache stay off the Strava page origin.
 */
import { AccessCredentialSource } from "../adapters/credentials/access-credential-source.js";
import type {
  CredentialsMessage,
  CredentialsResponse,
} from "../adapters/credentials/background-credential-proxy.js";
import { ChromeTabsBrowserSession } from "../adapters/credentials/chrome-tabs-browser-session.js";
import { HttpAccessTransport } from "../adapters/credentials/http-access-transport.js";

declare const __ACCESS_ORIGIN__: string;

const accessOrigin =
  typeof __ACCESS_ORIGIN__ !== "undefined" && __ACCESS_ORIGIN__
    ? __ACCESS_ORIGIN__
    : "http://127.0.0.1:8787";

const accessCredentials = new AccessCredentialSource({
  transport: new HttpAccessTransport({ accessOrigin }),
  browserSession: new ChromeTabsBrowserSession(accessOrigin),
  accessOrigin,
});

chrome.runtime.onInstalled.addListener(() => {
  // Defaults are applied lazily by ChromeSettingsStore getters.
});

chrome.runtime.onMessage.addListener(
  (
    message: CredentialsMessage,
    _sender,
    sendResponse: (response: CredentialsResponse) => void,
  ) => {
    void (async () => {
      try {
        if (message?.type === "credentials.getStreetViewCredentials") {
          const result = await accessCredentials.getStreetViewCredentials();
          sendResponse({ ok: true, result });
          return;
        }
        if (message?.type === "credentials.getAccount") {
          const account = await accessCredentials.getAccount();
          sendResponse({ ok: true, account });
          return;
        }
        if (message?.type === "credentials.beginLogin") {
          await accessCredentials.beginLogin();
          sendResponse({ ok: true });
          return;
        }
        sendResponse({ ok: false, error: "unknown message" });
      } catch (err) {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : "credentials failed",
        });
      }
    })();
    return true; // async sendResponse
  },
);
