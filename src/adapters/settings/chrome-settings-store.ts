import { DEFAULT_PANO_LAYOUT } from "../../domain/types.js";
import type { MapClickButton, PanoLayout } from "../../domain/types.js";
import type { SettingsStore } from "../../ports/index.js";

const KEYS = {
  mapClickButton: "ssp.mapClickButton",
  panoLayout: "ssp.panoLayout",
} as const;

type ChangeListener = () => void;

function parseMapClickButton(value: unknown): MapClickButton {
  return value === "left" ? "left" : "right";
}

/**
 * chrome.storage.sync-backed settings (falls back to local).
 * Map Click Button default: right.
 */
export class ChromeSettingsStore implements SettingsStore {
  private listeners = new Set<ChangeListener>();
  private watching = false;

  async getMapClickButton(): Promise<MapClickButton> {
    const v = await this.get(KEYS.mapClickButton);
    return parseMapClickButton(v);
  }

  async setMapClickButton(button: MapClickButton): Promise<void> {
    await this.set(KEYS.mapClickButton, button);
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
    mapClickButton: "right" as MapClickButton,
    panoLayout: DEFAULT_PANO_LAYOUT,
  };

  private ensureWatch(): void {
    if (this.watching || typeof chrome === "undefined" || !chrome.storage) {
      return;
    }
    this.watching = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (KEYS.mapClickButton in changes) {
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
