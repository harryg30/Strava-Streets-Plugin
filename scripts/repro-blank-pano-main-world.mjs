/**
 * Green path after MAIN-world fix: same injection as the adapter, then
 * construct StreetViewPanorama in the *page* world (what MAIN content scripts use).
 *
 * Usage: node scripts/repro-blank-pano-main-world.mjs
 * Expect exit 0 when panorama DOM children appear.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env"), "utf8")
    .split(/\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const apiKey = env.GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error("FAIL: GOOGLE_MAPS_API_KEY missing");
  process.exit(2);
}

// Times Square — known Street View coverage
const point = { lat: 40.758, lng: -73.9855 };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`<!doctype html>
<html><head><style>
  html,body{margin:0;height:100%}
  #viewport{width:480px;height:320px;background:#111}
</style></head>
<body><div id="viewport"></div></body></html>`);

await page.evaluate((key) => {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("script onerror"));
    document.head.appendChild(script);
  });
}, apiKey);

await page.waitForFunction(
  () => typeof google !== "undefined" && !!google.maps?.StreetViewPanorama,
  null,
  { timeout: 20000 },
);

const result = await page.evaluate(async (pt) => {
  const el = document.getElementById("viewport");
  const service = new google.maps.StreetViewService();
  const status = await new Promise((resolve) => {
    service.getPanorama({ location: pt, radius: 50 }, (_data, s) => resolve(s));
  });
  if (status !== "OK") {
    return { ok: false, status, childCount: el.childElementCount };
  }
  // eslint-disable-next-line no-new
  new google.maps.StreetViewPanorama(el, {
    position: pt,
    pov: { heading: 0, pitch: 0 },
    zoom: 1,
    addressControl: false,
    enableCloseButton: false,
  });
  await new Promise((r) => setTimeout(r, 1500));
  return {
    ok: el.childElementCount > 0,
    status,
    childCount: el.childElementCount,
  };
}, point);

await browser.close();

console.log(JSON.stringify({ ...result, green: result.ok }, null, 2));
process.exit(result.ok ? 0 : 1);
