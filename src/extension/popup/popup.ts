import type { BuildProfile } from "../../domain/types.js";
import { ChromeSettingsStore } from "../../adapters/settings/chrome-settings-store.js";

declare const __BUILD_PROFILE__: BuildProfile;

const settings = new ChromeSettingsStore();

const featureEl = document.getElementById(
  "feature-enabled",
) as HTMLInputElement | null;
const tipFollowEl = document.getElementById(
  "tip-follow",
) as HTMLInputElement | null;
const accountEl = document.getElementById("account-status");

async function hydrate(): Promise<void> {
  if (!featureEl || !tipFollowEl || !accountEl) return;

  featureEl.checked = await settings.getFeatureEnabled();
  tipFollowEl.checked = await settings.getTipFollowEnabled();

  accountEl.textContent =
    __BUILD_PROFILE__ === "dev" ? "Dev build" : "Not connected";

  featureEl.addEventListener("change", () => {
    void settings.setFeatureEnabled(featureEl.checked);
  });

  tipFollowEl.addEventListener("change", () => {
    // Persisted only — Tip Follow Host Page behavior lands in #10.
    void settings.setTipFollowEnabled(tipFollowEl.checked);
  });
}

void hydrate();
