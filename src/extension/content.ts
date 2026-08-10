import { createCredentialSource } from "../adapters/credentials/active.js";
import { StravaHostPage } from "../adapters/host-page/strava-host-page.js";
import { ChromeSettingsStore } from "../adapters/settings/chrome-settings-store.js";
import { MapsStreetViewSurface } from "../adapters/street-view/maps-street-view-surface.js";
import { ExtensionApplication } from "../core/extension-application.js";

/**
 * Content script entry — injected only on https://www.strava.com/maps/*.
 * Host Page still gates on /maps/* for SPA leave/return; elsewhere silent (no inject).
 */
function showBootError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[Strava Streets] content script failed:", err);
  const existing = document.getElementById("ssp-boot-error");
  if (existing) {
    existing.textContent = `Strava Streets error: ${message}`;
    return;
  }
  const el = document.createElement("div");
  el.id = "ssp-boot-error";
  el.textContent = `Strava Streets error: ${message}`;
  el.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "left:12px",
    "bottom:12px",
    "max-width:420px",
    "padding:10px 12px",
    "background:#3b0f0f",
    "color:#ffe8e8",
    "border:1px solid #c45c26",
    "font:12px/1.4 sans-serif",
  ].join(";");
  document.documentElement.appendChild(el);
}

try {
  const app = new ExtensionApplication({
    hostPage: new StravaHostPage(),
    credentials: createCredentialSource(),
    streetView: new MapsStreetViewSurface(),
    settings: new ChromeSettingsStore(),
  });

  void app.start().catch(showBootError);
} catch (err) {
  showBootError(err);
}
