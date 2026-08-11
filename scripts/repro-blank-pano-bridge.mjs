/**
 * Feedback loop: isolated content-script pattern + page-world bridge can
 * drive Street View (the architecture we ship after reverting MAIN world).
 *
 * Usage: node scripts/repro-blank-pano-bridge.mjs
 */
import fs from "node:fs";
import http from "node:http";
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

const bridgePath = path.join(root, "dist/maps-page-bridge.js");
if (!fs.existsSync(bridgePath)) {
  console.error("FAIL: dist/maps-page-bridge.js missing — run npm run build:dev");
  process.exit(2);
}
const bridgeJs = fs.readFileSync(bridgePath, "utf8");

const point = { lat: 40.758, lng: -73.9855 };

const server = http.createServer((req, res) => {
  if (req.url === "/bridge.js") {
    res.writeHead(200, {
      "content-type": "text/javascript",
      "access-control-allow-origin": "*",
    });
    res.end(bridgeJs);
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html>
<html><head><style>
  html,body{margin:0;height:100%}
  #viewport{width:480px;height:320px;background:#111}
</style></head>
<body>
<div id="viewport"></div>
<script>
window.__ssp = { responses: [] };
window.addEventListener("message", (e) => {
  if (e.data && e.data.source === "ssp-page-bridge") {
    window.__ssp.responses.push(e.data);
  }
});
</script>
</body></html>`);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`);

// Simulate isolated → page bridge injection (script tag from "extension").
await page.addScriptTag({ url: `http://127.0.0.1:${port}/bridge.js` });
await page.waitForFunction(
  () =>
    window.__ssp.responses.some(
      (r) => r.type === "ready" || r.source === "ssp-page-bridge",
    ),
  null,
  { timeout: 5000 },
);

const result = await page.evaluate(
  async ({ key, pt }) => {
    const id = "req-1";
    const responsePromise = new Promise((resolve) => {
      const handler = (e) => {
        if (
          e.data &&
          e.data.source === "ssp-page-bridge" &&
          e.data.id === id
        ) {
          window.removeEventListener("message", handler);
          resolve(e.data);
        }
      };
      window.addEventListener("message", handler);
    });

    window.postMessage(
      {
        source: "ssp-isolated",
        id,
        type: "showAnchor",
        apiKey: key,
        viewportId: "viewport",
        point: pt,
      },
      "*",
    );

    const response = await responsePromise;
    await new Promise((r) => setTimeout(r, 1500));
    const el = document.getElementById("viewport");
    return {
      response,
      childCount: el ? el.childElementCount : -1,
    };
  },
  { key: apiKey, pt: point },
);

await browser.close();
server.close();

const green =
  result.response?.ok === true &&
  result.response?.coverage === "covered" &&
  result.childCount > 0;

console.log(JSON.stringify({ ...result, green }, null, 2));
process.exit(green ? 0 : 1);
