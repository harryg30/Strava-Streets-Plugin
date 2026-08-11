import type { BuildProfile, MapClickButton } from "../../domain/types.js";
import { ChromeSettingsStore } from "../../adapters/settings/chrome-settings-store.js";

declare const __BUILD_PROFILE__: BuildProfile;

const settings = new ChromeSettingsStore();

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

function applyMapClickButton(button: MapClickButton): void {
  if (!leftEl || !rightEl) return;
  leftEl.checked = button === "left";
  rightEl.checked = button === "right";
}

async function hydrate(): Promise<void> {
  if (!featureEl || !leftEl || !rightEl || !accountEl) return;

  featureEl.checked = await settings.getFeatureEnabled();
  applyMapClickButton(await settings.getMapClickButton());

  accountEl.textContent =
    __BUILD_PROFILE__ === "dev" ? "Dev build" : "Not connected";

  featureEl.addEventListener("change", () => {
    void settings.setFeatureEnabled(featureEl.checked);
  });

  const onButtonChange = () => {
    const button: MapClickButton = rightEl.checked ? "right" : "left";
    void settings.setMapClickButton(button);
  };
  leftEl.addEventListener("change", onButtonChange);
  rightEl.addEventListener("change", onButtonChange);
}

void hydrate();
