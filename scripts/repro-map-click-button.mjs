/**
 * Repro: Map Click (left / right) must drive Anchor → Street View.
 * Also covers "bridge <script> already on page" (extension reload without tab refresh).
 *
 * Exit 1 = red (bug present). Exit 0 = green.
 *
 * Usage: node scripts/repro-map-click-button.mjs
 */
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmp = join(root, ".tmp-map-click-repro");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

try {
  const harnessEntry = join(tmp, "harness.ts");
  writeFileSync(
    harnessEntry,
    `
import { StravaHostPage } from "../src/adapters/host-page/strava-host-page.ts";
import { ExtensionApplication } from "../src/core/extension-application.ts";

class MemSettings {
  mapClickButton: "left" | "right" = "left";
  listeners = new Set<() => void>();
  async getMapClickButton() { return this.mapClickButton; }
  async setMapClickButton(b: "left" | "right") { this.mapClickButton = b; this.notify(); }
  async getPanoLayout() { return null; }
  async setPanoLayout() {}
  onSettingsChange(l: () => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
  notify() { for (const l of this.listeners) l(); }
}

class MemCreds {
  async getStreetViewCredentials() {
    return { status: "ok" as const, credential: { apiKey: "test" } };
  }
}

class MemSurface {
  mounted = false;
  shown: { lat: number; lng: number }[] = [];
  mount() { this.mounted = true; }
  unmount() { this.mounted = false; }
  isMounted() { return this.mounted; }
  setLayout() {}
  async showAnchor(p: { lat: number; lng: number }) { this.shown.push(p); return "covered" as const; }
  setCoverageGapNotice() {}
  setStatusMessage() {}
  onUserClose() { return () => {}; }
  onLayoutChange() { return () => {}; }
}

declare global {
  interface Window {
    __boot: () => Promise<void>;
    __settings: MemSettings;
    __streetView: MemSurface;
    __app: ExtensionApplication;
    __host: StravaHostPage;
  }
}

window.__boot = async () => {
  const host = new StravaHostPage();
  const settings = new MemSettings();
  const streetView = new MemSurface();
  const app = new ExtensionApplication({
    hostPage: host,
    credentials: new MemCreds(),
    streetView,
    settings,
  });
  await app.start();
  await new Promise((r) => setTimeout(r, 50));
  window.__host = host;
  window.__settings = settings;
  window.__streetView = streetView;
  window.__app = app;
};
`,
  );

  await esbuild.build({
    entryPoints: [harnessEntry],
    outfile: join(tmp, "harness.bundle.js"),
    bundle: true,
    format: "iife",
    target: "chrome120",
    logLevel: "silent",
  });

  await esbuild.build({
    entryPoints: [join(root, "src/extension/host-mre-bridge.ts")],
    outfile: join(tmp, "host-mre-bridge.js"),
    bundle: true,
    format: "iife",
    target: "chrome120",
    logLevel: "silent",
  });

  const harnessJs = readFileSync(join(tmp, "harness.bundle.js"), "utf8");
  const bridgeJs = readFileSync(join(tmp, "host-mre-bridge.js"), "utf8");

  const html = `<!doctype html>
<html><body>
<canvas data-testid="mre-canvas" width="800" height="600" style="width:800px;height:600px;background:#333"></canvas>
<script>
  const camera = {
    getLookAtPoint() { return { lat: 40.0, lng: -105.0 }; },
    getCustomLookAtPoint() { return null; },
    getTarget() { return { lat: 40.0, lng: -105.0 }; },
    getScaleMetersPerPixel() { return 2.5; },
  };
  const terrainEngine = { getCamera() { return camera; } };
  const canvas = document.querySelector('[data-testid="mre-canvas"]');
  let node = { memoizedProps: { value: { terrainEngine } } };
  for (let i = 0; i < 5; i++) node = { return: node };
  canvas.__reactFiber$test = node;
</script>
</body></html>`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("pageerror", err));
  await page.route("http://ssp.local/maps**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: html,
    });
  });
  await page.goto("http://ssp.local/maps");
  // Pre-inject bridge (simulates leftover script after extension reload).
  await page.evaluate((js) => {
    const s = document.createElement("script");
    s.id = "ssp-host-mre-bridge";
    s.textContent = js;
    document.documentElement.appendChild(s);
  }, bridgeJs);
  await page.addScriptTag({ content: harnessJs });
  await page.evaluate(async () => {
    await window.__boot();
  });

  async function clickCanvas(button) {
    const box = await page.locator('[data-testid="mre-canvas"]').boundingBox();
    if (!box) throw new Error("no canvas box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.click(x, y, { button });
    await page.waitForTimeout(300);
  }

  await page.evaluate(async () => {
    await window.__settings.setMapClickButton("left");
    await new Promise((r) => setTimeout(r, 30));
  });
  await clickCanvas("left");
  const leftModeLeft = await page.evaluate(() => window.__streetView.shown.length);

  const beforeRight = leftModeLeft;
  await clickCanvas("right");
  const leftModeRight = await page.evaluate(() => window.__streetView.shown.length);

  await page.evaluate(async () => {
    window.__streetView.shown = [];
    await window.__settings.setMapClickButton("right");
    await new Promise((r) => setTimeout(r, 30));
  });
  await clickCanvas("right");
  const rightModeRight = await page.evaluate(() => window.__streetView.shown.length);

  await page.evaluate(() => {
    window.__streetView.shown = [];
  });
  await clickCanvas("left");
  const rightModeLeft = await page.evaluate(() => window.__streetView.shown.length);

  const state = await page.evaluate(() => ({
    onRouteBuilder: window.__app.getState().onRouteBuilder,
    mapClickButton: window.__app.getState().mapClickButton,
    panoMounted: window.__streetView.mounted,
  }));

  await browser.close();

  const report = {
    leftModeLeft,
    leftModeRight,
    leftModeRightIgnored: leftModeRight === beforeRight,
    rightModeRight,
    rightModeLeft,
    state,
  };
  console.log(JSON.stringify(report, null, 2));

  const ok =
    leftModeLeft >= 1 &&
    leftModeRight === beforeRight &&
    rightModeRight >= 1 &&
    rightModeLeft === 0;

  if (!ok) {
    console.error("RED: Map Click Button did not drive Anchor as expected");
    process.exit(1);
  }
  console.log("GREEN: left/right Map Click Button OK (incl. pre-existing bridge)");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
