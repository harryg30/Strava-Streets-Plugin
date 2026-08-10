import { DEFAULT_PANO_LAYOUT } from "../../domain/types.js";
import type { PanoLayout } from "../../domain/types.js";
import type { SettingsStore } from "../../ports/index.js";

const KEYS = {
  featureEnabled: "ssp.featureEnabled",
  tipFollowEnabled: "ssp.tipFollowEnabled",
  panoLayout: "ssp.panoLayout",
} as const;

type ChangeListener = () => void;

/**
 * chrome.storage.sync-backed settings (falls back to local).
 * Tip Follow default on; persisted for #10 to wire behavior.
 */
export class ChromeSettingsStore implements SettingsStore {
  private listeners = new Set<ChangeListener>();
  private watching = false;

  async getFeatureEnabled(): Promise<boolean> {
    const v = await this.get(KEYS.featureEnabled);
    return v === undefined ? true : Boolean(v);
  }

  async setFeatureEnabled(enabled: boolean): Promise<void> {
    await this.set(KEYS.featureEnabled, enabled);
  }

  async getTipFollowEnabled(): Promise<boolean> {
    const v = await this.get(KEYS.tipFollowEnabled);
    return v === undefined ? true : Boolean(v);
  }

  async setTipFollowEnabled(enabled: boolean): Promise<void> {
    await this.set(KEYS.tipFollowEnabled, enabled);
  }

  async getPanoLayout(): Promise<PanoLayout | null> {
    const v = await this.get(KEYS.panoLayout);
    if (!v || typeof v !== "object") return null;
    const layout = v as Partial<PanoLayout>;
    if (
      typeof layout.x !== "number" ||
      typeof layout.y !== "number" ||
      typeof layout.width !== "number" ||
      typeof layout.height !== "number"
    ) {
      return null;
    }
    return {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    };
  }

  async setPanoLayout(layout: PanoLayout): Promise<void> {
    await this.set(KEYS.panoLayout, layout);
  }

  onSettingsChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    this.ensureWatch();
    return () => this.listeners.delete(listener);
  }

  /** Defaults used when storage is empty — exported for tests/docs. */
  static defaults = {
    featureEnabled: true,
    tipFollowEnabled: true,
    panoLayout: DEFAULT_PANO_LAYOUT,
  };

  private ensureWatch(): void {
    if (this.watching || typeof chrome === "undefined" || !chrome.storage) {
      return;
    }
    this.watching = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (
        KEYS.featureEnabled in changes ||
        KEYS.tipFollowEnabled in changes
      ) {
        for (const l of this.listeners) l();
      }
    });
  }

  private storageArea(): chrome.storage.StorageArea {
    return chrome.storage.sync ?? chrome.storage.local;
  }

  private async get(key: string): Promise<unknown> {
    const area = this.storageArea();
    const result = await area.get(key);
    return result[key];
  }

  private async set(key: string, value: unknown): Promise<void> {
    await this.storageArea().set({ [key]: value });
  }
}
