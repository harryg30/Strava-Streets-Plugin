/**
 * Repro: MRE bridge must not call camera.addInteractionListener.
 *
 * Symptom model (user report): after coordinate hooking, Route Builder
 * drag/zoom/add-point die while Map Click still yields Street View.
 * The invasive hook added for coords is addInteractionListener; this
 * harness treats "listener was registered" as the red signal.
 *
 * Usage: node scripts/repro-map-tools-blocked.mjs
 * Exit 1 = red (bug present). Exit 0 = green (safe).
 */
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "ssp-mre-repro-"));

try {
  await esbuild.build({
    entryPoints: [join(root, "src/extension/host-mre-bridge.ts")],
    outfile: join(tmp, "host-mre-bridge.js"),
    bundle: true,
    format: "iife",
    target: "chrome120",
    logLevel: "silent",
  });

  const bridgeJs = readFileSync(join(tmp, "host-mre-bridge.js"), "utf8");

  const html = `<!doctype html>
<html><body>
<canvas data-testid="mre-canvas" width="800" height="600" style="width:800px;height:600px"></canvas>
<script>
  window.__mapToolsEnabled = true;
  window.__interactionListenerCalls = 0;

  const camera = {
    getLookAtPoint() { return { lat: 40.0, lng: -105.0 }; },
    getCustomLookAtPoint() { return null; },
    getTarget() { return { lat: 40.0, lng: -105.0 }; },
    getScaleMetersPerPixel() { return 2.5; },
    addInteractionListener(fn) {
      window.__interactionListenerCalls += 1;
      // Model observed Strava behavior: registering a custom interaction
      // listener knocks out Route Builder drag / zoom / add-point.
      window.__mapToolsEnabled = false;
      window.__interactionHandler = fn;
    },
    removeInteractionListener() {},
  };
  const terrainEngine = { getCamera() { return camera; } };

  const canvas = document.querySelector('[data-testid="mre-canvas"]');
  canvas.__reactFiber$test = {
    return: {
      return: {
        memoizedProps: { value: { terrainEngine } },
      },
    },
  };
</script>
</body></html>`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html);
  await page.addScriptTag({ content: bridgeJs });

  // Bridge bootHook polls every 500ms; wait past a couple ticks.
  await page.waitForTimeout(1200);

  const state = await page.evaluate(async () => {
    const callsBefore = window.__interactionListenerCalls;
    const toolsBefore = window.__mapToolsEnabled;

    const response = await new Promise((resolve) => {
      const id = "repro-1";
      const onMsg = (e) => {
        if (e.data?.source === "ssp-mre-bridge" && e.data?.id === id) {
          window.removeEventListener("message", onMsg);
          resolve(e.data);
        }
      };
      window.addEventListener("message", onMsg);
      window.postMessage(
        {
          source: "ssp-mre-isolated",
          id,
          type: "screenToLatLng",
          clientX: 500,
          clientY: 350,
        },
        "*",
      );
    });

    return {
      interactionListenerCalls: window.__interactionListenerCalls,
      mapToolsEnabled: window.__mapToolsEnabled,
      callsBefore,
      toolsBefore,
      screenOk: !!response?.ok,
      point: response?.point ?? null,
      error: response?.error ?? null,
    };
  });

  await browser.close();

  const red =
    state.interactionListenerCalls > 0 ||
    state.mapToolsEnabled === false ||
    !state.screenOk;

  console.log(
    JSON.stringify(
      {
        verdict: red ? "RED" : "GREEN",
        ...state,
        expect:
          "interactionListenerCalls===0 && mapToolsEnabled===true && screenOk",
      },
      null,
      2,
    ),
  );

  process.exit(red ? 1 : 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
