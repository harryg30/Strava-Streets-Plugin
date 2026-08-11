import type { BuildProfile, MapClickButton } from "../../domain/types.js";
import { createCredentialSource } from "../../adapters/credentials/active.js";
import { ChromeSettingsStore } from "../../adapters/settings/chrome-settings-store.js";

declare const __BUILD_PROFILE__: BuildProfile;

const settings = new ChromeSettingsStore();
const credentials = createCredentialSource();

const featureEl = document.getElementById(
  "feature-enabled",
) as HTMLInputElement | null;
const leftEl = document.getElementById(
  "map-click-left",
) as HTMLInputElement | null;
const rightEl = document.getElementById(
  "map-click-right",
) as HTMLInputElement | null;
const accountEl = document.getElementById("account-status");
const connectBtn = document.getElementById(
  "account-connect",
) as HTMLButtonElement | null;

function applyMapClickButton(button: MapClickButton): void {
  if (!leftEl || !rightEl) return;
  leftEl.checked = button === "left";
  rightEl.checked = button === "right";
}

async function paintAccount(): Promise<void> {
  if (!accountEl || !connectBtn) return;

  const snap = await credentials.getAccount();
  switch (snap.kind) {
    case "dev_override":
      accountEl.textContent = "Dev build";
      connectBtn.hidden = true;
      break;
    case "signed_out":
      accountEl.textContent = "Not connected";
      connectBtn.hidden = __BUILD_PROFILE__ === "dev";
      break;
    case "ready":
      accountEl.textContent = "Connected";
      connectBtn.hidden = true;
      break;
    case "denied":
      accountEl.textContent = snap.reason;
      connectBtn.hidden = snap.code !== "unauthenticated";
      break;
  }
}

async function hydrate(): Promise<void> {
  if (!featureEl || !leftEl || !rightEl || !accountEl || !connectBtn) return;

  featureEl.checked = await settings.getFeatureEnabled();
  applyMapClickButton(await settings.getMapClickButton());
  await paintAccount();

  featureEl.addEventListener("change", () => {
    void settings.setFeatureEnabled(featureEl.checked);
  });

  const onButtonChange = () => {
    const button: MapClickButton = rightEl.checked ? "right" : "left";
    void settings.setMapClickButton(button);
  };
  leftEl.addEventListener("change", onButtonChange);
  rightEl.addEventListener("change", onButtonChange);

  connectBtn.addEventListener("click", () => {
    void credentials.beginLogin().then(() => paintAccount());
  });

  window.addEventListener("focus", () => {
    void paintAccount();
  });
}

void hydrate();
