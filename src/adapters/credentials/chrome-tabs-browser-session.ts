import type { BrowserSession } from "./access-credential-source.js";
import { normalizeAccessOrigin } from "./access-shared.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function isOauthCallbackSuccess(urlString: string, accessOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  const origin = normalizeAccessOrigin(accessOrigin);
  if (url.origin !== origin) return false;
  if (url.pathname !== "/v1/auth/google/callback") return false;
  if (url.searchParams.get("error")) return false;
  return Boolean(url.searchParams.get("code"));
}

/**
 * Production BrowserSession — opens Access OAuth start, waits until the
 * callback lands with a code (session cookie set), then closes that tab.
 */
export class ChromeTabsBrowserSession implements BrowserSession {
  constructor(private readonly accessOrigin: string) {}

  async openAccessLogin(startUrl: string): Promise<void> {
    const tab = await chrome.tabs.create({ url: startUrl });
    const tabId = tab.id;
    if (tabId === undefined) {
      throw new Error("Could not open login tab");
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          void chrome.tabs.remove(tabId).catch(() => undefined);
          reject(new Error("Google login timed out"));
        });
      }, LOGIN_TIMEOUT_MS);

      const onUpdated = (
        id: number,
        info: chrome.tabs.TabChangeInfo,
        updated: chrome.tabs.Tab,
      ) => {
        if (id !== tabId || info.status !== "complete" || !updated.url) return;
        if (!isOauthCallbackSuccess(updated.url, this.accessOrigin)) return;
        finish(() => {
          void chrome.tabs
            .remove(tabId)
            .catch(() => undefined)
            .finally(() => resolve());
        });
      };

      const onRemoved = (id: number) => {
        if (id !== tabId) return;
        finish(() => reject(new Error("Google login cancelled")));
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });
  }
}

export { isOauthCallbackSuccess };
