/**
 * Feedback loop: blank Pano via content-script isolated world.
 *
 * Content scripts run in an isolated JS world. Injecting
 * <script src="maps.googleapis.com/..."> puts google on the *page* world.
 * Our adapter then waits for `google.maps` in the isolated world → never sees it.
 *
 * Red: isolatedWorldHasGoogle === false && pageHasGoogle === true
 * after the same injection pattern MapsStreetViewSurface uses.
 *
 * Usage: node scripts/repro-blank-pano.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(root, ".env");
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split(/\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const apiKey = env.GOOGLE_MAPS_API_KEY;
if (!apiKey) {
  console.error("FAIL: GOOGLE_MAPS_API_KEY missing in .env");
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><body><div id="host"></div></body></html>`);

const client = await page.context().newCDPSession(page);
const { frameTree } = await client.send("Page.getFrameTree");
const frameId = frameTree.frame.id;

const { executionContextId: isolatedId } = await client.send(
  "Page.createIsolatedWorld",
  { frameId, worldName: "ssp-content-script" },
);

// Same injection pattern as maps-street-view-surface.ts (runs in page world).
await page.evaluate((key) => {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "ssp-maps-js";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("script onerror"));
    document.head.appendChild(script);
  });
}, apiKey);

// Wait for page-world google.maps
await page.waitForFunction(
  () => typeof google !== "undefined" && !!google.maps?.StreetViewPanorama,
  null,
  { timeout: 20000 },
);

const pageHasGoogle = await page.evaluate(
  () => typeof google !== "undefined" && !!google.maps?.StreetViewPanorama,
);

const { result: isolatedResult } = await client.send("Runtime.evaluate", {
  expression:
    `typeof google !== "undefined" && !!(google.maps && google.maps.StreetViewPanorama)`,
  contextId: isolatedId,
  returnByValue: true,
});
const isolatedHasGoogle = isolatedResult.value === true;

await browser.close();

const symptom =
  pageHasGoogle === true && isolatedHasGoogle === false
    ? "BLANK_PANO_ISOLATED_WORLD"
    : pageHasGoogle
      ? "UNEXPECTED_ISOLATED_HAS_GOOGLE"
      : "MAPS_FAILED_TO_LOAD_IN_PAGE";

console.log(
  JSON.stringify(
    { pageHasGoogle, isolatedHasGoogle, symptom, red: symptom === "BLANK_PANO_ISOLATED_WORLD" },
    null,
    2,
  ),
);

// Exit 1 when the known blank-Pano bug pattern is present (red).
process.exit(symptom === "BLANK_PANO_ISOLATED_WORLD" ? 1 : 0);
