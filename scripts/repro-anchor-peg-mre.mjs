/**
 * Repro: Anchor peg on MRE maps with no Leaflet and no mpp.
 * Map Click often works via getLookAtPoint(x,y); peg used only mpp inverse → silent miss.
 *
 * Exit 1 = red (peg missing). Exit 0 = green.
 * Usage: node scripts/repro-anchor-peg-mre.mjs
 */
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmp = join(root, ".tmp-anchor-peg-repro");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const harnessEntry = join(tmp, "harness.ts");
writeFileSync(
  harnessEntry,
  `
import { StravaHostPage } from "../src/adapters/host-page/strava-host-page.ts";
import { ExtensionApplication } from "../src/core/extension-application.ts";

class MemSettings {
  mapClickButton: "left" | "right" = "right";
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
    __host: StravaHostPage;
    __streetView: MemSurface;
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
  window.__streetView = streetView;
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
<html><head>
<style>
.ssp-anchor-peg { position: absolute; z-index: 2147483645; width: 20px; height: 28px; margin-left: -10px; margin-top: -28px; pointer-events: none; }
.ssp-anchor-peg--fixed { position: fixed; }
.ssp-anchor-peg__pin { position: absolute; left: 1px; top: 0; width: 18px; height: 18px; border-radius: 50% 50% 50% 0; background: #fc4c02; border: 2px solid #fff; transform: rotate(-45deg); }
</style>
</head><body>
<canvas data-testid="mre-canvas" width="800" height="600" style="width:800px;height:600px;background:#333"></canvas>
<script>
  const camera = {
    getLookAtPoint(a, b) {
      if (arguments.length === 0) return { lat: 40.0, lng: -105.0 };
      const x = typeof a === "number" ? a : 400;
      const y = typeof b === "number" ? b : 300;
      return { lat: 40.0 - (y - 300) * 0.00001, lng: -105.0 + (x - 400) * 0.00001 };
    },
    getCustomLookAtPoint() { return null; },
    getTarget() { return { lat: 40.0, lng: -105.0 }; },
    // NO getScaleMetersPerPixel — Map Click still works via getLookAtPoint(x,y)
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

const box = await page.locator('[data-testid="mre-canvas"]').boundingBox();
if (!box) throw new Error("no canvas");
const x = box.x + 500;
const y = box.y + 350;
await page.mouse.click(x, y, { button: "right" });
await page.waitForTimeout(400);

const shown = await page.evaluate(() => window.__streetView.shown.length);
const peg = await page.evaluate(() => {
  const el = document.getElementById("ssp-anchor-peg");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    exists: true,
    hidden: el.hidden,
    left: el.style.left,
    top: el.style.top,
    width: r.width,
    height: r.height,
    className: el.className,
  };
});

await browser.close();
rmSync(tmp, { recursive: true, force: true });

if (shown < 1) {
  console.error("RED: Map Click did not drive Street View (setup broken)");
  process.exit(1);
}

if (!peg?.exists || peg.hidden) {
  console.error(
    "RED: no Anchor peg after covered Map Click on MRE without mpp",
  );
  console.error(JSON.stringify({ shown, peg }, null, 2));
  process.exit(1);
}

console.log("GREEN: peg present after MRE Map Click", peg);
process.exit(0);
